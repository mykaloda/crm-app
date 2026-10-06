#!/usr/bin/env python3
"""Turn the pulled CRM data (data/crm.sqlite) into the dashboard's documents.

    python3 crm-sync/analytics.py      -> data/dashboard/summary.json and pipeline.json

The dashboard gets aggregates and order numbers only: no client names,
addresses, message texts or notes leave the local database.
"""

import json
import os
import sqlite3
import statistics
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
TZ = ZoneInfo("America/Chicago")  # the business works in Austin time
WINDOWS = (30, 90, 365)  # days; the dashboard's period switch
SCHEDULE = ("07:50", "12:50", "17:50")  # Austin time; keep in step with the routine that runs the sync
REQUIRED = ("orders", "stages", "stage_history", "payments", "estimates", "appointments", "work_time")
# Messages and site visits arrive as aggregates the CRM computes (see plan.json), not as raw rows.
AGGREGATES = ("agg_messages_weekly", "agg_messages_channels", "agg_messages_replies", "agg_messages_waiting",
              "agg_site_weekly", "agg_site_totals", "agg_site_sources", "agg_site_devices", "agg_site_landings")
MIGRATED_NOTE = "Перенесено из Monday"  # payments copied over from Monday.com
UNSET = "(не указано)"

# How long an order may sit in a stage before it counts as stuck.
STUCK_DAYS = {"New Lead": 7, "Under Review": 2, "Wait": 21, "Material - Our Side": 14,
              "Material - Client Side": 14, "Shipping Label Provided": 14, "Scheduled": 14, "Picked Up": 21}
QUOTE_STEPS = ("Quote Sent", "Quote Follow-up 1", "Quote Follow-up 2")
ATTENTION = {  # reason -> (priority, label)
    "deadline": (1, "Срок сдачи прошёл"),
    "appointment": (2, "Выезд в прошлом, не отмечен"),
    "client_waiting": (3, "Клиент ждёт ответа"),
    "our_move": (4, "Ход за нами"),
    "long_in_shop": (5, "Долго в мастерской"),
    "quote_silence": (6, "Смета без ответа"),
    "close_candidate": (7, "Можно закрыть"),
}


def data_dir():
    return Path(os.environ.get("CRM_DATA_DIR") or HERE / "data")


# --- parsing ----------------------------------------------------------------

def ts(value):
    return datetime.fromisoformat(value) if value else None


def local_day(value):
    """Business date of a timestamp. Monday.com imports are dates stored as UTC midnight: keep their date."""
    t = ts(value)
    if t is None:
        return None
    if t.utcoffset() == timedelta(0) and (t.hour, t.minute, t.second, t.microsecond) == (0, 0, 0, 0):
        return t.date()
    return t.astimezone(TZ).date()


def day(value):
    return date.fromisoformat(value[:10]) if value else None


def split(value):
    parts = [p.strip() for p in (value or "").split(",") if p.strip()]
    return parts or [UNSET]


def median(values):
    values = [v for v in values if v is not None]
    return round(statistics.median(values), 1) if values else None


def money(value):
    return round(value or 0, 2)


def week_start(d):
    return d - timedelta(days=d.weekday())


# --- loading ----------------------------------------------------------------

def load(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    present = {e for (e,) in conn.execute("SELECT DISTINCT entity FROM _records")}
    tables = {}
    for name in REQUIRED + AGGREGATES:
        tables[name] = [dict(r) for r in conn.execute(f'SELECT * FROM "{name}"')] if name in present else None
    run = conn.execute("SELECT id, status, started_at, finished_at, summary FROM _runs ORDER BY id DESC LIMIT 1").fetchone()
    conn.close()
    return tables, dict(run) if run else None


def order_status(stage, group):
    if group == "Archive / No Order" or (stage or "").startswith("Closed"):
        return "lost"
    if group == "Done" or stage in ("Done", "Delivered"):
        return "done"
    if stage in ("API", "New Lead", "Under Review", "Wait") or group in ("API", "New Leads"):
        return "open"
    return "in_work"  # agreed: scheduled, picked up, waiting for material or a shipped item


class Crm:
    def __init__(self, tables, now):
        self.t = tables
        self.now = now
        self.today = now.astimezone(TZ).date()
        stages = tables["stages"] or []
        self.stage_info = {s["stage"]: s for s in stages}
        self.stage_order = [s["stage"] for s in sorted(stages, key=lambda s: s["sort_order"] or 0)]

        self.paid = defaultdict(float)
        for p in tables["payments"] or []:
            if p["kind"] == "payment":
                self.paid[p["order_id"]] += p["amount"] or 0
        quoted_by_estimate = {e["order_id"] for e in tables["estimates"] or [] if e["sent_at"]}

        self.orders = []
        for o in tables["orders"] or []:
            group = (self.stage_info.get(o["stage"]) or {}).get("stage_group")
            status = order_status(o["stage"], group)
            changed = local_day(o["stage_changed_at"]) or local_day(o["created_at"])
            self.orders.append({
                **o,
                "status": status,
                "won": status in ("in_work", "done"),
                "created": local_day(o["created_at"]),
                "days_in_stage": (self.today - changed).days if changed else None,
                "quoted": (o["quote"] or 0) > 0 or o["order_id"] in quoted_by_estimate
                          or (o["step"] or "").startswith("Quote") or status in ("in_work", "done"),
                "paid": self.paid.get(o["order_id"], 0.0),
            })
        self.by_id = {o["order_id"]: o for o in self.orders}

    def since(self, days):
        start = self.today - timedelta(days=days - 1)
        return [o for o in self.orders if o["created"] and o["created"] >= start]


# --- metrics ----------------------------------------------------------------

def win_rate(orders):
    won = sum(o["won"] for o in orders)
    lost = sum(o["status"] == "lost" for o in orders)
    return round(won / (won + lost), 3) if won + lost else None


def breakdown(orders, field, limit=12):
    """Leads, outcomes and money per value of a comma-separated field (an order counts for each value)."""
    rows = defaultdict(lambda: {"leads": 0, "won": 0, "lost": 0, "open": 0, "quoted_won": 0.0, "received": 0.0})
    for o in orders:
        for value in split(o[field]):
            r = rows[value]
            r["leads"] += 1
            r["won"] += o["won"]
            r["lost"] += o["status"] == "lost"
            r["open"] += o["status"] == "open"
            if o["won"]:
                r["quoted_won"] += o["quote"] or 0
            r["received"] += o["paid"]
    out = []
    for value, r in sorted(rows.items(), key=lambda kv: (-kv[1]["leads"], kv[0])):
        resolved = r["won"] + r["lost"]
        out.append({"name": value, **r, "quoted_won": money(r["quoted_won"]), "received": money(r["received"]),
                    "win_rate": round(r["won"] / resolved, 3) if resolved else None})
    if len(out) > limit:
        head, tail = out[:limit - 1], out[limit - 1:]
        other = {"name": f"Другие ({len(tail)})", "leads": 0, "won": 0, "lost": 0, "open": 0,
                 "quoted_won": 0.0, "received": 0.0}
        for r in tail:
            for k in ("leads", "won", "lost", "open", "quoted_won", "received"):
                other[k] += r[k]
        resolved = other["won"] + other["lost"]
        other.update(quoted_won=money(other["quoted_won"]), received=money(other["received"]),
                     win_rate=round(other["won"] / resolved, 3) if resolved else None)
        out = head + [other]
    return out


def funnel(orders):
    return [
        {"step": "Заявки", "n": len(orders)},
        {"step": "Получили смету", "n": sum(o["quoted"] for o in orders)},
        {"step": "Стали заказом", "n": sum(o["won"] for o in orders)},
        {"step": "Выполнены", "n": sum(o["status"] == "done" for o in orders)},
        {"step": "Оплата в CRM", "n": sum(o["won"] and o["paid"] > 0 for o in orders)},
    ]


def loss_reasons(orders):
    lost = [o for o in orders if o["status"] == "lost"]
    counts = Counter(o["no_order_reason"] or UNSET for o in lost)
    blind = sum((o["no_order_reason"] in (None, "Other")) and not o["no_order_note"] for o in lost)
    return {"total": len(lost), "unexplained": blind,
            "reasons": [{"name": k, "n": v} for k, v in counts.most_common()]}


def period(crm, days):
    orders = crm.since(days)
    return {
        "days": days,
        "leads": len(orders),
        "won": sum(o["won"] for o in orders),
        "lost": sum(o["status"] == "lost" for o in orders),
        "open": sum(o["status"] == "open" for o in orders),
        "win_rate": win_rate(orders),
        "funnel": funnel(orders),
        "sources": breakdown(orders, "sources"),
        "came_via": breakdown(orders, "came_via", limit=8),
        "work_types": breakdown(orders, "work_types"),
        "losses": loss_reasons(orders),
        "missing": {
            "source": sum(not o["sources"] for o in orders),
            "work_type": sum(not o["work_types"] for o in orders),
            "came_via": sum(not o["came_via"] for o in orders),
        },
    }


def weekly(crm, weeks=26):
    start = week_start(crm.today) - timedelta(weeks=weeks - 1)
    rows = {start + timedelta(weeks=i): Counter() for i in range(weeks)}
    for o in crm.orders:
        if o["created"] and o["created"] >= start:
            c = rows[week_start(o["created"])]
            c["leads"] += 1
            c["won" if o["won"] else o["status"]] += 1
    return [{"week": w.isoformat(), "leads": c["leads"], "won": c["won"], "open": c["open"], "lost": c["lost"]}
            for w, c in rows.items()]


def months_back(today, n):
    y, m = today.year, today.month
    out = []
    for _ in range(n):
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
    return out[::-1]


def monthly(crm, n=13):
    keys = months_back(crm.today, n)
    rows = {k: Counter() for k in keys}
    for o in crm.orders:
        k = o["created"].strftime("%Y-%m") if o["created"] else None
        if k in rows:
            rows[k]["leads"] += 1
            rows[k]["won"] += o["won"]
            rows[k]["lost"] += o["status"] == "lost"
    for p in crm.t["payments"] or []:
        d = local_day(p["paid_at"])
        k = d.strftime("%Y-%m") if d else None
        if k not in rows:
            continue
        if p["kind"] == "payment":
            rows[k]["received"] += p["amount"] or 0
            rows[k]["tips"] += p["tip"] or 0
            rows[k]["payments"] += 1
        else:
            rows[k]["costs"] += -(p["amount"] or 0)
    return [{"month": k, "leads": c["leads"], "won": c["won"], "lost": c["lost"], "payments": c["payments"],
             "received": money(c["received"]), "tips": money(c["tips"]), "costs": money(c["costs"])}
            for k, c in rows.items()]


def money_kpis(crm):
    today = crm.today
    month_start = today.replace(day=1)
    prev_end = month_start - timedelta(days=1)
    prev_start = prev_end.replace(day=1)
    prev_same = prev_start + timedelta(days=min(today.day, prev_end.day) - 1)
    sums = Counter()
    for p in crm.t["payments"] or []:
        if p["kind"] != "payment":
            continue
        d = local_day(p["paid_at"])
        if d and month_start <= d <= today:
            sums["mtd"] += p["amount"] or 0
        if d and prev_start <= d <= prev_same:
            sums["prev_mtd"] += p["amount"] or 0
        if d and prev_start <= d <= prev_end:
            sums["prev_month"] += p["amount"] or 0
        if d and today - timedelta(days=89) <= d <= today:
            sums["d90"] += p["amount"] or 0
            sums["d90_n"] += 1
    return {"mtd": money(sums["mtd"]), "prev_mtd": money(sums["prev_mtd"]), "prev_month": money(sums["prev_month"]),
            "avg_payment_90": money(sums["d90"] / sums["d90_n"]) if sums["d90_n"] else None}


def lead_kpis(crm):
    def count(a, b):
        return sum(1 for o in crm.orders if o["created"] and crm.today - timedelta(days=b) < o["created"]
                   <= crm.today - timedelta(days=a))
    open_orders = [o for o in crm.orders if o["status"] == "open"]
    in_work = [o for o in crm.orders if o["status"] == "in_work"]
    return {
        "leads_7": count(0, 7), "leads_prev_7": count(7, 14),
        "leads_30": count(0, 30), "leads_prev_30": count(30, 60),
        "open": len(open_orders),
        "open_fresh": sum(1 for o in open_orders if o["created"] and (crm.today - o["created"]).days < 14),
        "in_work": len(in_work),
        "in_work_quoted": money(sum(o["quote"] or 0 for o in in_work)),
    }


def stages_now(crm):
    rows = []
    for stage in crm.stage_order:
        orders = [o for o in crm.orders if o["stage"] == stage and o["status"] in ("open", "in_work")]
        if not orders:
            continue
        limit = STUCK_DAYS.get(stage)
        rows.append({
            "stage": stage,
            "group": crm.stage_info[stage]["stage_group"],
            "status": orders[0]["status"],
            "n": len(orders),
            "quoted": money(sum(o["quote"] or 0 for o in orders)),
            "median_days": median(o["days_in_stage"] for o in orders),
            "stuck": sum(1 for o in orders if limit and (o["days_in_stage"] or 0) > limit),
            "stuck_after": limit,
        })
    return rows


def appointments(crm):
    upcoming, missed = [], []
    for a in crm.t["appointments"] or []:
        when = ts(a["scheduled_at"])
        if a["status"] != "scheduled" or when is None:
            continue
        o = crm.by_id.get(a["order_id"]) or {}
        row = {"order_no": a["order_no"], "type": a["type"], "at": a["scheduled_at"],
               "executor": a["executor"], "work_types": o.get("work_types"), "item": o.get("item"),
               "stage": o.get("stage")}
        # A visit still "scheduled" on a past day was missed or not marked; today's stay in the plan.
        if when.astimezone(TZ).date() < crm.today:
            missed.append(row)
        elif when <= crm.now + timedelta(days=14):
            upcoming.append(row)
    upcoming.sort(key=lambda r: r["at"])
    missed.sort(key=lambda r: r["at"])
    return upcoming, missed


def workshop(crm):
    rows = crm.t["work_time"] or []
    start = crm.today - timedelta(days=29)
    by_worker = defaultdict(lambda: {"hours": 0.0, "orders": set(), "weeks": Counter()})
    first_week = week_start(crm.today) - timedelta(weeks=5)
    for r in rows:
        d = local_day(r["started_at"])
        name = r["worker"] or UNSET
        if d and d >= first_week:
            by_worker[name]["weeks"][week_start(d).isoformat()] += r["hours"] or 0
        if d and d >= start:
            by_worker[name]["hours"] += r["hours"] or 0
            by_worker[name]["orders"].add(r["order_id"])
    weeks = [(first_week + timedelta(weeks=i)).isoformat() for i in range(6)]
    workers = [{"worker": w, "hours_30": round(v["hours"], 1), "orders_30": len(v["orders"]),
                "weeks": [round(v["weeks"][k], 1) for k in weeks]}
               for w, v in sorted(by_worker.items(), key=lambda kv: -kv[1]["hours"]) if sum(v["weeks"].values()) > 0.05]

    hours_by_order = defaultdict(float)
    for r in rows:
        hours_by_order[r["order_id"]] += r["hours"] or 0
    by_type = defaultdict(lambda: {"orders": 0, "hours": 0.0, "paid_hours": 0.0, "received": 0.0})
    for order_id, hours in hours_by_order.items():
        o = crm.by_id.get(order_id)
        if not o or hours <= 0:
            continue
        t = split(o["work_types"])[0]
        by_type[t]["orders"] += 1
        by_type[t]["hours"] += hours
        if o["paid"] > 0:
            by_type[t]["paid_hours"] += hours
            by_type[t]["received"] += o["paid"]
    types = [{"work_type": t, "orders": v["orders"], "hours": round(v["hours"], 1),
              "hours_per_order": round(v["hours"] / v["orders"], 1),
              "per_hour": round(v["received"] / v["paid_hours"]) if v["paid_hours"] >= 1 else None}
             for t, v in sorted(by_type.items(), key=lambda kv: -kv[1]["hours"])]
    since = min((local_day(r["started_at"]) for r in rows if r["started_at"]), default=None)
    return {"weeks": weeks, "workers": workers, "work_types": types, "since": since.isoformat() if since else None}


def speed(crm):
    first_quote = {}
    for e in crm.t["estimates"] or []:
        if e["sent_at"] and (e["order_id"] not in first_quote or e["sent_at"] < first_quote[e["order_id"]]):
            first_quote[e["order_id"]] = e["sent_at"]
    to_quote = []
    for order_id, sent in first_quote.items():
        o = crm.by_id.get(order_id)
        if o and o["created_at"] and ts(sent) >= ts(o["created_at"]):
            to_quote.append((ts(sent) - ts(o["created_at"])).total_seconds() / 3600)

    won_stages = {s for s in crm.stage_order if order_status(s, crm.stage_info[s]["stage_group"]) in ("in_work", "done")}
    first_won = {}
    for h in crm.t["stage_history"] or []:
        if h["to_stage"] in won_stages and h["effective_at"]:
            if h["order_id"] not in first_won or h["effective_at"] < first_won[h["order_id"]]:
                first_won[h["order_id"]] = h["effective_at"]
    to_order = []
    for order_id, at in first_won.items():
        o = crm.by_id.get(order_id)
        # Only orders that came in while the history was recorded, so the start is real.
        if o and o["created_at"] and ts(o["created_at"]).microsecond and ts(at) >= ts(o["created_at"]):
            to_order.append((ts(at) - ts(o["created_at"])).total_seconds() / 86400)

    in_shop = [(ts(o["left_shop_at"]) - ts(o["received_at_shop"])).total_seconds() / 86400
               for o in crm.orders if o["received_at_shop"] and o["left_shop_at"]
               and ts(o["left_shop_at"]) >= ts(o["received_at_shop"])]
    return {"hours_to_quote": median(to_quote), "hours_to_quote_n": len(to_quote),
            "days_to_order": median(to_order), "days_to_order_n": len(to_order),
            "days_in_shop": median(in_shop), "days_in_shop_n": len(in_shop)}


def weeks_back(crm, n=12):
    first = week_start(crm.today) - timedelta(weeks=n - 1)
    return [(first + timedelta(weeks=i)).isoformat() for i in range(n)]


def messages_metrics(crm, attention):
    weekly, replies = crm.t["agg_messages_weekly"], crm.t["agg_messages_replies"]
    if weekly is None or replies is None:
        return None
    by_week = {r["week"]: r for r in weekly}
    r = replies[0] if replies else {}
    for w in crm.t["agg_messages_waiting"] or []:
        o = next((x for x in crm.orders if x["order_no"] == w["order_no"]), None)
        if o and o["status"] in ("open", "in_work"):
            attention.append(attention_row(o, "client_waiting", f"{round(w['hours'] or 0)} ч без ответа"))
    rate = lambda v: round(v, 3) if v is not None else None
    return {
        "weeks": [{"week": k, "in": (by_week.get(k) or {}).get("n_in", 0), "out": (by_week.get(k) or {}).get("n_out", 0),
                   "auto": (by_week.get(k) or {}).get("n_auto", 0)} for k in weeks_back(crm)],
        "channels": [{"name": c["name"], "n": c["n"]} for c in sorted(crm.t["agg_messages_channels"] or [], key=lambda c: -c["n"])[:8]],
        "reply_hours_median": round(r["median_hours"], 1) if r.get("median_hours") is not None else None,
        "replies_n": r.get("replies") or 0,
        "reply_within_1h": rate(r.get("within_1h")), "reply_within_24h": rate(r.get("within_24h")),
    }


def site_metrics(crm):
    weekly, totals = crm.t["agg_site_weekly"], crm.t["agg_site_totals"]
    if weekly is None or totals is None:
        return None
    by_week = {r["week"]: r for r in weekly}
    total = totals[0] if totals else {}

    def table(name):
        rows = sorted(crm.t[name] or [], key=lambda r: -r["visits"])
        return [{"name": r["name"], "visits": r["visits"], "orders": r["orders"],
                 "rate": round(r["orders"] / r["visits"], 4) if r["visits"] else None} for r in rows]
    return {"weeks": [{"week": k, "visits": (by_week.get(k) or {}).get("visits", 0), "orders": (by_week.get(k) or {}).get("orders", 0)}
                      for k in weeks_back(crm)],
            "visits_90": total.get("visits", 0), "orders_90": total.get("orders", 0),
            "sources": table("agg_site_sources"), "devices": table("agg_site_devices"), "landings": table("agg_site_landings")}


def attention_row(o, reason, detail=None):
    return {"order_no": o["order_no"], "reason": reason, "detail": detail, "stage": o["stage"], "step": o["step"],
            "days_in_stage": o["days_in_stage"], "work_types": o["work_types"], "item": o["item"],
            "quote": o["quote"], "created": o["created"].isoformat() if o["created"] else None}


def attention_list(crm, missed):
    rows = []
    for o in crm.orders:
        if o["status"] not in ("open", "in_work"):
            continue
        days = o["days_in_stage"] or 0
        step = o["step"] or ""
        if o["status"] == "in_work" and o["deadline"] and day(o["deadline"]) < crm.today:
            rows.append(attention_row(o, "deadline", f"срок {o['deadline']}"))
        elif o["stage"] == "Under Review" or step in ("Photo Provided", "Appointment Request") \
                or (o["stage"] == "New Lead" and not step and (crm.today - o["created"]).days <= 14):
            rows.append(attention_row(o, "our_move", step or o["stage"]))
        elif o["stage"] == "Picked Up" and days > STUCK_DAYS["Picked Up"]:
            rows.append(attention_row(o, "long_in_shop"))
        elif o["status"] == "open" and step in QUOTE_STEPS and days > 7:
            rows.append(attention_row(o, "quote_silence", step))
        elif o["status"] == "open" and step.startswith("Photo Requested") and days > 14:
            rows.append(attention_row(o, "close_candidate", step))
    for a in missed:
        o = next((x for x in crm.orders if x["order_no"] == a["order_no"]), None)
        if o:
            rows.append(attention_row(o, "appointment", f"{a['type']}, {a['at'][:10]}"))
    return rows


def build(tables, run, now=None):
    now = now or datetime.now(timezone.utc)
    crm = Crm(tables, now)
    upcoming, missed = appointments(crm)
    attention = attention_list(crm, missed)
    messages = messages_metrics(crm, attention)
    attention.sort(key=lambda r: (ATTENTION[r["reason"]][0], -(r["days_in_stage"] or 0)))
    payments = tables["payments"] or []
    native = [p["paid_at"] for p in payments if p["note"] != MIGRATED_NOTE and p["paid_at"]]
    history = [h["effective_at"] for h in tables["stage_history"] or [] if h["effective_at"]]

    summary = {
        "generated_at": now.isoformat(timespec="seconds"),
        "tz": "America/Chicago",
        "schedule": list(SCHEDULE),
        "today": crm.today.isoformat(),
        "run": {k: run[k] for k in ("id", "status", "finished_at")} if run else None,
        "tables": {k: (len(tables[k]) if tables[k] is not None else None) for k in REQUIRED},
        "coverage": {
            "orders_from": min((o["created"] for o in crm.orders if o["created"]), default=None),
            "payments_native_from": local_day(min(native)) if native else None,
            "stage_history_from": local_day(min(history)) if history else None,
        },
        "kpi": {**lead_kpis(crm), **money_kpis(crm), "win_rate_90": win_rate(crm.since(90))},
        "periods": {str(d): period(crm, d) for d in WINDOWS},
        "weekly": weekly(crm),
        "monthly": monthly(crm),
        "stages": stages_now(crm),
        "speed": speed(crm),
        "workshop": workshop(crm),
        "messages": messages,
        "site": site_metrics(crm),
        "attention_counts": {k: sum(r["reason"] == k for r in attention) for k in ATTENTION},
        "attention_labels": {k: v[1] for k, v in ATTENTION.items()},
        "done_unpaid": sum(1 for o in crm.orders if o["status"] == "done" and o["paid"] <= 0
                           and native and o["created"] and o["created"] >= local_day(min(native))),
    }
    pipeline = {
        "generated_at": summary["generated_at"],
        "attention": attention[:150],
        "upcoming": upcoming,
    }
    return summary, pipeline


def default(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    raise TypeError(type(value))


def main():
    tables, run = load(data_dir() / "crm.sqlite")
    if not tables["orders"]:
        sys.exit("no orders in data/crm.sqlite: run `sync.py pull` first")
    summary, pipeline = build(tables, run)
    out = data_dir() / "dashboard"
    out.mkdir(parents=True, exist_ok=True)
    for name, doc in (("summary", summary), ("pipeline", pipeline)):
        text = json.dumps(doc, ensure_ascii=False, default=default, separators=(",", ":"))
        if len(text.encode()) > 250_000:
            sys.exit(f"{name}.json is {len(text.encode())} bytes, over the dashboard's 256 KiB document limit")
        (out / f"{name}.json").write_text(text)
        print(f"{name}.json: {len(text.encode()) // 1024} KiB")


if __name__ == "__main__":
    main()
