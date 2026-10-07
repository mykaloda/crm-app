import contextlib
import io
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parent), str(HERE)]

import mcp_client  # noqa: E402
import mock_mcp_server  # noqa: E402
import sync  # noqa: E402
from mcp_client import AuthError, McpClient, NetworkBlocked, ToolError  # noqa: E402

PLAN = {
    "sql_tool": {"name": "run_sql", "arg": "query"},
    "entities": [
        {"name": "orders", "tool": "list_orders", "key": "id",
         "paginate": {"cursor_arg": "cursor", "limit_arg": "limit", "limit": 50}},
        {"name": "clients", "tool": "list_clients", "key": "id",
         "paginate": {"page_arg": "page", "limit_arg": "per_page", "limit": 2}},
        {"name": "order_details", "tool": "get_order", "key": "id",
         "for_each": {"from": "orders", "field": "id", "arg": "id", "changed_only": True}},
        {"name": "orders_sql", "sql": "SELECT * FROM orders", "key": "id", "page_size": 10},
        {"name": "broken", "tool": "broken"},
    ],
}


class SyncTest(unittest.TestCase):
    mode = "json"

    def setUp(self):
        self.server, self.url = mock_mcp_server.start(self.mode)
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name) / "data"
        plan = Path(self.tmp.name) / "plan.json"
        plan.write_text(json.dumps(PLAN))
        env = {"LEREGA_CRM_URL": self.url, "LEREGA_CRM_KEY": mock_mcp_server.KEY,
               "CRM_DATA_DIR": str(self.data), "CRM_PLAN": str(plan)}
        patcher = mock.patch.dict(os.environ, env)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def run_cli(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            code = sync.main(list(argv))
        return code, out.getvalue()

    def query(self, sql, args=()):
        with contextlib.closing(sqlite3.connect(self.data / "crm.sqlite")) as db:
            return db.execute(sql, args).fetchall()

    def test_discover_lists_every_tool(self):
        code, out = self.run_cli("discover")
        self.assertEqual(code, 0)
        schema = json.loads((self.data / "schema.json").read_text())
        self.assertEqual([t["name"] for t in schema["tools"]], [t["name"] for t in mock_mcp_server.TOOLS])
        self.assertEqual(schema["instructions"], "Read-only.")
        self.assertIn("get_order(id*)", out)

    def test_plan_drafts_list_tools_with_paging(self):
        self.run_cli("discover")
        self.run_cli("plan")
        plan = json.loads((Path(self.tmp.name) / "plan.draft.json").read_text())
        by_name = {e["name"]: e for e in plan["entities"]}
        self.assertEqual(by_name["orders"]["paginate"], {"cursor_arg": "cursor", "limit_arg": "limit", "limit": 3})
        self.assertEqual(by_name["clients"]["paginate"], {"page_arg": "page", "limit_arg": "per_page", "limit": 100})
        self.assertNotIn("order", by_name)  # get_order needs an id
        self.assertEqual(plan["sql_tool"], {"name": "run_sql", "arg": "query"})

    def test_pull_then_incremental_pull(self):
        code, out = self.run_cli("pull")
        self.assertEqual(code, 1)  # "broken" failed, the rest is saved
        summary = json.loads(out)["entities"]
        self.assertEqual(summary["orders"], {"pulled": 7, "new": 7})
        self.assertEqual(summary["clients"], {"pulled": 5, "new": 5})
        self.assertEqual(summary["order_details"], {"pulled": 7, "new": 7})
        self.assertEqual(summary["orders_sql"], {"pulled": 7, "new": 7})  # despite the 4-row cap
        self.assertIn("broken", summary["broken"]["error"])

        rows = self.query('SELECT id, stage, "client.city" FROM orders ORDER BY id')
        self.assertEqual(rows[0], (1, "new", "Чикаго"))
        csv_text = (self.data / "export" / "orders.csv").read_bytes()
        self.assertTrue(csv_text.startswith(b"\xef\xbb\xbf_key,id,stage,total,client.city"))

        crm = self.server.crm
        crm.execute("UPDATE orders SET stage = 'agreed' WHERE id = 2")
        crm.execute("DELETE FROM orders WHERE id = 7")
        crm.execute("INSERT INTO orders VALUES (8, 'new', 800, 'Эванстон')")
        self.server.calls.clear()
        code, out = self.run_cli("pull")
        summary = json.loads(out)["entities"]
        self.assertEqual(summary["orders"], {"pulled": 7, "new": 1, "updated": 1, "deleted": 1})
        detail_calls = sorted(args["id"] for name, args in self.server.calls if name == "get_order")
        self.assertEqual(detail_calls, [2, 8])  # only orders that changed
        self.assertEqual(summary["order_details"], {"pulled": 2, "new": 1, "updated": 1})

        self.assertEqual(self.query("SELECT count(*) FROM orders")[0][0], 7)
        self.assertEqual(self.query("SELECT stage FROM orders WHERE id = 2")[0][0], "agreed")
        history = self.query("SELECT change FROM _history WHERE entity = 'orders' AND key = '2' ORDER BY run_id")
        self.assertEqual(history, [("new",), ("updated",)])
        self.assertEqual(self.query("SELECT status FROM _runs ORDER BY id"), [("partial",), ("partial",)])

    def test_sql_pages_shrink_when_the_server_cuts_results(self):
        self.server.max_chars = 150  # about two orders per result
        crm = self.server.crm
        for i in range(8, 30):
            crm.execute("INSERT INTO orders VALUES (?, 'new', ?, 'Остин')", (i, 10.0 * i))
        plan = {"sql_tool": {"name": "run_sql_wide", "arg": "query", "max_chars": 150},
                "entities": [{"name": "orders", "sql": "SELECT * FROM orders", "key": "id", "unique": True}]}
        (Path(self.tmp.name) / "plan.json").write_text(json.dumps(plan))
        code, out = self.run_cli("pull")
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["entities"]["orders"], {"pulled": 29, "new": 29})

    def test_cli_runs_as_a_script(self):
        script = HERE.parent / "sync.py"
        result = subprocess.run([sys.executable, str(script), "discover"], capture_output=True, text=True,
                                env={**os.environ}, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("5 tools", result.stdout)


class StoreTest(unittest.TestCase):
    def test_rows_sharing_a_key_are_all_kept(self):
        from store import Store
        with tempfile.TemporaryDirectory() as tmp:
            store = Store(Path(tmp) / "crm.sqlite")
            rows = [{"order_no": 1, "at": "t1", "body": "a"}, {"order_no": 1, "at": "t1", "body": "b"},
                    {"order_no": 1, "at": "t1", "body": "b"}]
            counts = store.apply(store.start_run(), "notes", rows, ["order_no", "at"])
            self.assertEqual(counts, {"pulled": 3, "new": 3})
            self.assertEqual(len(store.records("notes")), 3)
            again = store.apply(store.start_run(), "notes", rows, ["order_no", "at"])
            self.assertEqual(again, {"pulled": 3})
            store.close()


class SseSyncTest(SyncTest):
    mode = "sse"


class ClientTest(unittest.TestCase):
    def setUp(self):
        self.server, self.url = mock_mcp_server.start("sse")
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def test_wrong_key(self):
        with self.assertRaises(AuthError):
            McpClient(self.url, "wrong").initialize()

    def test_no_key_sends_no_authorization(self):
        with self.assertRaisesRegex(AuthError, "no key reached the server"):
            McpClient(self.url, None).initialize()

    def test_session_expiry_reinitializes(self):
        client = McpClient(self.url, mock_mcp_server.KEY)
        client.initialize()
        self.server.expire_after = self.server.requests + 1
        self.assertEqual(len(client.call_tool("list_clients", {"per_page": 10})["items"]), 5)
        self.assertEqual(self.server.initializations, 2)

    def test_tool_error(self):
        client = McpClient(self.url, mock_mcp_server.KEY)
        client.initialize()
        with self.assertRaises(ToolError):
            client.call_tool("broken")

    def test_transient_errors_are_retried(self):
        client = McpClient(self.url, mock_mcp_server.KEY)
        client.initialize()
        self.server.fail_next = 2
        with mock.patch.object(mcp_client, "RETRY_DELAYS", (0, 0, 0)):
            self.assertEqual(client.call_tool("list_orders")["orders"][0]["id"], 1)

    def test_proxy_refusal_is_reported_not_retried(self):
        refused = urllib.error.URLError("Tunnel connection failed: 403 Forbidden")
        with mock.patch("urllib.request.urlopen", side_effect=refused) as urlopen:
            with self.assertRaises(NetworkBlocked):
                McpClient("https://crm.example.com/api/mcp", "k").initialize()
        self.assertEqual(urlopen.call_count, 1)



class AnalyticsTest(unittest.TestCase):
    """The dashboard builds from a small store, with and without the message and site aggregates."""

    def build(self, with_aggregates, manual=None):
        import analytics
        from store import Store
        from datetime import datetime, timezone
        with tempfile.TemporaryDirectory() as tmp:
            store = Store(Path(tmp) / "crm.sqlite")
            run = store.start_run()
            stages = [("New Lead", "New Leads", 2), ("Scheduled", "Scheduled", 8), ("Picked Up", "On Site", 9),
                      ("Done", "Done", 10), ("Closed", "Archive / No Order", 12)]
            store.apply(run, "stages", [{"stage": n, "stage_group": g, "sort_order": i} for n, g, i in stages], "stage")
            orders = []
            # Four Picked Up orders wait in the shop (26, 16, 8 and 5 days on 6 Oct); o3 came in and went out.
            SHOP_IN = {2: "2026-09-10T15:00:00+00:00", 7: "2026-09-20T15:00:00+00:00", 12: "2026-09-28T15:00:00+00:00",
                       17: "2026-10-01T15:00:00+00:00", 3: "2026-09-15T15:00:00+00:00"}
            for i, (stage, _, _) in enumerate(stages * 4):
                orders.append({"order_id": f"o{i}", "order_no": 100 + i, "stage": stage, "step": "Quote Sent" if i % 2 else None,
                               "created_at": f"2026-09-{1 + i:02d}T15:00:00.123+00:00", "stage_changed_at": "2026-09-25T15:00:00.5+00:00",
                               "sources": "Yelp, Google Ads" if i % 3 else None, "work_types": "Car", "came_via": "Web Form",
                               "quote": 300 + i, "deadline": "2026-09-30" if stage == "Picked Up" else None,
                               "no_order_reason": "Price" if stage == "Closed" else None, "no_order_note": None, "item": "seat",
                               "received_at_shop": SHOP_IN.get(i), "left_shop_at": "2026-10-01T20:00:00+00:00" if i == 3 else None,
                               "shop": "Lakeway Shop" if i in (2, 7) else None, "quote_max": None})
            store.apply(run, "orders", orders, "order_id")
            store.apply(run, "payments", [{"order_id": "o3", "kind": "payment", "amount": 500, "tip": 20, "paid_at": "2026-10-02T17:00:00+00:00", "note": None},
                                          {"order_id": "o3", "kind": "material", "amount": -80, "tip": None, "paid_at": "2026-10-02T17:00:00+00:00", "note": None}],
                        ["order_id", "kind", "paid_at", "amount"])
            store.apply(run, "estimates", [{"order_id": "o1", "created_at": "2026-09-02T16:00:00+00:00", "sent_at": "2026-09-02T18:00:00+00:00"}], ["order_id", "created_at"])
            store.apply(run, "appointments", [{"order_id": "o1", "order_no": 101, "type": "Pickup", "scheduled_at": "2026-10-08T14:00:00+00:00", "status": "scheduled", "executor": "Driver"},
                                              {"order_id": "o6", "order_no": 106, "type": "Delivery", "scheduled_at": "2026-10-01T14:00:00+00:00", "status": "scheduled", "executor": "Driver"}],
                        ["order_id", "type", "scheduled_at"])
            store.apply(run, "work_time", [{"order_id": "o3", "worker": "Мастер", "started_at": "2026-10-01T15:00:00+00:00",
                                           "stopped_at": "2026-10-01T19:30:00+00:00", "hours": 4.5},  # typed in by hand
                                          {"order_id": "o3", "worker": "Мастер", "started_at": "2026-10-02T15:00:12.345+00:00",
                                           "stopped_at": "2026-10-02T16:30:40.1+00:00", "hours": 1.5}],
                        ["order_id", "worker", "started_at"])
            store.apply(run, "stage_history", [{"order_id": "o1", "to_stage": "Scheduled", "effective_at": "2026-09-03T15:00:00+00:00"}], ["order_id", "effective_at", "to_stage"])
            if with_aggregates:
                store.apply(run, "agg_messages_weekly", [{"week": "2026-09-28", "n_in": 5, "n_out": 4, "n_auto": 2}], "week")
                store.apply(run, "agg_messages_channels", [{"name": "sms", "n": 9}], "name")
                store.apply(run, "agg_messages_replies", [{"scope": "all", "replies": 4, "median_hours": 1.26, "within_1h": 0.5, "within_24h": 1}], "scope")
                store.apply(run, "agg_messages_waiting", [{"order_no": 100, "hours": 5}], "order_no")
                store.apply(run, "agg_site_weekly", [{"week": "2026-09-28", "visits": 40, "orders": 2}], "week")
                store.apply(run, "agg_site_totals", [{"scope": "all", "visits": 400, "orders": 9}], "scope")
                for name in ("agg_site_sources", "agg_site_devices", "agg_site_landings"):
                    store.apply(run, name, [{"name": "google", "visits": 30, "orders": 1}], "name")
                store.apply(run, "agg_sla_weekly", [
                    {"week": "2026-09-21", "leads": 30, "late": 12, "pending": 0, "leads_window": 14, "median_minutes_window": 121.6},
                    {"week": "2026-09-28", "leads": 25, "late": 5, "pending": 0, "leads_window": 12, "median_minutes_window": 64.2},
                    {"week": "2026-10-05", "leads": 9, "late": 1, "pending": 3, "leads_window": 6, "median_minutes_window": 30.0}], "week")
                store.apply(run, "agg_photo_reminder_weekly", [{"week": "2026-09-28", "silent": 8, "reminded": 2, "pending": 1}], "week")
                store.apply(run, "agg_quote_photo_weekly", [{"week": "2026-09-28", "photos": 40, "late": 10, "no_quote": 4, "pending": 0}], "week")
                store.apply(run, "agg_actions_weekly", [
                    {"week": "2026-09-21", "author": "Dillon", "actions": 50}, {"week": "2026-09-21", "author": "Tatiana", "actions": 50},
                    {"week": "2026-09-28", "author": "Dillon", "actions": 90}, {"week": "2026-09-28", "author": "Tatiana", "actions": 10},
                    {"week": "2026-10-05", "author": "Dillon", "actions": 7}], ["week", "author"])
            store.close()
            tables, last_run = analytics.load(Path(tmp) / "crm.sqlite")
        return analytics.build(tables, last_run, now=datetime(2026, 10, 6, 17, 0, tzinfo=timezone.utc), manual=manual)

    def test_builds_with_aggregates(self):
        summary, pipeline = self.build(with_aggregates=True)
        self.assertEqual(summary["kpi"]["mtd"], 500)
        self.assertEqual(summary["monthly"][-1]["costs"], 80)
        self.assertEqual(summary["messages"]["reply_hours_median"], 1.26)
        self.assertEqual(summary["site"]["visits_90"], 400)
        reasons = {r["reason"] for r in pipeline["attention"]}
        numbers = [r["order_no"] for r in pipeline["attention"]]
        self.assertEqual(len(numbers), len(set(numbers)))  # one row per order
        self.assertIn("client_waiting", reasons)   # #100 waits for a reply
        self.assertIn("appointment", reasons)      # the 1 Oct delivery is still "scheduled"
        self.assertIn("deadline", reasons)         # Picked Up orders past 30 Sep
        sources = {r["name"]: r for r in summary["periods"]["365"]["sources"]}
        self.assertEqual(sources["Yelp"]["leads"], sources["Google Ads"]["leads"])  # both sources count
        self.assertEqual(pipeline["upcoming"][0]["order_no"], 101)

    def test_builds_without_aggregates(self):
        summary, _ = self.build(with_aggregates=False)
        self.assertIsNone(summary["messages"])
        self.assertIsNone(summary["site"])
        self.assertEqual(summary["tables"]["orders"], 20)
        sla = next(r for r in summary["scorecard"] if r["key"] == "sla_late")
        self.assertEqual((sla["value"], sla["status"], sla["trend"]), (None, None, None))

    def test_scorecard(self):
        manual = {"as_of": "2026-10-05", "values": {"receipts": {"value": 41000}},
                  "previous": {"as_of": "2026-09-28", "values": {"receipts": {"value": 39000}}}}
        summary, _ = self.build(with_aggregates=True, manual=manual)
        rows = {r["key"]: r for r in summary["scorecard"]}
        self.assertEqual((len(rows), len(summary["scorecard"])), (18, 18))
        self.assertEqual(sum(r["main"] for r in rows.values()), 8)  # the weekly table
        sla = rows["sla_late"]  # the week of 28 Sep: the week of 5 Oct is not over yet
        self.assertEqual((sla["value"], sla["prev"], sla["trend"], sla["status"]), (20.0, 40.0, "better", "off"))
        self.assertIn("медиана ответа в окне 64 мин", sla["note"])
        self.assertEqual((rows["photo_reminder"]["value"], rows["photo_reminder"]["small"]), (25.0, True))
        self.assertEqual(rows["quote_late"]["value"], 25.0)
        owner = rows["owner_share"]
        self.assertEqual((owner["value"], owner["n"], owner["prev"], owner["trend"]), (90.0, 100, 50.0, "worse"))
        shop = rows["shop_p90"]  # ages 5, 8, 16 and 26 days
        self.assertEqual((shop["value"], shop["n"], shop["status"]), (23.0, 4, "off"))
        self.assertIn("Lakeway и On Deck — 2", shop["note"])
        self.assertIn("за 4 недели выдано 1, принято 5", shop["note"])
        self.assertEqual((rows["manual_hours"]["value"], rows["manual_hours"]["n"]), (75.0, 2))  # 4.5 of 6 hours
        self.assertEqual((rows["no_reason"]["value"], rows["no_reason"]["n"]), (0, 4))  # every loss names Price
        conversion = rows["conversion"]  # nothing was created 45–74 days before 6 Oct
        self.assertEqual((conversion["value"], conversion["status"]), (None, None))
        receipts = rows["receipts"]
        self.assertEqual((receipts["value"], receipts["trend"], receipts["manual"]), (41000, "better", True))
        self.assertTrue(receipts["note"].startswith("замер 2026-10-05"))
        self.assertIsNone(rows["reviews"]["value"])

    def test_confidence_interval(self):
        import analytics
        self.assertEqual(analytics.wilson(110, 399), (23.4, 32.2))
        self.assertEqual(analytics.wilson(0, 0), (None, None))
        self.assertEqual(analytics.percentile([5, 8, 16, 26], 0.9), 23.0)

    def test_plain_dates_keep_their_day(self):
        import analytics
        from datetime import date
        self.assertEqual(analytics.local_day("2026-09-17"), date(2026, 9, 17))
        self.assertEqual(analytics.local_day("2026-09-17T00:00:00+00:00"), date(2026, 9, 17))  # Monday.com import
        self.assertEqual(analytics.local_day("2026-09-18T02:00:00.5+00:00"), date(2026, 9, 17))  # evening in Austin


if __name__ == "__main__":
    unittest.main()
