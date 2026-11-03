#!/usr/bin/env python3
"""Record ad and lead-platform spend by month for the dashboard's channel table (data/ad_spend.json).

    python3 crm-sync/spend.py set < month.json   -> replaces one platform's spend for one month
    python3 crm-sync/spend.py show               -> spend per month, platform and channel

month.json: {"month": "2026-11", "platform": "google", "source": "Supermetrics, 01–03.11",
             "rows": [{"campaign": "24106203053", "spend": 12.3}, ...]}

platform is google, meta or chatgpt (campaign = Google campaign id, or the campaign name as the ad
account shows it), or thumbtack, yelp or angi (one row, no campaign). Campaigns map to the channel
names that agg_order_channel gives orders, so spend and leads meet in the same row. A platform with
no file entry for a month counts as unknown on the dashboard, not as zero: send "rows": [] to record
a month with no spend.
"""

import json
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from analytics import data_dir  # noqa: E402

PLATFORMS = ("google", "meta", "chatgpt", "thumbtack", "yelp", "angi")
GOOGLE_CAMPAIGNS = {"24106203053": "furniture (основа)", "24106203050": "handbag (основа)",
                    "24260970664": "handbag тест", "23446219354": "Maps-Austin (PMax)",
                    "24354518552": "Training"}
META_CHANNELS = {"leadform - handbag - us": "Meta: форма сумок",
                 "leadform - furniture repair - austin": "Meta: форма мебели",
                 "lerega.com - handbag - us": "Meta: трафик сумки",
                 "lerega.com - course - us": "Meta: обучение (US)",
                 "lerega.com - course - us - rus": "Meta: обучение (rus)"}
LEAD_PLATFORMS = {"thumbtack": "Thumbtack", "yelp": "Yelp", "angi": "Angi"}


def channel_for(platform, campaign):
    """(channel, campaign) as the channel table names them."""
    campaign = str(campaign).strip() if campaign is not None else None
    if platform == "google":
        return "Google Ads", GOOGLE_CAMPAIGNS.get(campaign, campaign)
    if platform == "meta":
        name = META_CHANNELS.get((campaign or "").lower())
        return (name, None) if name else ("Meta: кампания не определена", campaign)
    if platform == "chatgpt":
        return "ChatGPT Ads", campaign
    return LEAD_PLATFORMS[platform], None


def set_month(doc, month, platform, rows, source=None, today=None):
    if platform not in PLATFORMS:
        raise ValueError(f"unknown platform {platform!r}; expected one of {', '.join(PLATFORMS)}")
    date.fromisoformat(month + "-01")  # YYYY-MM
    sums = {}
    for r in rows:
        key = channel_for(platform, r.get("campaign"))
        sums[key] = sums.get(key, 0) + float(r["spend"] or 0)
    m = doc.setdefault("months", {}).setdefault(month, {"platforms": [], "rows": [], "sources": {}})
    m["rows"] = [r for r in m["rows"] if r["platform"] != platform] + [
        {"platform": platform, "channel": c, "campaign": k, "spend": round(v, 2)} for (c, k), v in sorted(sums.items(), key=str)]
    m["platforms"] = sorted(set(m["platforms"]) | {platform})
    if source:
        m.setdefault("sources", {})[platform] = source
    doc["as_of"] = (today or date.today()).isoformat()
    return doc


def path():
    return data_dir() / "ad_spend.json"


def load():
    try:
        return json.loads(path().read_text())
    except (OSError, ValueError):
        return {}


def main(argv):
    if argv[:1] == ["set"]:
        spec = json.load(sys.stdin)
        doc = set_month(load(), spec["month"], spec["platform"], spec.get("rows") or [], spec.get("source"))
        path().parent.mkdir(parents=True, exist_ok=True)
        path().write_text(json.dumps(doc, ensure_ascii=False, indent=1))
        total = sum(r["spend"] for r in doc["months"][spec["month"]]["rows"] if r["platform"] == spec["platform"])
        print(f"{spec['month']} {spec['platform']}: ${total:,.2f}")
    elif argv[:1] == ["show"]:
        for month, m in sorted((load().get("months") or {}).items()):
            for r in m["rows"]:
                print(month, r["platform"], r["channel"], r["campaign"] or "", f"{r['spend']:.2f}", sep="\t")
            missing = [p for p in PLATFORMS if p not in m["platforms"]]
            if missing:
                print(month, "нет данных:", ", ".join(missing), sep="\t")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
