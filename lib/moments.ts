import { all, insert, one, run } from "./db";
import { DAY, MIN, nextWindow, seasonStart } from "./time";
import type { Lang } from "./i18n";

export type MomentStatus = "on_sale" | "sold" | "live" | "completed" | "expired" | "cancelled";
export type EventKind = "rain" | "snow" | "thunder" | "sunrise" | "meteor";

export interface City {
  id: number;
  slug: string;
  name_en: string;
  name_ru: string;
  in_en: string;
  in_ru: string;
  country: string;
  lat: number;
  lon: number;
  tz: string;
  hidden: number;
  fail_count: number;
  last_poll_at: number | null;
}

export interface EventType {
  id: number;
  slug: string;
  name_en: string;
  name_ru: string;
  title_en: string;
  title_ru: string;
  kind: EventKind;
  threshold: number;
  min_duration_min: number;
  end_quiet_min: number;
  recurrence: "continuous" | "season" | "window" | "manual";
  season_start: string | null;
  window_start: string | null;
  window_end: string | null;
  rule_en: string;
  rule_ru: string;
  start_text_en: string;
  start_text_ru: string;
  sort: number;
}

export interface Offering {
  id: number;
  slug: string;
  city_id: number;
  event_type_id: number;
  price_cents: number;
  sale_type: "fixed" | "auction";
  auction_step_cents: number;
  auction_days: number;
  active: number;
}

export interface Moment {
  id: number;
  offering_id: number | null;
  city_id: number;
  event_type_id: number;
  seq: number;
  label_en: string | null;
  label_ru: string | null;
  price_cents: number;
  sale_type: "fixed" | "auction";
  status: MomentStatus;
  locked_until: number | null;
  earliest_start: number | null;
  window_end: number | null;
  hits: number;
  candidate_start: number | null;
  last_hit_at: number | null;
  started_at: number | null;
  ended_at: number | null;
  max_intensity: number | null;
  min_temp: number | null;
  max_temp: number | null;
  confirmed_by: string | null;
  created_at: number;
}

/** A moment joined with its city, event type and series slug. */
export interface MomentView extends Moment {
  slug: string | null;
  city: City;
  type: EventType;
}

const MOMENT_SELECT = `SELECT m.*, o.slug AS o_slug,
  c.id AS c_id, c.slug AS c_slug, c.name_en AS c_name_en, c.name_ru AS c_name_ru, c.in_en AS c_in_en,
  c.in_ru AS c_in_ru, c.country AS c_country, c.lat AS c_lat, c.lon AS c_lon, c.tz AS c_tz,
  c.hidden AS c_hidden, c.fail_count AS c_fail_count, c.last_poll_at AS c_last_poll_at
  FROM moments m
  JOIN cities c ON c.id = m.city_id
  LEFT JOIN offerings o ON o.id = m.offering_id`;

type Row = Moment & Record<string, unknown>;

export async function eventTypes(): Promise<EventType[]> {
  return all<EventType>("SELECT * FROM event_types ORDER BY sort, id");
}

function toView(r: Row, types: Map<number, EventType>): MomentView {
  const city: City = {
    id: r.c_id as number,
    slug: r.c_slug as string,
    name_en: r.c_name_en as string,
    name_ru: r.c_name_ru as string,
    in_en: r.c_in_en as string,
    in_ru: r.c_in_ru as string,
    country: r.c_country as string,
    lat: r.c_lat as number,
    lon: r.c_lon as number,
    tz: r.c_tz as string,
    hidden: r.c_hidden as number,
    fail_count: r.c_fail_count as number,
    last_poll_at: r.c_last_poll_at as number | null,
  };
  const view = {} as MomentView;
  for (const [k, v] of Object.entries(r)) if (!/^(c|t|o)_/.test(k)) (view as unknown as Record<string, unknown>)[k] = v;
  view.slug = (r.o_slug as string | null) ?? null;
  view.city = city;
  const type = types.get(r.event_type_id);
  if (!type) throw new Error(`Unknown event type ${r.event_type_id}`);
  view.type = type;
  return view;
}

export async function queryMoments(where = "1=1", ...params: (string | number | null)[]): Promise<MomentView[]> {
  const [rows, types] = await Promise.all([all<Row>(`${MOMENT_SELECT} WHERE ${where}`, ...params), eventTypes()]);
  const byId = new Map(types.map((t) => [t.id, t]));
  return rows.map((r) => toView(r, byId));
}

export async function getMoment(id: number): Promise<MomentView | undefined> {
  return (await queryMoments("m.id = ?", id))[0];
}

/** The current moment of a series ("next-rain-paris"): the open one, else the latest.
 *  One-off moments created by the admin are addressed as "m<id>". */
export async function currentMomentOfSeries(slug: string): Promise<MomentView | undefined> {
  const oneOff = /^m(\d+)$/.exec(slug);
  if (oneOff) {
    const m = await getMoment(Number(oneOff[1]));
    return m && !m.offering_id ? m : undefined;
  }
  return (await queryMoments(
    `o.slug = ? ORDER BY CASE WHEN m.status = 'on_sale' THEN 0 ELSE 1 END, m.seq DESC LIMIT 1`,
    slug,
  ))[0];
}

export function momentPath(m: MomentView): string {
  return `/moments/${momentSlug(m)}`;
}
export function momentSlug(m: Moment & { slug: string | null }): string {
  return m.slug ?? `m${m.id}`;
}

export function momentTitle(m: MomentView, lang: Lang): string {
  const label = lang === "ru" ? m.label_ru : m.label_en;
  if (label) return label;
  const tpl = lang === "ru" ? m.type.title_ru : m.type.title_en;
  return fillCity(tpl, m.city, lang);
}

export function fillCity(tpl: string, city: City, lang: Lang): string {
  return tpl
    .replaceAll("{in}", lang === "ru" ? city.in_ru : city.in_en)
    .replaceAll("{city}", lang === "ru" ? city.name_ru : city.name_en);
}

export function cityName(c: City, lang: Lang) {
  return lang === "ru" ? c.name_ru : c.name_en;
}
export function typeName(t: EventType, lang: Lang) {
  return lang === "ru" ? t.name_ru : t.name_en;
}

export function isLocked(m: Moment, now = Date.now()) {
  return m.locked_until !== null && m.locked_until > now;
}

export type Availability = "available" | "reserved" | "auction" | "sold" | "live" | "completed" | "unavailable";

export function availability(m: MomentView, now = Date.now()): Availability {
  if (m.status === "on_sale") {
    if (m.sale_type === "auction") return "auction";
    return isLocked(m, now) ? "reserved" : "available";
  }
  if (m.status === "sold") return "sold";
  if (m.status === "live") return "live";
  if (m.status === "completed") return "completed";
  return "unavailable";
}

/** Reserve a fixed-price moment for checkout. Returns false if someone else holds it. */
export async function lockMoment(id: number, minutes = 15): Promise<boolean> {
  const now = Date.now();
  const res = await run(
    `UPDATE moments SET locked_until = ?
     WHERE id = ? AND status = 'on_sale' AND (locked_until IS NULL OR locked_until < ?)`,
    now + minutes * MIN,
    id,
    now,
  );
  return Number(res.changes) === 1;
}

export async function unlockMoment(id: number) {
  await run("UPDATE moments SET locked_until = NULL WHERE id = ? AND status = 'on_sale'", id);
}

/**
 * Opens the next moment of a series after the previous one finished (or on
 * first launch). Computes when monitoring for it may start. For auction
 * offerings a lot is created automatically. Returns the new moment id or null.
 */
export async function openNextMoment(
  offeringId: number,
  from: number,
  manual?: { start: number; end: number },
  afterEvent = false,
): Promise<number | null> {
  const o = await one<Offering>("SELECT * FROM offerings WHERE id = ?", offeringId);
  if (!o || !o.active) return null;
  const type = (await one<EventType>("SELECT * FROM event_types WHERE id = ?", o.event_type_id))!;
  const city = (await one<City>("SELECT * FROM cities WHERE id = ?", o.city_id))!;
  const open = await one<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM moments WHERE offering_id = ? AND status = 'on_sale'",
    offeringId,
  );
  if (open && open.n > 0) return null;

  let earliest: number | null = null;
  let windowEnd: number | null = null;
  if (type.recurrence === "season" && type.season_start) {
    earliest = seasonStart(type.season_start, city.tz, from, afterEvent ? 0 : 14);
  } else if (type.recurrence === "window" && type.window_start && type.window_end) {
    let [s, e] = nextWindow(type.window_start, type.window_end, city.tz, from);
    if (afterEvent && s <= from) [s, e] = nextWindow(type.window_start, type.window_end, city.tz, e + MIN);
    earliest = s;
    windowEnd = e;
  } else if (type.recurrence === "manual") {
    if (!manual) return null;
    earliest = manual.start;
    windowEnd = manual.end;
  }

  const seq = ((await one<{ s: number | null }>("SELECT MAX(seq) AS s FROM moments WHERE offering_id = ?", offeringId))?.s ?? 0) + 1;
  const now = Date.now();
  const momentId = await insert(
    `INSERT INTO moments(offering_id, city_id, event_type_id, seq, price_cents, sale_type, status, earliest_start,
      window_end, created_at) VALUES (?, ?, ?, ?, ?, ?, 'on_sale', ?, ?, ?)`,
    o.id, o.city_id, o.event_type_id, seq, o.price_cents, o.sale_type, earliest, windowEnd, now,
  );
  if (o.sale_type === "auction") {
    // Bidding closes before the event may start, or after auction_days.
    let ends = now + o.auction_days * DAY;
    if (earliest && earliest - 6 * 60 * MIN > now) ends = Math.min(ends, earliest - 60 * MIN);
    await run(
      `INSERT INTO auctions(moment_id, start_cents, step_cents, starts_at, ends_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`,
      momentId, o.price_cents, o.auction_step_cents, now, ends, now,
    );
  }
  return momentId;
}

/** Moments the monitor must watch right now. */
export async function monitoredMoments(now = Date.now()): Promise<MomentView[]> {
  return queryMoments(
    `(m.status IN ('sold', 'live')
      OR (m.status = 'on_sale' AND m.earliest_start IS NOT NULL))
     AND (m.earliest_start IS NULL OR m.earliest_start <= ?)
     ORDER BY m.city_id`,
    now,
  );
}

export async function soldCount(): Promise<number> {
  return (await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM orders WHERE status = 'paid'"))?.n ?? 0;
}

export async function listCities(includeHidden = false): Promise<City[]> {
  return await all<City>(`SELECT * FROM cities ${includeHidden ? "" : "WHERE hidden = 0"} ORDER BY name_en`);
}

export async function getCity(slug: string): Promise<City | undefined> {
  return await one<City>("SELECT * FROM cities WHERE slug = ?", slug);
}
