"""Lead-finder settings for Lerega (furniture, leather, upholstery and handbag repair, Austin TX).

Business profile, taken from the CRM (Oct 2025 - Nov 2026, 2,795 orders):
  * Handbags: 728 orders (Louis Vuitton, Coach, Chanel, Gucci, YSL, Dior). Many orders, low ticket (~$250).
  * Reupholstery (big + small): ~400 orders, $400-1,100 quotes.
  * Leather furniture (big + small): ~260 orders, highest revenue ($26K paid).
  * Commercial: only 34 orders, but 5 paid orders brought $14.3K (restaurant booths, hotel chairs,
    construction, van rentals, offices). Highest value per client, repeat business.
  * Car / RV / Marine / Aviation upholstery: ~180 orders.
  * Workshops: Lakeway, Bee Cave, handbag shop. Clients mostly in Pflugerville, Leander, Round Rock,
    Cedar Park, Lakeway, Bee Cave, Kyle, South & West Austin.
"""

# Where to look. Rotated so every day covers a different area.
AREAS = [
    "Austin, TX",
    "Lakeway and Bee Cave, TX",
    "Round Rock and Pflugerville, TX",
    "Cedar Park and Leander, TX",
    "Georgetown, TX",
    "Kyle, Buda and San Marcos, TX",
    "Dripping Springs and Spicewood, TX",
    "West Lake Hills and downtown Austin, TX",
]

# Segments: who we can partner with. weight = how valuable the segment is (from CRM revenue).
# pitch = how to work together, in Russian for the owner (goes into the table).
SEGMENTS = {
    # --- Commercial: direct B2B clients (restaurants, hotels, offices...) ---
    "restaurant_bar": {
        "line": "Commercial",
        "weight": 10,
        "maps": "restaurants and bars",  # short query for map search (fallback)
        "query": "restaurants, bars and cafes with booth seating or upholstered chairs",
        "pitch": "Перетяжка и ремонт диванов-кабинок и барных стульев по графику (ночью/в выходной), чтобы не закрываться; договор на обслуживание.",
    },
    "hotel_venue": {
        "line": "Commercial",
        "weight": 10,
        "maps": "boutique hotel event venue",  # short query for map search (fallback)
        "query": "boutique hotels, event venues, wedding venues and resorts",
        "pitch": "Перетяжка стульев в лобби, номерах и банкетных залах; уход за кожаной мебелью. Commodore Perry Estate уже наш клиент — можно ссылаться.",
    },
    "office_coworking": {
        "line": "Commercial",
        "weight": 8,
        "maps": "coworking space",  # short query for map search (fallback)
        "query": "coworking spaces, corporate offices and law firms with lounge or leather furniture",
        "pitch": "Ремонт офисных кресел и мебели лаунж-зон вместо замены; ежегодный выезд по уходу за кожей.",
    },
    "property_manager": {
        "line": "Commercial",
        "weight": 9,
        "maps": "property management company",  # short query for map search (fallback)
        "query": "property management companies, Airbnb / short-term rental managers and apartment communities",
        "pitch": "Быстрый ремонт мебели между гостями/арендаторами; оптовые цены и забор с объекта.",
    },
    "medical_salon": {
        "line": "Commercial",
        "weight": 7,
        "maps": "hair salon barbershop med spa",  # short query for map search (fallback)
        "query": "dental offices, med spas, hair salons and barbershops with vinyl or leather chairs",
        "pitch": "Перетяжка кресел салонов, барбершопов и стоматологий (винил/кожа) с минимальным простоем.",
    },
    "vehicle_marine": {
        "line": "Commercial",
        "weight": 7,
        "maps": "used car dealer RV boat dealer",  # short query for map search (fallback)
        "query": "car dealerships, RV dealers, boat dealers, marinas and limo / van rental companies",
        "pitch": "Ремонт кожи сидений и салона для б/у машин, лодок, RV и автопарков (Archer Van Rentals уже клиент).",
    },
    # --- Commercial channels: networks and buyer events (from owner's research, Nov 2026) ---
    "facility_subcontract": {
        "line": "Commercial",
        "weight": 10,
        "maps": "commercial furniture repair company",
        "query": "national commercial furniture repair companies that subcontract local upholstery shops",
        "pitch": "Местная мастерская-субподрядчик для их ресторанных и гостиничных проектов в Austin / Central Texas.",
    },
    "industry_association": {
        "line": "Commercial",
        "weight": 8,
        "maps": "restaurant facility management association",
        "query": "restaurant facility management associations with vendor membership",
        "pitch": "Членство поставщика ($850/год), встречи с facility-менеджерами ресторанных сетей в Техасе.",
    },
    "buyer_event": {
        "line": "Commercial",
        "weight": 7,
        "maps": "restaurant supplier buyer event",
        "query": "hosted buyer events connecting restaurant chains with furniture and FF&E suppliers",
        "pitch": "Платные встречи с закупщиками сетей (design / construction / FF&E); сначала узнать цену и аудиторию.",
    },
    # --- Furniture repair: referral partners ---
    "interior_designer": {
        "line": "Furniture",
        "weight": 9,
        "maps": "interior designer",  # short query for map search (fallback)
        "query": "interior designers and home staging companies",
        "pitch": "Партнёрство: перетяжка и реставрация кожи для их клиентов, скидка для дизайнера + реферальный процент.",
    },
    "furniture_store": {
        "line": "Furniture",
        "weight": 8,
        "maps": "furniture store",  # short query for map search (fallback)
        "query": "furniture stores, leather furniture showrooms and mattress / sofa retailers",
        "pitch": "Гарантийный ремонт и повреждения при доставке, подкраска выставочных образцов — становимся их сервисом.",
    },
    "antique_consignment": {
        "line": "Furniture",
        "weight": 7,
        "maps": "furniture consignment antique store",  # short query for map search (fallback)
        "query": "antique stores, vintage furniture shops, furniture consignment stores and estate sale companies",
        "pitch": "Реставрация вещей перед продажей (дороже продадут); они направляют покупателей на перетяжку.",
    },
    "moving_company": {
        "line": "Furniture",
        "weight": 6,
        "maps": "moving company",  # short query for map search (fallback)
        "query": "moving companies and furniture delivery companies",
        "pitch": "Ремонт мебели, повреждённой при переезде (страховые случаи) — быстрее и дешевле замены.",
    },
    "builder_remodeler": {
        "line": "Furniture",
        "weight": 6,
        "maps": "custom home builder remodeling",  # short query for map search (fallback)
        "query": "home builders, remodeling contractors and custom cabinet / millwork shops",
        "pitch": "Подушки, банкетки и встроенные диваны на заказ для их проектов.",
    },
    # --- Handbag repair: referral partners ---
    "luxury_resale": {
        "line": "Handbags",
        "weight": 9,
        "maps": "luxury handbag consignment resale",  # short query for map search (fallback)
        "query": "luxury handbag consignment and resale stores (Louis Vuitton, Chanel, Gucci resale)",
        "pitch": "Восстановление сумок перед перепродажей (уголки, ручки, подклад, цвет); оптовая цена за сумку.",
    },
    "shoe_repair_tailor": {
        "line": "Handbags",
        "weight": 7,
        "maps": "shoe repair tailor alterations",  # short query for map search (fallback)
        "query": "shoe repair shops, cobblers, tailors and alteration shops",
        "pitch": "Они передают нам сумки и кожу, которые не берут; мы им — обувь и одежду.",
    },
    "dry_cleaner": {
        "line": "Handbags",
        "weight": 7,
        "maps": "dry cleaners",  # short query for map search (fallback)
        "query": "dry cleaners and laundry services that accept leather and handbags",
        "pitch": "Точка приёма сумок на ремонт и чистку; процент с каждого заказа.",
    },
    "boutique_bridal": {
        "line": "Handbags",
        "weight": 6,
        "maps": "bridal shop boutique",  # short query for map search (fallback)
        "query": "fashion boutiques, bridal shops and jewelry stores",
        "pitch": "Уход и ремонт сумок для их клиентов; совместный маркетинг и визитки на кассе.",
    },
}

# Partners and clients already in the CRM: never suggest them again.
KNOWN_NAMES = [
    "Commodore Perry Estate",
    "League kitchen",
    "Archer Van Rentals",
    "Riccoboni construction",
]

# ScrapeGraph credit budget. One SearchScraper call = 30 credits + 10 per site above 3.
QUERIES_PER_DAY = 4
DAILY_LINES = ["Commercial", "Furniture", "Handbags", "Commercial"]  # one search per entry
SITES_PER_QUERY = 5          # 4 x 50 = 200 credits per day
MAX_PER_SEGMENT = 6         # max new leads per segment per day
MAX_PER_LINE = 12           # max new leads per line (Commercial / Furniture / Handbags) per day

# Skip big chains: repairs go through their head office, a local email does not reach anyone who decides.
CHAIN_NAMES = [
    "ikea", "rooms to go", "ashley", "living spaces", "world market", "at home", "lovesac", "la-z-boy",
    "havertys", "goodwill", "kid to kid", "skinspirit", "skin pharm", "la quinta", "marriott", "hilton",
    "uptown cheapskate", "style encore", "2nd street",
]

# Skip direct competitors: map categories that mean "they already do what we do".
COMPETITOR_CATEGORIES = ["leather repair", "upholstery", "furniture repair", "handbag repair", "furniture refinishing", "furniture restoration"]

CORE_CITIES = [
    "austin", "lakeway", "bee cave", "west lake hills", "rollingwood", "round rock",
    "pflugerville", "cedar park", "leander", "spicewood", "dripping springs",
]
