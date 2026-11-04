#!/usr/bin/env python3
"""Personalized first emails for leads, one template per segment.

Commands
  drafts [--date D]     build drafts for leads that have an email and were not emailed yet
                        -> data/outreach/drafts-D.json (what will be sent, for review)
  log FILE.json         record sent emails in data/outreach.csv  [{name, email, subject, message_id}]
  preview SEGMENT       print one template filled with sample values

Sending itself is done by Claude through the Zoho Mail connection (Zapier), only after the owner
approves the drafts. This script never sends anything.
"""
import argparse
import csv
import datetime as dt
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MASTER = ROOT / "data" / "leads.csv"
OUT_DIR = ROOT / "data" / "outreach"
SENT_LOG = ROOT / "data" / "outreach.csv"

# ---------------------------------------------------------------- sender
# Facts below are from lerega.com (Nov 2026). Change here, not in the templates.
SENDER = {
    "from": "Dillon at Lerega<dillon@lerega.com>",
    "name": "Dillon",
    "phone": "(737) 247-7484",
    "site": "lerega.com",
    "address": "3307B Ranch Rd 620 N, Austin, TX 78734",
}
# Introduce only the side of the business that matters to this partner.
INTRO = {
    "Handbags": "Lerega, a handbag and leather repair studio in Lakeway",
    "Furniture": "Lerega, an upholstery and leather furniture repair shop here in Lakeway",
    "Commercial": "Lerega, an upholstery and leather repair shop here in Lakeway",
}
PROOF = "11+ years and 5,200+ pieces restored"

SIGNATURE = """{name}
{phone}
dillon@lerega.com"""

OPT_OUT = 'Not relevant for you? Just reply "no" and I won\'t write again.'

# ---------------------------------------------------------------- templates
# {greeting} {business} {me} {intro} {proof} are filled in per lead.
TEMPLATES = {
    "restaurant_bar": {
        "ru": "Рестораны и бары: кабинки и барные стулья, ремонт без закрытия.",
        "subject": "Booth and seating repair",
        "body": """{greeting}

I'm {me} with {intro}. We repair and reupholster restaurant booths, banquettes and bar stools, usually overnight or on a day you're closed.

If any of your seating is torn or worn, send me a couple of photos and I'll get back to you with a price the same day.""",
    },
    "hotel_venue": {
        "ru": "Отели и площадки: лобби, банкетные стулья, кожа; работаем партиями.",
        "subject": "Furniture reupholstery",
        "body": """{greeting}

I'm {me} with {intro}. We reupholster lobby furniture, banquet and guest-room chairs, and restore leather pieces. We can work in small batches so rooms and event spaces stay open.

If you have pieces that need work, I'd be glad to stop by and take a look. The estimate is free.""",
    },
    "office_coworking": {
        "ru": "Офисы и коворкинги: ремонт кресел дешевле замены.",
        "subject": "Office chair repair",
        "body": """{greeting}

I'm {me} with {intro}. We repair and re-cover office chairs and lounge furniture, which usually costs much less than buying new. We can pick up and bring everything back.

If you send me photos of the pieces that need work, I'll get you prices.""",
    },
    "property_manager": {
        "ru": "Управляющие недвижимостью и Airbnb: быстрый ремонт между гостями.",
        "subject": "Furniture repair for your units",
        "body": """{greeting}

I'm {me} with {intro}. When a sofa or chair in one of your units gets damaged, we pick it up, repair it and bring it back, often faster than ordering a new one. We also do better pricing for multiple properties.

Who on your team would be the right person to talk to about this?""",
    },
    "medical_salon": {
        "ru": "Салоны, барбершопы, клиники: перетяжка кресел с минимальным простоем.",
        "subject": "Chair reupholstery",
        "body": """{greeting}

I'm {me} with {intro}. We repair and re-cover cracked vinyl and leather on styling, barber and treatment chairs, so you don't have to replace them, and the chair is out for as short a time as possible.

If you send me a photo of one of the chairs, I'll tell you what it would cost.""",
    },
    "vehicle_marine": {
        "ru": "Авто, RV, лодки, прокат: ремонт салона, чтобы продавать дороже.",
        "subject": "Seat and interior leather repair",
        "body": """{greeting}

I'm {me} with {intro}. We repair torn, cracked and faded seats and interior leather in cars, RVs and boats, which helps used units sell faster. We have dealer and fleet pricing.

Would you be open to a quick call this week?""",
    },
    "interior_designer": {
        "ru": "Дизайнеры интерьера: мы — их мастерская; цена для дизайнеров и реферальное вознаграждение.",
        "subject": "Upholstery for your projects",
        "body": """{greeting}

I'm {me} with {intro}. A lot of clients have pieces they want to keep but refresh, and we'd be happy to be the workroom you send them to: reupholstery, leather repair and restoration. We offer designers trade pricing and a referral fee.

Would it help if I sent you a few before-and-after photos of our work?""",
    },
    "furniture_store": {
        "ru": "Мебельные магазины: повреждения при доставке и гарантия — ремонт дешевле замены.",
        "subject": "Furniture repair for delivery damage and warranty claims",
        "body": """{greeting}

I'm {me} with {intro}. When a piece gets damaged in delivery or a customer files a warranty claim, we can usually repair it for less than replacing it. We also touch up floor models.

Who handles service and warranty on your side? I'd like to send them our details.""",
    },
    "antique_consignment": {
        "ru": "Антиквариат и комиссионки: реставрация перед продажей; скидка их покупателям.",
        "subject": "Furniture restoration before resale",
        "body": """{greeting}

I'm {me} with {intro}. Re-covering a dated chair or restoring worn leather often helps a piece sell faster and for more. And when a buyer loves a piece but not the fabric, we can help them with that too.

Would you mind if I left a few cards at your store, with a discount for your buyers?""",
    },
    "moving_company": {
        "ru": "Переезды: ремонт повреждённой мебели дешевле выплаты по претензии.",
        "subject": "Repair for furniture damaged in moves",
        "body": """{greeting}

I'm {me} with {intro}. When a customer's sofa or chair gets torn or scuffed in a move, repairing it is usually cheaper than paying out the claim. We turn things around quickly and can pick up.

Could I send our contact to whoever handles claims?""",
    },
    "builder_remodeler": {
        "ru": "Строители и ремонт: подушки, банкетки, встроенные диваны на заказ.",
        "subject": "Custom cushions and banquettes",
        "body": """{greeting}

I'm {me} with {intro}. We make custom seat cushions, banquettes, window seats and headboards, and re-cover built-in seating.

If you have a project coming up where this could fit, I'd be glad to help.""",
    },
    "luxury_resale": {
        "ru": "Перепродажа люксовых сумок: восстановление перед продажей, цена за сумку.",
        "subject": "Handbag restoration",
        "body": """{greeting}

I'm {me} with {intro}. We restore designer bags (Louis Vuitton, Chanel, Gucci and others): edges, handles, corners, lining and color.

If you have bags that need some work before they go on the floor, send me photos and I'll quote them for free. We also have per-bag pricing for resellers.""",
    },
    "shoe_repair_tailor": {
        "ru": "Ремонт обуви и ателье: обмен клиентами (им — обувь, нам — сумки).",
        "subject": "Handbag repair referrals",
        "body": """{greeting}

I'm {me} with {intro}. If customers ever bring you bags you'd rather not take on, feel free to send them our way, and we'll send you the shoe and garment work we don't do.

Would that work for you?""",
    },
    "dry_cleaner": {
        "ru": "Химчистки: точка приёма сумок, комиссия с каждого заказа.",
        "subject": "Handbag repair and cleaning",
        "body": """{greeting}

I'm {me} with {intro}. Your customers could drop off handbags and leather items at your counter, and we'd pick them up, repair or clean them and bring them back. You'd earn a commission on every order.

Could I stop by sometime and walk you through it? It takes about ten minutes.""",
    },
    "boutique_bridal": {
        "ru": "Бутики и свадебные салоны: скидочная карта для их клиентов.",
        "subject": "Handbag care for your customers",
        "body": """{greeting}

I'm {me} with {intro}. We repair and restore handbags and leather accessories, and we'd like to offer your customers a discount card. It's a nice extra for them and no work for you.

Would it be okay if I dropped off a few cards?""",
    },
}

FOLLOW_UP = {
    "subject": "Re: {subject}",
    "body": """{greeting}

Just following up on my note below. If it's easier, reply with a photo and I'll send a price, no commitment.""",
}


# ---------------------------------------------------------------- build
def clean_business(name):
    # "Uptown Cheapskate Round Rock" stays; drop " - Lakeway" style suffixes and "LLC".
    name = name.split(" - ")[0]
    for suffix in (" LLC", ", LLC", " Inc"):
        name = name.replace(suffix, "")
    return name.strip()


def render(segment, business, contact_name=""):
    t = TEMPLATES[segment]
    business = clean_business(business)
    team = business[4:] if business.startswith("The ") else business
    greeting = f"Hi {contact_name}," if contact_name else f"Hi {team} team,"
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import config
    intro = INTRO[config.SEGMENTS[segment]["line"]]
    fill = dict(business=business, greeting=greeting, me=SENDER["name"], intro=intro, proof=PROOF)
    subject = t["subject"].format(**fill)
    body = t["body"].format(**fill)
    body += "\n\n" + SIGNATURE.format(**SENDER)
    return subject, body


# ---------------------------------------------------------------- HTML (how the email is actually sent)
# Same look as Dillon's regular emails in Zoho: Verdana 10pt, Zoho signature "Main" (logo, name, phone, email),
# The owner asked for no extra footer below the signature.
FONT = "font-family: Verdana, Arial, Helvetica, sans-serif; font-size: 10pt"
ORANGE = "rgb(245, 130, 32)"
FOOTER = (
    '<div style="font-family: Verdana, Arial, Helvetica, sans-serif; font-size: 8pt; line-height: 1.6; color: #8a8a8a">'
    f'<span style="color: {ORANGE}">Furniture · Leather · Handbags · Car, RV &amp; Boat · Commercial</span><br>'
    "11+ years · 5,200+ pieces restored · Pickup &amp; delivery available<br>"
    '3307B Ranch Rd 620 N, Austin, TX 78734 · '
    f'<a href="https://lerega.com/?Email" style="color: {ORANGE}; text-decoration: none">lerega.com</a><br>'
    "Not relevant for you? Just reply &quot;no&quot; and I won&#39;t write again."
    "</div>"
)


def render_html(segment, business, contact_name=""):
    import html
    subject, text = render(segment, business, contact_name)
    message = text.split("\n\n" + SIGNATURE.split("\n")[0].format(**SENDER) + "\n")[0]  # body without text signature
    paras = "".join(f"<div>{html.escape(p, quote=False).replace(chr(10), '<br>')}<br></div><div><br></div>" for p in message.split("\n\n"))
    signature = (Path(__file__).with_name("signature.html")).read_text(encoding="utf-8").strip()
    body = f'<div><div style="{FONT}">{paras}{signature}</div></div>'
    return subject, body


def sent_emails():
    if not SENT_LOG.exists():
        return set()
    with SENT_LOG.open(encoding="utf-8") as f:
        return {r["email"].lower() for r in csv.DictReader(f)}


def build_drafts(day):
    done = sent_emails()
    drafts = []
    with MASTER.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            email = (r.get("email") or "").strip()
            if not email or email.lower() in done or r.get("status") not in ("New", "Новый", ""):  # "Draft in Zoho" = already prepared
                continue
            subject, body = render(r["segment"], r["name"], r.get("contact_name") or "")
            _, html_body = render_html(r["segment"], r["name"], r.get("contact_name") or "")
            drafts.append({"name": r["name"], "segment": r["segment"], "line": r["line"],
                           "from": SENDER["from"], "to": email, "subject": subject, "body": body,
                           "html": html_body})
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"drafts-{day.isoformat()}.json"
    if path.exists():  # keep drafts already prepared today (with their Zoho ids), add only new ones
        old = json.loads(path.read_text(encoding="utf-8"))
        known = {x["to"].lower() for x in old}
        drafts = old + [x for x in drafts if x["to"].lower() not in known]
    path.write_text(json.dumps(drafts, indent=2, ensure_ascii=False), encoding="utf-8")
    return path, drafts


def log_sent(items, day):
    new = not SENT_LOG.exists()
    with SENT_LOG.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["date_sent", "name", "email", "subject", "message_id", "kind"])
        if new:
            w.writeheader()
        for it in items:
            w.writerow({"date_sent": day.isoformat(), "name": it["name"], "email": it["email"],
                        "subject": it["subject"], "message_id": it.get("message_id", ""),
                        "kind": it.get("kind", "first")})


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["drafts", "log", "preview"])
    ap.add_argument("arg", nargs="?")
    ap.add_argument("--date")
    a = ap.parse_args()
    from zoneinfo import ZoneInfo
    day = dt.date.fromisoformat(a.date) if a.date else dt.datetime.now(ZoneInfo("America/Chicago")).date()

    if a.command == "preview":
        s, b = render(a.arg, "Sample Business")
        print("Subject:", s, "\n\n" + b)
    elif a.command == "drafts":
        path, drafts = build_drafts(day)
        print(json.dumps({"file": str(path.relative_to(ROOT)), "drafts": len(drafts)}, ensure_ascii=False))
    elif a.command == "log":
        log_sent(json.loads(Path(a.arg).read_text(encoding="utf-8")), day)


if __name__ == "__main__":
    main()
