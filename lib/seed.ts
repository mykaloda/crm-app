import type { DatabaseSync } from "node:sqlite";
import { openNextMoment } from "./moments";

/** Initial catalog from the spec (section 3). Runs once on an empty database. */
export function seed(conn: DatabaseSync) {
  const now = Date.now();

  const cities: [string, string, string, string, string, string, number, number, string][] = [
    ["paris", "Paris", "Париж", "in Paris", "в Париже", "FR", 48.8566, 2.3522, "Europe/Paris"],
    ["london", "London", "Лондон", "in London", "в Лондоне", "GB", 51.5074, -0.1278, "Europe/London"],
    ["kyiv", "Kyiv", "Киев", "in Kyiv", "в Киеве", "UA", 50.4501, 30.5234, "Europe/Kyiv"],
    ["moscow", "Moscow", "Москва", "in Moscow", "в Москве", "RU", 55.7558, 37.6173, "Europe/Moscow"],
    ["new-york", "New York", "Нью-Йорк", "in New York", "в Нью-Йорке", "US", 40.7128, -74.006, "America/New_York"],
    ["dubai", "Dubai", "Дубай", "in Dubai", "в Дубае", "AE", 25.2048, 55.2708, "Asia/Dubai"],
    ["bali", "Bali", "Бали", "in Bali", "на Бали", "ID", -8.6705, 115.2126, "Asia/Makassar"],
    ["iceland", "Iceland", "Исландия", "over Iceland", "над Исландией", "IS", 64.1466, -21.9426, "Atlantic/Reykjavik"],
  ];
  const insCity = conn.prepare(
    "INSERT INTO cities(slug, name_en, name_ru, in_en, in_ru, country, lat, lon, tz) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const c of cities) insCity.run(...c);

  const types = [
    {
      slug: "next-rain", kind: "rain", threshold: 0.2, recurrence: "continuous",
      name_en: "Next rain", name_ru: "Следующий дождь",
      title_en: "The next rain {in}", title_ru: "Следующий дождь {in}",
      rule_en: "Precipitation above 0.2 mm/h for at least 10 minutes. Ends after 30 minutes without rain.",
      rule_ru: "Осадки более 0,2 мм/ч не менее 10 минут. Заканчивается после 30 минут без дождя.",
      start_text_en: "{recipient}, your rain has just started {in}.",
      start_text_ru: "{recipient}, {in} начался ваш дождь.",
    },
    {
      slug: "first-snow", kind: "snow", threshold: 0.0, recurrence: "season", season_start: "11-01",
      name_en: "First snow of winter", name_ru: "Первый снег зимы",
      title_en: "The first snow of winter {in}", title_ru: "Первый снег зимы {in}",
      rule_en: "The first snowfall recorded on or after November 1. Once per season.",
      rule_ru: "Первый снегопад, зафиксированный с 1 ноября. Один раз за сезон.",
      start_text_en: "{recipient}, the first snow of winter is falling {in}. It is yours.",
      start_text_ru: "{recipient}, {in} пошел первый снег зимы. Он ваш.",
    },
    {
      slug: "new-year-rain", kind: "rain", threshold: 0.2, recurrence: "window",
      window_start: "12-31 18:00", window_end: "01-01 06:00",
      name_en: "Rain on New Year's Eve", name_ru: "Дождь на Новый год",
      title_en: "Rain on New Year's Eve {in}", title_ru: "Дождь на Новый год {in}",
      rule_en: "Precipitation above 0.2 mm/h between Dec 31 18:00 and Jan 1 06:00 local time.",
      rule_ru: "Осадки более 0,2 мм/ч с 31.12 18:00 до 01.01 06:00 по местному времени.",
      start_text_en: "{recipient}, it is raining on New Year's Eve {in}. This rain is yours.",
      start_text_ru: "{recipient}, в новогоднюю ночь {in} пошел дождь. Он ваш.",
    },
    {
      slug: "first-thunder", kind: "thunder", threshold: 0, recurrence: "season", season_start: "06-01",
      name_en: "First thunderstorm of summer", name_ru: "Первая гроза лета",
      title_en: "The first thunderstorm of summer {in}", title_ru: "Первая гроза лета {in}",
      rule_en: "The first thunderstorm recorded on or after June 1.",
      rule_ru: "Первая гроза, зафиксированная с 1 июня.",
      start_text_en: "{recipient}, the first thunderstorm of summer has begun {in}.",
      start_text_ru: "{recipient}, {in} началась первая гроза лета.",
    },
    {
      slug: "first-sunrise", kind: "sunrise", threshold: 0, recurrence: "window",
      window_start: "01-01 00:00", window_end: "01-01 12:00",
      name_en: "First sunrise of the year", name_ru: "Первый рассвет года",
      title_en: "The first sunrise of the year {in}", title_ru: "Первый рассвет года {in}",
      rule_en: "Calculated astronomically: sunrise on January 1. The moment lasts 30 minutes.",
      rule_ru: "Рассчитывается астрономически: восход 1 января. Момент длится 30 минут.",
      start_text_en: "{recipient}, the first sun of the year is rising {in}.",
      start_text_ru: "{recipient}, {in} восходит первое солнце года.",
    },
    {
      slug: "meteor-shower", kind: "meteor", threshold: 0, recurrence: "manual",
      name_en: "Meteor shower", name_ru: "Метеоритный дождь",
      title_en: "A meteor shower {in}", title_ru: "Метеоритный дождь {in}",
      rule_en: "By the astronomical calendar: the peak night of the shower, dates published in advance.",
      rule_ru: "По астрономическому календарю: ночь пика потока, даты публикуются заранее.",
      start_text_en: "{recipient}, the meteor shower peak {in} has begun. Look up.",
      start_text_ru: "{recipient}, {in} начался пик метеоритного дождя. Посмотрите на небо.",
    },
  ];
  const insType = conn.prepare(`INSERT INTO event_types(slug, kind, threshold, recurrence, season_start, window_start,
    window_end, name_en, name_ru, title_en, title_ru, rule_en, rule_ru, start_text_en, start_text_ru, sort)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  types.forEach((t, i) =>
    insType.run(
      t.slug, t.kind, t.threshold, t.recurrence, t.season_start ?? null, t.window_start ?? null,
      t.window_end ?? null, t.name_en, t.name_ru, t.title_en, t.title_ru, t.rule_en, t.rule_ru,
      t.start_text_en, t.start_text_ru, i,
    ),
  );

  const offerings: [string, string, number, "fixed" | "auction"][] = [
    ["next-rain", "paris", 5000, "fixed"],
    ["next-rain", "london", 5000, "fixed"],
    ["next-rain", "kyiv", 5000, "fixed"],
    ["next-rain", "moscow", 5000, "fixed"],
    ["next-rain", "new-york", 5000, "fixed"],
    ["next-rain", "dubai", 20000, "fixed"],
    ["first-snow", "new-york", 50000, "fixed"],
    ["first-snow", "paris", 50000, "fixed"],
    ["first-snow", "moscow", 50000, "fixed"],
    ["new-year-rain", "paris", 100000, "fixed"],
    ["first-thunder", "paris", 30000, "auction"],
    ["first-thunder", "new-york", 30000, "auction"],
    ["first-sunrise", "bali", 100000, "fixed"],
    ["meteor-shower", "iceland", 50000, "auction"],
  ];
  const insOffering = conn.prepare(`INSERT INTO offerings(slug, city_id, event_type_id, price_cents, sale_type)
    SELECT ?, c.id, t.id, ?, ? FROM cities c, event_types t WHERE c.slug = ? AND t.slug = ?`);
  for (const [type, city, price, sale] of offerings) {
    const res = insOffering.run(`${type}-${city}`, price, sale, city, type);
    const offeringId = Number(res.lastInsertRowid);
    if (type === "meteor-shower") {
      // Geminids peak night over Iceland; later showers are entered by the admin.
      openNextMoment(offeringId, now, { start: Date.UTC(2026, 11, 13, 20), end: Date.UTC(2026, 11, 14, 6) });
    } else {
      openNextMoment(offeringId, now);
    }
  }

  const faq: [string, string, string, string][] = [
    [
      "What exactly am I buying?",
      "A digital gift: a named link between a person and a natural event in a specific city, real-time tracking of that event and a permanent record in the recipient's archive. You are not buying the weather itself.",
      "Что именно я покупаю?",
      "Цифровой подарок: именную привязку человека к природному событию в конкретном городе, отслеживание события в реальном времени и постоянную запись в архиве получателя. Саму погоду вы не покупаете.",
    ],
    [
      "Can two people own the same rain?",
      "No. Each moment in each city is sold to exactly one buyer. Once it is sold it disappears from the catalog until the event happens, then the next one opens.",
      "Может ли один дождь принадлежать двоим?",
      "Нет. Каждый момент в каждом городе продается одному покупателю. После продажи он исчезает из каталога до наступления события, затем открывается следующий.",
    ],
    [
      "How do you know the event has started?",
      "We poll weather data for the city every 5 minutes. The start is recorded when the condition is met in two polls in a row; values close to the threshold are checked against a second data source. All measurements are kept in the archive.",
      "Как вы узнаете, что событие началось?",
      "Мы опрашиваем погодные данные по городу каждые 5 минут. Начало фиксируется, когда условие выполнено в двух опросах подряд; значения на границе порога проверяются по второму источнику. Все замеры хранятся в архиве.",
    ],
    [
      "What if the event never happens?",
      "Moments have no expiry date. We keep watching the sky, however long it takes, and this is stated in the terms. A refund is available at any time before the event starts, minus payment fees.",
      "Что если событие так и не наступит?",
      "У моментов нет срока. Мы продолжаем следить за небом, сколько бы это ни заняло, и это указано в правилах. Возврат возможен в любой момент до начала события за вычетом комиссий.",
    ],
    [
      "I made a mistake in the recipient's email or phone.",
      "Sign in to your account with the email you used at checkout and change the contact at any time before the event.",
      "Я ошибся в email или телефоне получателя.",
      "Войдите в кабинет по email, указанному при оплате, и измените контакт в любой момент до наступления события.",
    ],
    [
      "Do I need to register?",
      "No. You can pay as a guest; an account is created automatically for your email so you can manage the order later. Registration is only needed for auctions.",
      "Нужна ли регистрация?",
      "Нет. Можно оплатить как гость; кабинет создается автоматически по вашему email, чтобы вы могли управлять заказом. Регистрация нужна только для аукционов.",
    ],
  ];
  const insFaq = conn.prepare("INSERT INTO faq(q_en, a_en, q_ru, a_ru, sort) VALUES (?, ?, ?, ?, ?)");
  faq.forEach((f, i) => insFaq.run(...f, i));
}
