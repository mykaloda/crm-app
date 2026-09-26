/** Time-zone helpers built on Intl, no external dependencies. */

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

export function localParts(ts: number, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(ts));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** Converts a wall-clock time in `tz` to a UTC timestamp. */
export function zonedTime(tz: string, y: number, mo: number, d: number, h = 0, mi = 0): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let ts = guess;
  // Two passes settle DST boundaries.
  for (let i = 0; i < 2; i++) {
    const p = localParts(ts, tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    ts += guess - asUtc;
  }
  return ts;
}

/**
 * Start of the next "first X of the season" period for "MM-DD" in `tz`.
 * A season that began less than `graceDays` before `from` still counts as current.
 */
export function seasonStart(mmdd: string, tz: string, from: number, graceDays = 0): number {
  const [m, d] = mmdd.split("-").map(Number);
  const edge = from - graceDays * DAY;
  const year = localParts(from, tz).year;
  for (const y of [year - 1, year, year + 1]) {
    const start = zonedTime(tz, y, m, d);
    if (start > edge) return start;
  }
  return zonedTime(tz, year + 2, m, d);
}

/** Parses "MM-DD HH:mm" into a timestamp for the given local year. */
export function windowPoint(spec: string, tz: string, year: number): number {
  const [date, time = "00:00"] = spec.split(" ");
  const [m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return zonedTime(tz, year, m, d, h, mi);
}

/** Next window (start, end) that has not finished yet. Windows may cross new year. */
export function nextWindow(startSpec: string, endSpec: string, tz: string, from: number): [number, number] {
  const year = localParts(from, tz).year;
  for (const y of [year - 1, year, year + 1]) {
    const start = windowPoint(startSpec, tz, y);
    let end = windowPoint(endSpec, tz, y);
    if (end <= start) end = windowPoint(endSpec, tz, y + 1);
    if (end > from) return [start, end];
  }
  const start = windowPoint(startSpec, tz, year + 2);
  return [start, windowPoint(endSpec, tz, year + 3)];
}

const rad = Math.PI / 180;

/**
 * Sunrise (UTC ms) for the local calendar day containing `dayTs`, using the
 * NOAA solar position algorithm. Accurate to about a minute.
 */
export function sunrise(dayTs: number, lat: number, lon: number, tz: string): number {
  const p = localParts(dayTs, tz);
  const noonUtc = Date.UTC(p.year, p.month - 1, p.day, 12);
  const jd = noonUtc / DAY + 2440587.5;
  const n = Math.round(jd - 2451545.0 + 0.0008);
  const jStar = n - lon / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const jTransit = 2451545.0 + jStar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lambda * rad);
  const decl = Math.asin(Math.sin(lambda * rad) * Math.sin(23.4397 * rad));
  const cosH =
    (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(decl)) / (Math.cos(lat * rad) * Math.cos(decl));
  const H = Math.acos(Math.max(-1, Math.min(1, cosH))) / rad;
  const jRise = jTransit - H / 360;
  return Math.round((jRise - 2440587.5) * DAY);
}

export function formatDuration(ms: number, lang: "en" | "ru"): string {
  const totalMin = Math.max(0, Math.round(ms / MIN));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (lang === "ru") return h ? `${h} ч ${m} мин` : `${m} мин`;
  return h ? `${h} h ${m} min` : `${m} min`;
}

export function formatDateTime(ts: number, tz: string, lang: "en" | "ru", withTime = true): string {
  return new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", {
    timeZone: tz,
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(ts));
}

export function formatTime(ts: number, tz: string, lang: "en" | "ru"): string {
  return new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}
