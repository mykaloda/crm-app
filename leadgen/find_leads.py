#!/usr/bin/env python3
"""Daily B2B lead finder for Lerega, built on the ScrapeGraphAI SearchScraper API.

Commands
  check                 verify SGAI_API_KEY and show remaining credits
  plan [--date D]       print today's search plan (segment x area), JSON
  search [--date D]     run today's plan through ScrapeGraph and add new leads to the table
  add FILE.json         add leads found by another source (same fields as LEAD_FIELDS)
  sheet [--date D]      print the day's new leads as CSV with Russian headers (for Google Sheets)

Output
  data/leads.csv              master table, every lead ever found (dedup memory)
  data/daily/YYYY-MM-DD.csv   only the leads that are new today

Only the Python standard library is used. The API key is read from SGAI_API_KEY
(or injected by the cloud proxy when stored as a network secret for api.scrapegraphai.com).
"""
import argparse
import csv
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config  # noqa: E402

API = "https://api.scrapegraphai.com/v1"
ROOT = Path(__file__).resolve().parent.parent
MASTER = ROOT / "data" / "leads.csv"
DAILY_DIR = ROOT / "data" / "daily"

LEAD_FIELDS = ["name", "website", "phone", "email", "address", "city", "instagram", "description"]
COLUMNS = [
    "date_found", "line", "segment", "name", "fit_score", "city", "address", "phone", "email", "contact_name",
    "website", "instagram", "description", "partnership_pitch", "source", "source_url", "status",
]

OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "businesses": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Business name"},
                    "website": {"type": "string", "description": "Official website URL"},
                    "phone": {"type": "string", "description": "Public business phone"},
                    "email": {"type": "string", "description": "Public business email, if listed"},
                    "address": {"type": "string", "description": "Street address"},
                    "city": {"type": "string"},
                    "instagram": {"type": "string", "description": "Instagram handle or URL"},
                    "description": {"type": "string", "description": "One line: what they do and why they fit"},
                    "source_url": {"type": "string", "description": "Page where this business was found"},
                },
                "required": ["name"],
            },
        }
    },
    "required": ["businesses"],
}


# ---------------------------------------------------------------- plan
def todays_plan(day: dt.date):
    """Every day covers all three lines (Commercial twice: highest value per client),
    rotating segments and areas so each day searches new ground."""
    n = day.toordinal()
    by_line = {}
    for key, seg in config.SEGMENTS.items():
        by_line.setdefault(seg["line"], []).append(key)
    plan = []
    for i, line in enumerate(config.DAILY_LINES[: config.QUERIES_PER_DAY]):
        segs = by_line[line]
        slot = n * config.DAILY_LINES.count(line) + config.DAILY_LINES[:i].count(line)
        seg = segs[slot % len(segs)]
        area = config.AREAS[(n * 3 + i) % len(config.AREAS)]
        plan.append({"segment": seg, "area": area, "line": line,
                     "query": f"{config.SEGMENTS[seg]['query']} in {area}",
                     "maps_query": f"{config.SEGMENTS[seg]['maps']} {area}"})
    return plan


def prompt_for(item):
    return (
        f"Find real, currently operating {item['query']}. "
        "List up to 10 businesses. For each give name, official website, public business phone, "
        "public business email if listed, street address, city, Instagram, and one line about what they do. "
        "Only include businesses you found on the pages; do not invent contact details - leave a field empty if unknown."
    )


# ---------------------------------------------------------------- ScrapeGraph
def api_key():
    # SGAI_API_KEY from the environment, or a placeholder when the key is stored as a
    # network secret and the egress proxy injects the real SGAI-APIKEY header.
    return os.environ.get("SGAI_API_KEY") or os.environ.get("SCRAPEGRAPH_API_KEY") or "injected-by-proxy"


def call(method, path, body=None, timeout=180):
    req = urllib.request.Request(
        API + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"SGAI-APIKEY": api_key(), "Content-Type": "application/json", "accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"ScrapeGraph {method} {path}: HTTP {e.code} {e.read().decode()[:300]}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"ScrapeGraph unreachable ({e.reason}). Is api.scrapegraphai.com allowed by the network policy?")


def searchscraper(prompt):
    res = call("POST", "/searchscraper", {
        "user_prompt": prompt,
        "num_results": config.SITES_PER_QUERY,
        "extraction_mode": True,
        "output_schema": OUTPUT_SCHEMA,
        "location_geo_code": "us",
    })
    # Long searches come back as "queued"/"running": poll by request_id.
    for _ in range(40):
        if res.get("status") in ("completed", "failed") or res.get("result"):
            break
        time.sleep(6)
        res = call("GET", f"/searchscraper/{res['request_id']}")
    if res.get("status") == "failed" or res.get("error"):
        raise RuntimeError(f"SearchScraper failed: {res.get('error')}")
    result = res.get("result") or {}
    if isinstance(result, str):
        result = json.loads(result)
    refs = res.get("reference_urls") or []
    leads = result.get("businesses", []) if isinstance(result, dict) else []
    for lead in leads:
        if not lead.get("source_url") and refs:
            lead["source_url"] = refs[0]
    return leads


# ---------------------------------------------------------------- table
def norm_domain(url):
    url = (url or "").lower().strip()
    url = re.sub(r"^https?://", "", url)
    url = re.sub(r"^www\.", "", url)
    return url.split("/")[0]


def norm_name(name):
    name = (name or "").lower()
    name = re.sub(r"\b(llc|inc|co|the|company|ltd)\b", "", name)
    return re.sub(r"[^a-z0-9]", "", name)


def norm_phone(p):
    d = re.sub(r"\D", "", p or "")
    return d[-10:] if len(d) >= 10 else ""


SOCIAL = ("facebook.com", "instagram.com", "yelp.com", "google.com", "linkedin.com", "nextdoor.com", "thumbtack.com", "angi.com")


def keys_of(row):
    keys = set()
    d = norm_domain(row.get("website"))
    if d and not d.endswith(SOCIAL):
        keys.add("d:" + d)
    if norm_name(row.get("name")):
        keys.add("n:" + norm_name(row.get("name")))
    if norm_phone(row.get("phone")):
        keys.add("p:" + norm_phone(row.get("phone")))
    return keys


def load_master():
    if not MASTER.exists():
        return []
    with MASTER.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def save_master(rows):
    """Rewrite the whole master table (small file), so new columns never misalign."""
    MASTER.parent.mkdir(parents=True, exist_ok=True)
    with MASTER.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def score(row, segment):
    s = config.SEGMENTS[segment]["weight"] * 6          # up to 60
    city = (row.get("city") or row.get("address") or "").lower()
    if any(c in city for c in config.CORE_CITIES):
        s += 15
    s += 10 if norm_phone(row.get("phone")) else 0
    s += 8 if row.get("email") else 0
    s += 5 if row.get("website") else 0
    s += 2 if row.get("instagram") else 0
    return min(s, 100)


def clean(v):
    v = (v or "").strip()
    return "" if v.lower() in ("n/a", "na", "none", "null", "unknown", "not listed", "-") else v


def add_leads(found, day, source):
    """found: list of (segment, lead dict). Returns the new rows written."""
    master = load_master()
    known = [norm_name(n) for n in config.KNOWN_NAMES if norm_name(n)]
    seen = set()
    for r in master:
        seen |= keys_of(r)

    new_rows = []
    for segment, lead in found:
        if segment not in config.SEGMENTS:
            print(f"skip: unknown segment {segment!r}", file=sys.stderr)
            continue
        row = {k: clean(str(lead.get(k) or "")) for k in LEAD_FIELDS + ["source_url"]}
        if not row["name"]:
            continue
        k = keys_of(row)
        if k & seen or any(kn in norm_name(row["name"]) for kn in known):
            continue
        seen |= k
        row.update({
            "date_found": day.isoformat(),
            "line": config.SEGMENTS[segment]["line"],
            "segment": segment,
            "fit_score": score(row, segment),
            "partnership_pitch": config.SEGMENTS[segment]["pitch"],
            "source": lead.get("source") or source,
            "status": "New",
        })
        new_rows.append(row)

    # Best first, but keep every line represented: at most MAX_PER_LINE per line per day,
    new_rows.sort(key=lambda r: -int(r["fit_score"]))
    # and at most MAX_PER_SEGMENT per segment, so restaurants don't crowd out hotels.
    per_line, per_seg, kept = {}, {}, []
    for r in new_rows:
        if per_line.get(r["line"], 0) < config.MAX_PER_LINE and per_seg.get(r["segment"], 0) < config.MAX_PER_SEGMENT:
            per_line[r["line"]] = per_line.get(r["line"], 0) + 1
            per_seg[r["segment"]] = per_seg.get(r["segment"], 0) + 1
            kept.append(r)
    new_rows = kept

    save_master(master + new_rows)

    DAILY_DIR.mkdir(parents=True, exist_ok=True)
    daily = DAILY_DIR / f"{day.isoformat()}.csv"
    existing = []
    if daily.exists():
        with daily.open(newline="", encoding="utf-8") as f:
            existing = list(csv.DictReader(f))
    with daily.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        w.writeheader()
        w.writerows(existing + new_rows)
    return new_rows


def summary(rows, day):
    by_line = {}
    for r in rows:
        by_line[r["line"]] = by_line.get(r["line"], 0) + 1
    top = [f"{r['name']} ({r['city'] or r['segment']}, {r['fit_score']})" for r in rows[:3]]
    return {
        "date": day.isoformat(),
        "new_leads": len(rows),
        "by_line": by_line,
        "top": top,
        "daily_file": str((DAILY_DIR / f"{day.isoformat()}.csv").relative_to(ROOT)),
        "master_total": len(load_master()),
    }


# ---------------------------------------------------------------- Google Sheet export
SHEET_HEADERS = {
    "fit_score": "Оценка", "line": "Направление", "segment": "Сегмент", "name": "Компания",
    "city": "Город", "phone": "Телефон", "email": "Email", "website": "Сайт", "address": "Адрес",
    "instagram": "Instagram", "description": "Описание", "partnership_pitch": "Что предложить",
    "email_subject": "Тема письма", "email_body": "Письмо",
    "status": "Статус", "date_found": "Найдено", "source": "Источник", "source_url": "Ссылка",
}
LINE_RU = {"Commercial": "Коммерция", "Furniture": "Мебель", "Handbags": "Сумки"}


def sheet_csv(day):
    """Today's new leads as CSV with Russian headers, ready to upload as a Google Sheet."""
    import io
    path = DAILY_DIR / f"{day.isoformat()}.csv"
    rows = list(csv.DictReader(path.open(encoding="utf-8"))) if path.exists() else []
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(SHEET_HEADERS.values())
    import outreach
    master = {r["name"]: r for r in load_master()}
    for r in rows:
        r = dict(r, **{k: v for k, v in master.get(r["name"], {}).items() if v})  # latest email/status
        subject, body = outreach.render(r["segment"], r["name"], r.get("contact_name") or "")
        r = dict(r, line=LINE_RU.get(r["line"], r["line"]), status="Новый" if r["status"] == "New" else r["status"],
                 email_subject=subject, email_body=body)
        w.writerow([r.get(k, "") for k in SHEET_HEADERS])
    return buf.getvalue()


# ---------------------------------------------------------------- CLI
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["check", "plan", "search", "add", "sheet"])
    ap.add_argument("file", nargs="?", help="JSON file for 'add': [{segment, name, website, ...}]")
    ap.add_argument("--date", help="YYYY-MM-DD, default today (America/Chicago)")
    ap.add_argument("--source", default="web search", help="source label for 'add'")
    a = ap.parse_args()

    if a.date:
        day = dt.date.fromisoformat(a.date)
    else:
        from zoneinfo import ZoneInfo
        day = dt.datetime.now(ZoneInfo("America/Chicago")).date()

    if a.command == "check":
        print(json.dumps(call("GET", "/credits"), indent=2))
    elif a.command == "plan":
        print(json.dumps(todays_plan(day), indent=2, ensure_ascii=False))
    elif a.command == "search":
        found, errors = [], []
        for item in todays_plan(day):
            try:
                leads = searchscraper(prompt_for(item))
                print(f"{item['segment']:<20} {item['area']:<38} {len(leads)} found", file=sys.stderr)
                found += [(item["segment"], l) for l in leads]
            except RuntimeError as e:
                errors.append(str(e))
                print(f"{item['segment']}: {e}", file=sys.stderr)
        if errors and not found:
            sys.exit("All ScrapeGraph searches failed:\n" + "\n".join(errors))
        rows = add_leads(found, day, "ScrapeGraph")
        out = summary(rows, day)
        out["errors"] = errors
        print(json.dumps(out, indent=2, ensure_ascii=False))
    elif a.command == "sheet":
        sys.stdout.write(sheet_csv(day))
    elif a.command == "add":
        if not a.file:
            sys.exit("add needs a JSON file")
        data = json.loads(Path(a.file).read_text(encoding="utf-8"))
        rows = add_leads([(d.get("segment"), d) for d in data], day, a.source)
        print(json.dumps(summary(rows, day), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
