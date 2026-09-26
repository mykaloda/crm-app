import { one, run, tx } from "./db";
import {
  getMoment,
  monitoredMoments,
  openNextMoment,
  type City,
  type EventType,
  type MomentView,
} from "./moments";
import { notifyEnded, notifyStarted, processScheduledSends, cancelStalePending } from "./orders";
import { cancelAuctionsForMoment, processAuctions } from "./auction";
import { flushNotifications, queue } from "./notify";
import { primaryProvider, rememberReading, secondaryProvider, withRetry, type Reading } from "./weather";
import { MIN, nextWindow, sunrise } from "./time";

/**
 * The event monitor: the core of the product. Runs every 5 minutes (cron
 * endpoint or the built-in scheduler), polls weather for every city that has
 * a watched moment, and moves moments through sold -> live -> completed.
 */

export const POLL_INTERVAL = 5 * MIN;
const SUNRISE_MINUTES = 30;
const FAIL_ALERT_AFTER = 3;

export interface Evaluation {
  met: boolean;
  intensity: number;
  borderline: boolean;
}

/** Evaluates a type's fixation rule against one reading. */
export function evaluate(type: EventType, r: Reading): Evaluation {
  const code = r.weatherCode ?? -1;
  switch (type.kind) {
    case "rain": {
      const thr = type.threshold;
      return {
        met: r.precipitation > thr,
        intensity: r.precipitation,
        borderline: r.precipitation >= thr * 0.5 && r.precipitation <= thr * 2,
      };
    }
    case "snow": {
      const byCode = (code >= 71 && code <= 77) || code === 85 || code === 86;
      const byAmount = r.snowfall > type.threshold;
      return { met: byCode || byAmount, intensity: r.snowfall || r.precipitation, borderline: byCode !== byAmount };
    }
    case "thunder": {
      const met = code >= 95;
      // Thunderstorms are rare and valuable: always confirm with the second source.
      return { met, intensity: r.precipitation, borderline: met };
    }
    default:
      return { met: false, intensity: 0, borderline: false };
  }
}

interface CityReadings {
  primary: Reading;
  secondary?: Reading | null;
}

let running = false;

export interface TickReport {
  polled: string[];
  failed: string[];
  started: number[];
  ended: number[];
  expired: number[];
  scheduledSends: number;
  skipped?: boolean;
}

export async function tick(now = Date.now(), opts: { force?: boolean } = {}): Promise<TickReport> {
  const report: TickReport = { polled: [], failed: [], started: [], ended: [], expired: [], scheduledSends: 0 };
  if (running) return { ...report, skipped: true };
  running = true;
  try {
    report.scheduledSends = (await processScheduledSends(now));
    await monitorEvents(now, report, opts.force ?? false);
    await processAuctions(now);
    await cancelStalePending(now);
  } finally {
    running = false;
  }
  await flushNotifications();
  return report;
}

async function monitorEvents(now: number, report: TickReport, force: boolean) {
  const moments = await monitoredMoments(now);
  const weatherMoments = new Map<number, MomentView[]>();

  for (const m of moments) {
    if (m.type.kind === "sunrise" || m.type.kind === "meteor") await handleAstronomical(m, now, report);
    else {
      const list = weatherMoments.get(m.city_id) ?? [];
      list.push(m);
      weatherMoments.set(m.city_id, list);
    }
  }

  for (const [, list] of weatherMoments) {
    const city = list[0].city;
    if (!force && city.last_poll_at && now - city.last_poll_at < POLL_INTERVAL - 30_000) continue;
    const readings = await pollCity(city, now, report);
    if (!readings) continue;
    for (const m of list) await handleWeather(m, readings, now, report);
  }
}

async function pollCity(city: City, now: number, report: TickReport): Promise<CityReadings | null> {
  try {
    const primary = await withRetry(() => primaryProvider().current(city));
    await run("UPDATE cities SET fail_count = 0, last_poll_at = ? WHERE id = ?", now, city.id);
    rememberReading(city, primary);
    report.polled.push(city.slug);
    return { primary };
  } catch (e) {
    const fails = ((await one<{ n: number }>("SELECT fail_count AS n FROM cities WHERE id = ?", city.id))?.n ?? 0) + 1;
    await run("UPDATE cities SET fail_count = ?, last_poll_at = ? WHERE id = ?", fails, now, city.id);
    report.failed.push(city.slug);
    await run(
      `INSERT INTO measurements(city_id, source, taken_at, note) VALUES (?, ?, ?, ?)`,
      city.id, primaryProvider().name, now, `poll failed: ${String(e).slice(0, 300)}`,
    );
    if (fails === FAIL_ALERT_AFTER) {
      await queue({
        channel: "email",
        to: process.env.ADMIN_EMAIL || "admin@localhost",
        subject: `Weather polling failing for ${city.name_en}`,
        body: `${FAIL_ALERT_AFTER} polls in a row failed for ${city.name_en}. Last error: ${String(e)}`,
        kind: "admin_alert",
      });
    }
    return null;
  }
}

async function confirm(city: City, readings: CityReadings): Promise<Reading | null> {
  if (readings.secondary !== undefined) return readings.secondary;
  try {
    readings.secondary = await withRetry(() => secondaryProvider().current(city), 2);
  } catch {
    readings.secondary = null;
  }
  return readings.secondary;
}

async function record(m: MomentView, r: Reading, met: boolean, disputed: boolean, note?: string) {
  await run(
    `INSERT INTO measurements(city_id, moment_id, source, taken_at, temperature, precipitation, snowfall,
      weather_code, condition_met, disputed, note, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    m.city_id, m.id, r.source, r.takenAt, r.temperature, r.precipitation, r.snowfall, r.weatherCode,
    met ? 1 : 0, disputed ? 1 : 0, note ?? null, JSON.stringify(r.raw ?? null),
  );
}

async function handleWeatherAsync(m: MomentView, readings: CityReadings, now: number, report: TickReport) {
  const r = readings.primary;
  const primary = evaluate(m.type, r);
  let met = primary.met;
  let sources = r.source;
  let disputed = false;

  if (primary.borderline) {
    const second = await confirm(m.city, readings);
    if (second) {
      const s = evaluate(m.type, second);
      await record(m, second, s.met, false, "confirmation");
      if (s.met !== primary.met) {
        // Sources disagree: this poll does not count; an admin can resolve it.
        disputed = true;
        met = false;
      } else if (met) {
        sources = `${r.source}+${second.source}`;
      }
    } else if (m.type.kind === "thunder") {
      disputed = met;
      met = false;
    }
  }
  await record(m, r, primary.met, disputed, disputed ? "sources disagree" : undefined);
  await applyReading(m, met, primary.intensity, r.temperature, sources, now, r.takenAt, report);
}

async function handleWeather(m: MomentView, readings: CityReadings, now: number, report: TickReport) {
  // Window moments that missed their window roll over to next year ("no expiry").
  if (m.window_end && now > m.window_end && m.status !== "live") {
    await rollWindow(m, now);
    return;
  }
  await handleWeatherAsync(m, readings, now, report);
}

async function rollWindow(m: MomentView, now: number) {
  const t = m.type;
  if (t.window_start && t.window_end) {
    const [s, e] = nextWindow(t.window_start, t.window_end, m.city.tz, now);
    await run("UPDATE moments SET earliest_start = ?, window_end = ?, hits = 0, candidate_start = NULL WHERE id = ?", s, e, m.id);
  }
}

async function applyReading(
  m: MomentView,
  met: boolean,
  intensity: number,
  temperature: number | null,
  sources: string,
  now: number,
  takenAt: number,
  report: TickReport,
) {
  const required = Math.max(1, Math.ceil(m.type.min_duration_min / 5));
  if (m.status === "sold" || m.status === "on_sale") {
    if (!met) {
      if (m.hits) await run("UPDATE moments SET hits = 0, candidate_start = NULL WHERE id = ?", m.id);
      return;
    }
    const hits = m.hits + 1;
    const candidate = m.candidate_start ?? takenAt;
    await run(
      "UPDATE moments SET hits = ?, candidate_start = ?, max_intensity = GREATEST(max_intensity, ?::float8) WHERE id = ?",
      hits, candidate, intensity, m.id,
    );
    if (hits >= required) {
      if (m.status === "on_sale") await expireUnsold(m, now, report);
      else await startMoment(m.id, candidate, sources, report);
    }
    return;
  }
  if (m.status === "live") {
    await run(
      `UPDATE moments SET max_intensity = GREATEST(max_intensity, ?::float8),
        min_temp = LEAST(min_temp, ?::float8), max_temp = GREATEST(max_temp, ?::float8)
        ${met ? ", last_hit_at = ?" : ""} WHERE id = ?`,
      ...(met ? [intensity, temperature, temperature, takenAt, m.id] : [intensity, temperature, temperature, m.id]),
    );
    const lastHit = met ? takenAt : m.last_hit_at ?? m.started_at ?? now;
    const windowOver = m.window_end !== null && now > m.window_end;
    if (windowOver || (!met && now - lastHit >= m.type.end_quiet_min * MIN)) {
      await endMoment(m.id, windowOver ? Math.min(lastHit, m.window_end!) : lastHit, report);
    }
  }
}

async function handleAstronomical(m: MomentView, now: number, report: TickReport) {
  if (m.type.kind === "sunrise") {
    const rise = sunrise(m.earliest_start ?? now, m.city.lat, m.city.lon, m.city.tz);
    if ((m.status === "sold" || m.status === "on_sale") && now >= rise) {
      if (m.status === "on_sale") return expireUnsold(m, now, report);
      await startMoment(m.id, rise, "astronomy", report);
    } else if (m.status === "live" && now >= (m.started_at ?? rise) + SUNRISE_MINUTES * MIN) {
      await endMoment(m.id, (m.started_at ?? rise) + SUNRISE_MINUTES * MIN, report);
    }
    return;
  }
  // Meteor shower: peak window entered by the admin from the astronomical calendar.
  const start = m.earliest_start ?? now;
  const end = m.window_end ?? start + 8 * 60 * MIN;
  if ((m.status === "sold" || m.status === "on_sale") && now >= start) {
    if (m.status === "on_sale") return expireUnsold(m, now, report);
    await startMoment(m.id, start, "astronomical calendar", report);
  } else if (m.status === "live" && now >= end) {
    await endMoment(m.id, end, report);
  }
}

// ---------------------------------------------------------------- lifecycle

export async function startMoment(id: number, startedAt: number, sources: string, report?: TickReport) {
  const ok = await tx(async () => {
    const res = await run(
      `UPDATE moments SET status = 'live', started_at = ?, last_hit_at = ?, confirmed_by = ?, hits = 0
       WHERE id = ? AND status = 'sold'`,
      startedAt, Math.max(startedAt, Date.now() - MIN), sources, id,
    );
    return Number(res.changes) === 1;
  });
  if (!ok) return false;
  report?.started.push(id);
  await notifyStarted((await getMoment(id))!);
  return true;
}

export async function endMoment(id: number, endedAt: number, report?: TickReport) {
  const ok = await tx(async () => {
    const res = await run("UPDATE moments SET status = 'completed', ended_at = ? WHERE id = ? AND status = 'live'", endedAt, id);
    return Number(res.changes) === 1;
  });
  if (!ok) return false;
  report?.ended.push(id);
  const m = (await getMoment(id))!;
  await notifyEnded(m);
  if (m.offering_id) await openNextMoment(m.offering_id, Date.now(), undefined, true);
  return true;
}

/** The event happened while nobody owned it: close it and open the next one. */
async function expireUnsold(m: MomentView, now: number, report: TickReport) {
  const res = await run(
    "UPDATE moments SET status = 'expired', started_at = COALESCE(candidate_start, ?) WHERE id = ? AND status = 'on_sale' AND (locked_until IS NULL OR locked_until < ?)",
    now, m.id, now,
  );
  if (Number(res.changes) !== 1) return;
  await cancelAuctionsForMoment(m.id);
  report.expired.push(m.id);
  if (m.offering_id) await openNextMoment(m.offering_id, now, undefined, true);
}
