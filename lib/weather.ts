import { one, run } from "./db";
import { HOUR, MIN, localParts } from "./time";
import type { City } from "./moments";

/**
 * Weather providers. Primary: OpenWeatherMap One Call (if a key is set),
 * otherwise Open-Meteo (no key). The other one acts as the confirmation
 * source for disputed readings. WEATHER_PROVIDER=simulated switches both to a
 * deterministic simulator for development and demos.
 */

export interface Reading {
  source: string;
  takenAt: number;
  temperature: number | null;
  precipitation: number; // mm/h
  snowfall: number; // cm/h
  weatherCode: number | null; // WMO code
  raw: unknown;
}

export interface ForecastDay {
  date: string; // YYYY-MM-DD
  tMax: number;
  tMin: number;
  precip: number;
  code: number;
}

interface Provider {
  name: string;
  current(city: City): Promise<Reading>;
  forecast(city: City): Promise<ForecastDay[]>;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
  return res.json();
}

const openMeteo: Provider = {
  name: "open-meteo",
  async current(city) {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}` +
      `&current=temperature_2m,precipitation,snowfall,weather_code&timezone=UTC`;
    const raw = (await getJson(url)) as {
      current: { temperature_2m: number; precipitation: number; snowfall: number; weather_code: number; interval: number };
    };
    const c = raw.current;
    const perHour = 3600 / (c.interval || 900);
    return {
      source: "open-meteo",
      takenAt: Date.now(),
      temperature: c.temperature_2m,
      precipitation: round(c.precipitation * perHour),
      snowfall: round(c.snowfall * perHour),
      weatherCode: c.weather_code,
      raw,
    };
  },
  async forecast(city) {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&forecast_days=7&timezone=auto`;
    const raw = (await getJson(url)) as {
      daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_sum: number[]; weather_code: number[] };
    };
    const d = raw.daily;
    return d.time.map((date, i) => ({
      date,
      tMax: d.temperature_2m_max[i],
      tMin: d.temperature_2m_min[i],
      precip: d.precipitation_sum[i],
      code: d.weather_code[i],
    }));
  },
};

/** Maps OpenWeatherMap condition ids to WMO codes. */
function owmToWmo(id: number): number {
  if (id >= 200 && id < 300) return 95;
  if (id >= 300 && id < 400) return 53;
  if (id >= 500 && id < 600) return id >= 502 ? 65 : 61;
  if (id >= 600 && id < 700) return 73;
  if (id === 800) return 0;
  return 3;
}

const openWeatherMap: Provider = {
  name: "openweathermap",
  async current(city) {
    const key = process.env.OPENWEATHER_API_KEY;
    if (!key) throw new Error("OPENWEATHER_API_KEY is not set");
    const url =
      `https://api.openweathermap.org/data/3.0/onecall?lat=${city.lat}&lon=${city.lon}` +
      `&exclude=hourly,daily,alerts&units=metric&appid=${key}`;
    const raw = (await getJson(url)) as {
      current: { temp: number; rain?: { "1h"?: number }; snow?: { "1h"?: number }; weather: { id: number }[] };
      minutely?: { precipitation: number }[];
    };
    const c = raw.current;
    const minute = raw.minutely?.[0]?.precipitation;
    const code = owmToWmo(c.weather?.[0]?.id ?? 800);
    const snow = c.snow?.["1h"] ?? 0;
    return {
      source: "openweathermap",
      takenAt: Date.now(),
      temperature: c.temp,
      precipitation: round(minute ?? (c.rain?.["1h"] ?? 0) + snow),
      snowfall: round(snow / 10),
      weatherCode: code,
      raw,
    };
  },
  async forecast(city) {
    const key = process.env.OPENWEATHER_API_KEY;
    const url =
      `https://api.openweathermap.org/data/3.0/onecall?lat=${city.lat}&lon=${city.lon}` +
      `&exclude=current,minutely,hourly,alerts&units=metric&appid=${key}`;
    const raw = (await getJson(url)) as {
      daily: { dt: number; temp: { min: number; max: number }; rain?: number; snow?: number; weather: { id: number }[] }[];
    };
    return raw.daily.slice(0, 7).map((d) => ({
      date: new Date(d.dt * 1000).toISOString().slice(0, 10),
      tMax: d.temp.max,
      tMin: d.temp.min,
      precip: (d.rain ?? 0) + (d.snow ?? 0),
      code: owmToWmo(d.weather?.[0]?.id ?? 800),
    }));
  },
};

// ---------------------------------------------------------------- simulator

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

const RAIN_CHANCE: Record<string, number> = { dubai: 0.02, bali: 0.25, london: 0.22 };

interface Override {
  precipitation: number | null;
  weather_code: number | null;
}

/** Manual overrides from the admin panel ("make it rain in Paris now"). */
async function overrideFor(city: City, ts: number) {
  return one<Override>("SELECT precipitation, weather_code FROM sim_overrides WHERE city_id = ? AND until > ?", city.id, ts);
}

function simulatedAt(city: City, ts: number, source: string, o?: Override): Reading {
  const p = localParts(ts, city.tz);
  const southern = city.lat < 0;
  const monthAngle = ((p.month - (southern ? 1 : 7)) / 12) * 2 * Math.PI;
  const base = 30 - Math.abs(city.lat) * 0.45;
  const seasonal = Math.cos(monthAngle) * Math.min(14, Math.abs(city.lat) / 3.5);
  const diurnal = Math.sin(((p.hour - 9) / 24) * 2 * Math.PI) * 4;
  const temperature = round(base + seasonal + diurnal + (hash(`${city.slug}${Math.floor(ts / HOUR)}t`) - 0.5) * 2);

  const block = Math.floor(ts / (30 * MIN));
  const chance = RAIN_CHANCE[city.slug] ?? 0.15;
  const wet = hash(`${city.slug}:${block}`) < chance;
  let precipitation = wet ? round(0.3 + hash(`${city.slug}:${block}:i`) * 2.5) : 0;
  let code = wet ? (precipitation > 1.5 ? 63 : 61) : hash(`${city.slug}:${block}:c`) < 0.4 ? 3 : 1;
  if (wet && temperature < 1) code = 73;
  if (wet && temperature > 18 && hash(`${city.slug}:${block}:th`) < 0.2) code = 95;

  if (o) {
    if (o.precipitation !== null) precipitation = o.precipitation;
    if (o.weather_code !== null) code = o.weather_code;
  }
  // The confirmation source disagrees a little, like real providers do.
  if (source.endsWith("b") && precipitation > 0) precipitation = round(precipitation * (0.85 + hash(`${block}b`) * 0.3));
  const snowy = code >= 71 && code <= 77;
  return {
    source,
    takenAt: ts,
    temperature,
    precipitation,
    snowfall: snowy ? round(precipitation / 2) : 0,
    weatherCode: code,
    raw: { simulated: true, block, override: Boolean(o) },
  };
}

function simulator(name: string): Provider {
  return {
    name,
    async current(city) {
      const now = Date.now();
      return simulatedAt(city, now, name, await overrideFor(city, now));
    },
    async forecast(city) {
      const days: ForecastDay[] = [];
      for (let i = 0; i < 7; i++) {
        const ts = Date.now() + i * 24 * HOUR;
        const hours = Array.from({ length: 24 }, (_, h) => simulatedAt(city, ts - (ts % (24 * HOUR)) + h * HOUR, name));
        const temps = hours.map((r) => r.temperature ?? 0);
        const precip = hours.reduce((s, r) => s + r.precipitation, 0);
        const wettest = hours.reduce((a, b) => (b.precipitation > a.precipitation ? b : a));
        days.push({
          date: new Date(ts).toISOString().slice(0, 10),
          tMax: Math.max(...temps),
          tMin: Math.min(...temps),
          precip: round(precip),
          code: precip > 0 ? wettest.weatherCode ?? 61 : 2,
        });
      }
      return days;
    },
  };
}

// ---------------------------------------------------------------- selection

export function simulated(): boolean {
  return process.env.WEATHER_PROVIDER === "simulated";
}

export function primaryProvider(): Provider {
  if (simulated()) return simulator("simulator-a");
  return process.env.OPENWEATHER_API_KEY ? openWeatherMap : openMeteo;
}

export function secondaryProvider(): Provider {
  if (simulated()) return simulator("simulator-b");
  return process.env.OPENWEATHER_API_KEY ? openMeteo : openMeteoEcmwf;
}

/** Without an OpenWeatherMap key, confirm with a different model on Open-Meteo. */
const openMeteoEcmwf: Provider = {
  ...openMeteo,
  name: "open-meteo-ecmwf",
  async current(city) {
    const url =
      `https://api.open-meteo.com/v1/ecmwf?latitude=${city.lat}&longitude=${city.lon}` +
      `&current=temperature_2m,precipitation,snowfall,weather_code&timezone=UTC`;
    const raw = (await getJson(url)) as {
      current: { temperature_2m: number; precipitation: number; snowfall: number; weather_code: number; interval: number };
    };
    const c = raw.current;
    const perHour = 3600 / (c.interval || 3600);
    return {
      source: "open-meteo-ecmwf",
      takenAt: Date.now(),
      temperature: c.temperature_2m,
      precipitation: round(c.precipitation * perHour),
      snowfall: round(c.snowfall * perHour),
      weatherCode: c.weather_code,
      raw,
    };
  },
};

export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw last;
}

// Short cache for page views so visitors never hammer the weather API.
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  try {
    const value = await fn();
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch {
    return hit ? (hit.value as T) : null;
  }
}

export function rememberReading(city: City, r: Reading) {
  cache.set(`now:${city.id}`, { at: Date.now(), value: r });
}

/** Current weather for display: latest stored measurement if fresh, else API. */
export async function currentWeather(city: City): Promise<Reading | null> {
  const stored = await one<{ taken_at: number; source: string; temperature: number; precipitation: number; snowfall: number; weather_code: number }>(
    "SELECT * FROM measurements WHERE city_id = ? ORDER BY taken_at DESC LIMIT 1",
    city.id,
  );
  if (stored && Date.now() - stored.taken_at < 10 * MIN) {
    return {
      source: stored.source,
      takenAt: stored.taken_at,
      temperature: stored.temperature,
      precipitation: stored.precipitation,
      snowfall: stored.snowfall,
      weatherCode: stored.weather_code,
      raw: null,
    };
  }
  return cached(`now:${city.id}`, 10 * MIN, () => primaryProvider().current(city));
}

export async function forecast(city: City): Promise<ForecastDay[] | null> {
  return cached(`fc:${city.id}`, 3 * HOUR, () => primaryProvider().forecast(city));
}

export function round(n: number) {
  return Math.round(n * 100) / 100;
}

export type Sky = "clear" | "cloudy" | "rain" | "snow" | "thunder" | "fog";

export function skyOf(code: number | null | undefined): Sky {
  if (code === null || code === undefined) return "cloudy";
  if (code >= 95) return "thunder";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if (code === 45 || code === 48) return "fog";
  if (code <= 1) return "clear";
  return "cloudy";
}

export async function saveOverride(cityId: number, precipitation: number | null, code: number | null, minutes: number) {
  await run(
    `INSERT INTO sim_overrides(city_id, precipitation, weather_code, until) VALUES (?, ?, ?, ?)
     ON CONFLICT(city_id) DO UPDATE SET precipitation = excluded.precipitation,
       weather_code = excluded.weather_code, until = excluded.until`,
    cityId,
    precipitation,
    code,
    Date.now() + minutes * MIN,
  );
}
