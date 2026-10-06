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

    def test_cli_runs_as_a_script(self):
        script = HERE.parent / "sync.py"
        result = subprocess.run([sys.executable, str(script), "discover"], capture_output=True, text=True,
                                env={**os.environ}, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("5 tools", result.stdout)


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


if __name__ == "__main__":
    unittest.main()
