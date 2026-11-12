#!/usr/bin/env python3
"""Convert map search results (Firecrawl maps `businesses/search`) into lead JSON for `find_leads.py add`.

Fallback for days when ScrapeGraph is unavailable.

Input:  JSON list of {"segment": "<config segment>", "results": [<place>, ...]}
        (place = name, address, phone, website, categories, rating, review_count, maps_url)
Output: JSON list of leads on stdout.

    python3 leadgen/from_maps.py maps.json > leads.json
    python3 leadgen/find_leads.py add leads.json --source "Google Maps"
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config  # noqa: E402


def city_of(address):
    m = re.search(r",\s*([^,]+),\s*TX\b", address or "")
    return m.group(1).strip() if m else ""


def is_competitor(place):
    cats = " ".join(place.get("categories") or []).lower()
    return any(c in cats for c in config.COMPETITOR_CATEGORIES)


def strip_utm(url):
    return re.sub(r"\?.*$", "", url or "")


def convert(groups):
    out = []
    for g in groups:
        seg = g["segment"]
        for p in g.get("results") or []:
            name_l = (p.get("name") or "").lower()
            if is_competitor(p) or (p.get("rating") or 5) < 3.5 or any(c in name_l for c in config.CHAIN_NAMES):
                continue
            cats = ", ".join((p.get("categories") or [])[:3])
            rating = f"{p['rating']}★ ({p.get('review_count') or 0} reviews)" if p.get("rating") else ""
            summary = p.get("editorial_summary") or ""
            out.append({
                "segment": p.get("segment") or seg,
                "name": p.get("name"),
                "website": strip_utm(p.get("website")),
                "phone": p.get("phone"),
                "email": "",
                "address": p.get("address"),
                "city": city_of(p.get("address")),
                "instagram": p.get("website") if "instagram.com" in (p.get("website") or "") else "",
                "description": "; ".join(x for x in [cats, rating, summary] if x),
                "source_url": p.get("maps_url"),
            })
    return out


if __name__ == "__main__":
    groups = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    json.dump(convert(groups), sys.stdout, indent=2, ensure_ascii=False)
