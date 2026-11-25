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
import re
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
    "Furniture": "Lerega, an upholstery and leather furniture repair shop in Lakeway",
    "Commercial": "Lerega, an upholstery and leather repair shop in Lakeway",
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
    "aviation_mro": {
        "ru": "Обслуживание самолётов, производители кресел и чехлов: подряд под их сертификатом FAA.",
        "subject": "Overflow sewing and leather repair for your seat shop",
        "body": """{greeting}

I'm {me} with {intro}, near Austin. We repair, recolor and reupholster leather and vinyl seats, including aircraft seats around Austin.

We'd like to work as an overflow subcontractor for your seat or cabin shop: sewing dress covers to your patterns with your approved, burn-certified materials, and repairing or re-dyeing leather, under your repair station's quality system and inspection. Who would be the right person to talk to about that?""",
    },
    "airline": {
        "ru": "Авиакомпании: мебель лаунжей и комнат экипажей в Остине, косметический ремонт кожи кресел по их программе ТО.",
        "subject": "Seat leather and lounge furniture repair in Austin",
        "body": """{greeting}

I'm {me} with {intro}, near Austin. We repair, recolor and reupholster leather and vinyl seating, including aircraft seats, and we work on site.

We'd like to help your team in Austin: repairing lounge, crew room and office furniture, and cosmetic leather repair on cabin seats under your maintenance program, with materials your engineering approves. Could you point me to the right person in Tech Ops or facilities purchasing?""",
    },
    "government_facility": {
        "ru": "Суды и административные здания: ремонт и перетяжка кресел в залах суда, приёмных и кабинетах на месте.",
        "subject": "Furniture repair for courtrooms and offices",
        "body": """{greeting}

I'm {me} with {intro}. We repair and reupholster seating in public buildings: courtroom, jury and gallery chairs, council chamber and office chairs, lobby benches. We fix torn vinyl and leather, worn and faded finishes and flattened cushions, and reupholster pieces that can't be saved. Most repairs are done on site, so the furniture doesn't leave the building.

We'd like to be considered for this kind of work. Who would be the right person to talk to?""",
    },
    "medical_facility": {
        "ru": "Больницы и клиники: перетяжка смотровых столов, каталок и процедурных кресел на месте.",
        "subject": "Exam table and treatment chair reupholstery",
        "body": """{greeting}

I'm {me} with {intro}. We re-cover torn and cracked exam tables, stretcher pads, and treatment and infusion chairs on site, in medical-grade vinyl that stands up to bleach and hospital disinfectants. Torn vinyl can't be properly disinfected and gets flagged on inspections, and re-covering a top usually costs much less than buying a new one from the manufacturer.

If you send me a photo of one that needs it, I'll tell you what it would cost.""",
    },
    "public_safety_fleet": {
        "ru": "Полиция, пожарные, скорые: ремонт и перетяжка сидений служебных машин.",
        "subject": "Seat repair for patrol cars and emergency vehicles",
        "body": """{greeting}

I'm {me} with {intro}. We repair and reupholster seats in patrol cars, fire trucks and ambulances: driver seats worn through by duty belts, torn bench seats and captain's chairs, flattened foam. We recently rebuilt a police vehicle seat in Round Rock in heavy top-grain leather and reshaped the right bolster so the duty belt doesn't wear it out.

Most seats can be repaired for much less than a new seat or cover, and we can come to your shop so the vehicle stays in service. Who handles seat repairs for your fleet?""",
    },
    "facility_subcontract": {
        "ru": "Сети коммерческого ремонта мебели: предложение быть местным субподрядчиком.",
        "subject": "Upholstery subcontractor in Austin",
        "body": """{greeting}

I'm {me} with Lerega, an upholstery and leather repair shop in Lakeway, just outside Austin. We reupholster restaurant booths, banquettes and dining chairs, repair leather and vinyl, and make replacement seats and backs, both on site and in our shop.

If you have restaurant or hospitality projects in Austin or Central Texas, we'd be glad to take them on as a local subcontractor. Who would be the right person to talk to about that?""",
    },
    "industry_association": {
        "ru": "Отраслевые ассоциации: вопрос о членстве поставщика и встречах в Техасе.",
        "subject": "Vendor membership question",
        "body": """{greeting}

I'm {me} with Lerega, an upholstery and leather repair shop in Lakeway, Texas. We reupholster restaurant booths, banquettes and chairs, and we're thinking about joining RFMA as a Vendor Allied member.

Before we sign up, could you tell me which events are coming up in Texas, especially around Austin, and how vendors usually meet the facilities managers who look after Texas locations? Also, if we join now, does the membership run through December 31 of this year or next?""",
    },
    "buyer_event": {
        "ru": "Встречи с закупщиками сетей: запрос цены и состава покупателей.",
        "subject": "RestaurantPoint supplier package",
        "body": """{greeting}

I'm {me} with Lerega, an upholstery shop in Lakeway, Texas. We reupholster restaurant seating and build custom booths and banquettes.

I'm interested in RestaurantPoint. Could you send me pricing for a supplier package, and let me know whether the buyers who attend include people responsible for seating or FF&E, ideally with locations in Texas?""",
    },
    "interior_designer": {
        "ru": "Дизайнеры интерьера: мы — их мастерская; цена для дизайнеров и реферальное вознаграждение.",
        "subject": "Upholstery for your projects",
        "body": """{greeting}

I'm {me} with {intro}. A lot of clients have pieces they want to keep but refresh, and we'd be happy to be the workroom you send them to: reupholstery, leather repair and restoration. We offer designers trade pricing and a referral fee.

If you have a piece in mind for a current project, send me a photo and I'll tell you what we can do.""",
    },
    "furniture_store": {
        "ru": "Мебельные магазины: повреждения при доставке и гарантия — ремонт дешевле замены.",
        "subject": "Warranty and delivery damage repair",
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
    "str_claims": {
        "ru": "Страховые для краткосрочной аренды (Airbnb / Vrbo): ремонт мебели после гостей дешевле замены, смета для страхового случая.",
        "subject": "Furniture repair for rental damage claims",
        "body": """{greeting}

I'm {me} with {intro}. When a guest damages a sofa, chair or headboard in a short-term rental, we can usually repair it for much less than a replacement: tears, stains, pet damage, cracked or faded leather. Hosts get a written estimate from photos that they can attach to a claim, and we work on site or pick the piece up anywhere around Austin and San Antonio.

If you work with repair vendors on claims in Central Texas, or can point hosts to one, we'd be glad to help. Could you forward this to the right person on your claims team?""",
    },
    "warranty_claims": {
        "ru": "Планы защиты мебели (Montage, Fortegra и т.п.): стать их местным мастером по заявкам.",
        "subject": "Furniture repair vendor in Austin and San Antonio",
        "body": """{greeting}

I'm {me} with {intro}. We fix the damage furniture protection plans cover: tears, scratches, stains, cracked or peeling leather, fading, dye transfer and flattened cushions. We repair in the customer's home or pick the piece up, anywhere around Austin and San Antonio. In 11+ years we've restored 5,200+ pieces.

If you send furniture claims to local technicians in this area, we'd like to be one of them. Could you forward this to whoever manages your service network?""",
    },
    "claims_network": {
        "ru": "Сети подрядчиков по страховым случаям (itel, Sedgwick и т.п.): вступить как мастерская по мебели.",
        "subject": "Furniture repair for claims in Central Texas",
        "body": """{greeting}

I'm {me} with {intro}. We repair upholstered and leather furniture damaged in property claims: sofas, recliners, chairs and headboards with tears, stains, cracked or faded leather or flattened cushions, and we reupholster pieces that can't be restored. We work on site or in our shop, anywhere around Austin and San Antonio. In 11+ years we've restored 5,200+ pieces.

If you send furniture repair work to local vendors in Central Texas, we'd like to join your network. Who would be the right person to talk to about that?""",
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

# ---------------------------------------------------------------- photos (owner's request, Nov 25 2026)
# One or two real Lerega projects per segment, from the lerega.com gallery (Lerega_Client get_work_examples).
# Every gallery image is a before/after collage (damaged on the left, restored on the right).
# Images go through lerega.com's own resizer, so they load from our domain at a light size.
# Use only photos from the gallery: never stock or web images.
BLOB = "https://7r6rbm1lcx60cyl2.public.blob.vercel-storage.com/"
PAGES = {
    "commercial": "https://lerega.com/commercial-upholstery?Email",
    "furniture": "https://lerega.com/leather-furniture-repair-in-austin?Email",
    "vehicles": "https://lerega.com/auto-upholstery-in-austin?Email",
    "handbags": "https://lerega.com/leather-handbag-repair?Email",
}
PHOTOS = {  # key: (project title as on lerega.com, image path under BLOB, page)
    "restaurant_booth": ("Restaurant booth: seat reupholstery and color restoration, Lakeway",
                         "cms/projects/dfef1ac1-0f1a-4e49-9fd5-0d094bb7ed24/e70a48c1-8b96-436e-94b6-014d8f8e83ff-23-1-uvqf9SqD7St6S30ePCdI9HRZStekC4.jpg", "commercial"),
    "club_booth": ("Club booth: seat cushion reupholstery",
                   "cms/projects/a97c0a49-210c-4f3d-b7d7-97f7103ce4c9/e70a48c1-8b96-436e-94b6-014d8f8e83ff-24-1-j4ZpVoEKXArempLpe8uuGDXXlErXeh.jpg", "commercial"),
    "waiting_area": ("Waiting area seat cushions: reupholstery",
                     "cms/projects/53203810-3a57-42f0-acf9-5e0f175567da/e70a48c1-8b96-436e-94b6-014d8f8e83ff-25-1-QEstJIX7nrOYuUNXXbZt3WecVWBTwg.jpg", "commercial"),
    "hotel_recliner": ("Hotel lobby recliner: vinyl panel replacement, Round Rock",
                       "projects/1780537208807-8n1w2q.webp", "commercial"),
    "office_cushion": ("Office leather cushion restoration",
                       "projects/1792704872216-eyk1d8.webp", "commercial"),
    "pool_lounge": ("Apartment complex pool lounge chairs: new covers, Austin",
                    "projects/1784165461947-8bgrec.webp", "commercial"),
    "massage_chair": ("Salon massage chair footrest: reupholstery in marine vinyl, Austin",
                      "projects/1779940807557-h1s6fe.webp", "commercial"),
    "armchair_color": ("Leather armchair: surface and color restoration, Cedar Park",
                       "cms/projects/8dcfca34-11e4-4203-ba7c-4c9ba7e7c23c/1774642903095-fzahcm-i5LPqV0Ijmb1XxtZLILCzs87oLXSV4.jpg", "furniture"),
    "armchair_water": ("Leather armchair: water damage and color restoration, Cedar Park",
                       "cms/projects/e4ef0723-0399-44e0-8cab-a1cc92ea8bf3/e70a48c1-8b96-436e-94b6-014d8f8e83ff-11-1-RMXqpLjj9Txo1xzMymwKKTl5M8M99x.jpg", "furniture"),
    "sofa_sun_fade": ("Leather sofa: sun fade and color restoration, Austin",
                      "cms/projects/7763c816-5cfe-4f0f-af51-2ef48e654d63/e70a48c1-8b96-436e-94b6-014d8f8e83ff-20-1-DAtDfTuwIi0wkOJmcJqYvjtl1X2gEk.jpg", "furniture"),
    "sofa_frame": ("Leather sofa: frame repair, cushion reshaping and color restoration, Pflugerville",
                   "cms/projects/4b2a3814-ecb1-46f0-b830-6964220e550a/e70a48c1-8b96-436e-94b6-014d8f8e83ff-26-1-Ji8yAEaqypGz6blKtpgJSpmLVKFjWP.jpg", "furniture"),
    "sofa_reupholstery": ("Sofa: full reupholstery in the client's fabric, Austin",
                          "cms/projects/8ee0c5e4-c4c5-430b-848f-37368bbc98fd/1774643491269-riwyy0-bnKQllAA3z9NWy2OzLcAtSRFywZggH.png", "furniture"),
    "recliner_cushion": ("Leather recliner cushion: surface restoration",
                         "cms/projects/0a88b573-4dcc-4b19-ba55-3fbc0f445f8b/1774642846371-lnl2zf-Pnzzwn0A2V5wqPvDhf0i1dgkYMKXin.jpg", "furniture"),
    "fabric_tear": ("Fabric seam and tear repair",
                    "cms/projects/6ec152f8-12aa-4d05-8eed-e049540b6294/1774644512694-b2kbvd-cRo9u8b6EqoSwiGhY1kYyWlurd1lb4.jpg", "commercial"),
    "vintage_chair": ("Vintage dining chair: full reupholstery and restoration, Steiner Ranch",
                      "projects/1787267155300-3x5lgc.webp", "furniture"),
    "custom_back_cushion": ("Custom back cushion panel: fabrication and upholstery",
                            "cms/projects/ed7e4f05-f5c0-439f-ac4c-ded56ae3f563/1774643920035-a5yjl5-6Dp4yugjlp3yoOWq18qurP0gsiUcCF.jpg", "commercial"),
    "custom_marine": ("Custom upholstery built from scratch in marine vinyl",
                      "cms/projects/034599ae-2e70-4d5b-817a-1e61f72f087d/e70a48c1-8b96-436e-94b6-014d8f8e83ff-9-1-LvNIxN1OqvXU6UduCTExWTWiAQwthC.jpg", "commercial"),
    "car_seat": ("Car seat: vinyl panel replacement and restoration, Austin",
                 "cms/projects/ace3a908-f52a-47ef-8989-5f0af0fcfe30/1774644293130-544j2y-nS67F544LHGIF0WzkpXvMKfs5zdvYg.PNG", "vehicles"),
    "boat_seat": ("Boat seat: marine vinyl repair and partial reupholstery, Lakeway",
                  "cms/projects/cbcca20c-63df-46b7-9714-4ef74f85834d/e70a48c1-8b96-436e-94b6-014d8f8e83ff-22-1-KwG2n8MZCRG2LqBquBMAtUiCv4QcYV.jpg", "vehicles"),
    "police_seat": ("Police vehicle seat: rebuilt in top-grain leather, bolster reshaped for the duty belt, Round Rock",
                    "projects/1789084163374-mjv72c.webp", "vehicles"),
    "aircraft_reupholstery": ("Aircraft seat: cushion reupholstery, Lakeway",
                              "cms/projects/a0f3614d-696b-4787-888a-410a4500ff8f/e70a48c1-8b96-436e-94b6-014d8f8e83ff-2-1-xkqVwQjqtfrFYOh3ZxYkpcl4YfSzPb.jpg", "vehicles"),
    "aircraft_vinyl": ("Aircraft seat: vinyl restoration with protective top coat, Georgetown",
                       "cms/projects/fc17e7ec-b79c-47a4-88b5-f63e9cf34834/e70a48c1-8b96-436e-94b6-014d8f8e83ff-5-1-HukBOzNTlzZioUuWkFdNzN3308csDo.jpg", "vehicles"),
    "handbag_designer": ("Designer handbag: full restoration and cleaning, West Lake Hills",
                         "cms/projects/dbf9efd1-4add-45be-a08d-a3650f720f4a/e70a48c1-8b96-436e-94b6-014d8f8e83ff-10-1-rYuTy1rjz2dS2OxAMPr3b1AyBMLta4.jpg", "handbags"),
    "handbag_color": ("Leather handbag: edge, surface and color restoration, Lakeway",
                      "cms/projects/40d86584-6521-4d7b-9134-0700458714f7/e70a48c1-8b96-436e-94b6-014d8f8e83ff-16-1-ONJWMK7jw5vecC1DPF8zj5PAvnE1Lz.jpg", "handbags"),
}
SEGMENT_PHOTOS = {  # segment: photo keys (1-2), closest to what the email offers
    "restaurant_bar": ["restaurant_booth", "club_booth"],
    "hotel_venue": ["hotel_recliner", "waiting_area"],
    "office_coworking": ["office_cushion", "armchair_color"],
    "property_manager": ["pool_lounge", "sofa_sun_fade"],
    "medical_salon": ["massage_chair", "waiting_area"],
    "vehicle_marine": ["car_seat", "boat_seat"],
    "facility_subcontract": ["restaurant_booth", "club_booth"],
    "industry_association": ["restaurant_booth", "club_booth"],
    "buyer_event": ["restaurant_booth", "club_booth"],
    "public_safety_fleet": ["police_seat", "car_seat"],
    "medical_facility": ["waiting_area", "massage_chair"],
    "government_facility": ["waiting_area", "armchair_water"],
    "aviation_mro": ["aircraft_reupholstery", "aircraft_vinyl"],
    "airline": ["aircraft_reupholstery", "aircraft_vinyl"],
    "interior_designer": ["sofa_reupholstery", "sofa_sun_fade"],
    "furniture_store": ["sofa_frame", "recliner_cushion"],
    "antique_consignment": ["vintage_chair", "armchair_water"],
    "moving_company": ["fabric_tear", "sofa_frame"],
    "builder_remodeler": ["custom_back_cushion", "custom_marine"],
    "str_claims": ["fabric_tear", "armchair_water"],
    "warranty_claims": ["recliner_cushion", "sofa_frame"],
    "claims_network": ["armchair_water", "fabric_tear"],
    "luxury_resale": ["handbag_designer", "handbag_color"],
    "shoe_repair_tailor": ["handbag_designer", "handbag_color"],
    "dry_cleaner": ["handbag_designer", "handbag_color"],
    "boutique_bridal": ["handbag_designer", "handbag_color"],
}
PHOTO_INTRO = {1: "Here's one of our recent projects:", 2: "Here are a couple of our recent projects:"}
PHOTO_WIDTH = 260  # px on screen; the file is 640 px wide, sharp on phones and retina screens


def photo_url(path):
    from urllib.parse import quote
    return "https://lerega.com/_next/image?url=" + quote(BLOB + path, safe="") + "&w=640&q=75"


def photos_for(segment):
    return [PHOTOS[k] for k in SEGMENT_PHOTOS.get(segment or "", [])]


# ---------------------------------------------------------------- build
def clean_business(name):
    # "Uptown Cheapskate Round Rock" stays; drop " - Lakeway" style suffixes and "LLC" / "Inc".
    name = name.split(" - ")[0]
    name = re.sub(r",?\s+(LLC|Inc\.?)$", "", name.strip())
    return name.strip()


def render_message(segment, business, contact_name=""):
    """Subject and letter text: greeting, paragraphs and the ask. No photos, no signature."""
    t = TEMPLATES[segment]
    business = clean_business(business)
    team = business[4:] if business.startswith("The ") else business
    greeting = f"Hi {contact_name}," if contact_name else f"Hi {team} team,"
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import config
    intro = INTRO[config.SEGMENTS[segment]["line"]]
    fill = dict(business=business, greeting=greeting, me=SENDER["name"], intro=intro, proof=PROOF)
    return t["subject"].format(**fill), t["body"].format(**fill)


def photo_position(paragraphs):
    # Photos go right before the last paragraph (the ask), so the question stays the last line above the signature.
    return len(paragraphs) - 1 if len(paragraphs) >= 3 else len(paragraphs)


def render(segment, business, contact_name=""):
    """Plain-text version for review files and the daily sheet (the email itself is sent as HTML)."""
    subject, body = render_message(segment, business, contact_name)
    items = photos_for(segment)
    if items:
        paras = body.split("\n\n")
        lines = PHOTO_INTRO[len(items)] + "\n" + "\n".join(f"- {title} (photo)" for title, _, _ in items)
        paras.insert(photo_position(paras), lines)
        body = "\n\n".join(paras)
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


def photo_block_html(segment):
    import html
    items = photos_for(segment)
    if not items:
        return ""
    imgs = " ".join(
        f'<a href="{PAGES[page]}" target="_blank"><img src="{html.escape(photo_url(path))}" alt="{html.escape(title)}" '
        f'title="{html.escape(title)}" width="{PHOTO_WIDTH}" style="border: 0; max-width: 100%; height: auto"></a>'
        for title, path, page in items)
    return f"<div>{PHOTO_INTRO[len(items)]}<br></div><div>{imgs}<br></div><div><br></div>"


def html_from_text(message, segment=None):
    """Letter text (paragraphs split by blank lines, no signature) -> Zoho HTML with photos and the signature.
    Also used for hand-written special drafts, so they look the same."""
    import html
    paras = message.split("\n\n")
    blocks = [f"<div>{html.escape(p, quote=False).replace(chr(10), '<br>')}<br></div><div><br></div>" for p in paras]
    photos = photo_block_html(segment)
    if photos:
        blocks.insert(photo_position(paras), photos)
    signature = (Path(__file__).with_name("signature.html")).read_text(encoding="utf-8").strip()
    # The owner asked for one more empty line between the letter and the signature.
    return f'<div><div style="{FONT}">{"".join(blocks)}<div><br></div>{signature}</div></div>'


def render_html(segment, business, contact_name=""):
    subject, message = render_message(segment, business, contact_name)
    return subject, html_from_text(message, segment)


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
