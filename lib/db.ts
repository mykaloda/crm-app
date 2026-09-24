import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { seed } from "./seed";

/**
 * Storage layer. Uses the SQLite engine built into Node (>= 22.13) so the
 * project runs with zero external services. All SQL lives in lib/*.ts; the
 * schema is plain ANSI SQL and ports to PostgreSQL almost unchanged.
 * All timestamps are unix milliseconds, all money is integer cents (USD).
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cities (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name_en TEXT NOT NULL,
  name_ru TEXT NOT NULL,
  in_en TEXT NOT NULL,             -- "in Paris"
  in_ru TEXT NOT NULL,             -- "в Париже"
  country TEXT NOT NULL DEFAULT '',
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  tz TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_poll_at INTEGER
);

CREATE TABLE IF NOT EXISTS event_types (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name_en TEXT NOT NULL,
  name_ru TEXT NOT NULL,
  title_en TEXT NOT NULL,          -- "The next rain {in}"
  title_ru TEXT NOT NULL,
  kind TEXT NOT NULL,              -- rain | snow | thunder | sunrise | meteor
  threshold REAL NOT NULL DEFAULT 0,        -- mm/h for precipitation types
  min_duration_min INTEGER NOT NULL DEFAULT 10,
  end_quiet_min INTEGER NOT NULL DEFAULT 30,
  recurrence TEXT NOT NULL,        -- continuous | season | window | manual
  season_start TEXT,               -- MM-DD for "first X of season"
  window_start TEXT,               -- MM-DD HH:mm local, for window events
  window_end TEXT,                 -- MM-DD HH:mm local (may cross new year)
  rule_en TEXT NOT NULL,
  rule_ru TEXT NOT NULL,
  start_text_en TEXT NOT NULL,
  start_text_ru TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

-- A series of moments sold in one city ("next rain in Paris") with its price.
CREATE TABLE IF NOT EXISTS offerings (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  city_id INTEGER NOT NULL REFERENCES cities(id),
  event_type_id INTEGER NOT NULL REFERENCES event_types(id),
  price_cents INTEGER NOT NULL,
  sale_type TEXT NOT NULL DEFAULT 'fixed',   -- fixed | auction
  auction_step_cents INTEGER NOT NULL DEFAULT 2500,
  auction_days INTEGER NOT NULL DEFAULT 7,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(city_id, event_type_id)
);

CREATE TABLE IF NOT EXISTS moments (
  id INTEGER PRIMARY KEY,
  offering_id INTEGER REFERENCES offerings(id),
  city_id INTEGER NOT NULL REFERENCES cities(id),
  event_type_id INTEGER NOT NULL REFERENCES event_types(id),
  seq INTEGER NOT NULL DEFAULT 1,
  label_en TEXT,                   -- custom one-off moments
  label_ru TEXT,
  price_cents INTEGER NOT NULL,
  sale_type TEXT NOT NULL DEFAULT 'fixed',
  status TEXT NOT NULL DEFAULT 'on_sale',    -- on_sale | sold | live | completed | expired | cancelled
  locked_until INTEGER,
  earliest_start INTEGER,          -- monitoring starts at (season start / window start)
  window_end INTEGER,              -- the event must happen before (window events)
  hits INTEGER NOT NULL DEFAULT 0,
  candidate_start INTEGER,
  last_hit_at INTEGER,
  started_at INTEGER,
  ended_at INTEGER,
  max_intensity REAL,
  min_temp REAL,
  max_temp REAL,
  confirmed_by TEXT,               -- sources that confirmed the start
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS moments_status ON moments(status);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  stripe_customer_id TEXT,
  card_on_file INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_codes (
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  moment_id INTEGER NOT NULL REFERENCES moments(id),
  user_id INTEGER REFERENCES users(id),
  auction_id INTEGER,
  token TEXT UNIQUE NOT NULL,
  lang TEXT NOT NULL DEFAULT 'en',
  buyer_email TEXT NOT NULL,
  giver_name TEXT,
  recipient_name TEXT NOT NULL,
  recipient_contact TEXT NOT NULL,
  message TEXT,
  hide_message INTEGER NOT NULL DEFAULT 0,
  send_at INTEGER,                 -- null = right after payment
  sent_at INTEGER,
  notify_channel TEXT,             -- chosen by recipient: email | sms | push | none
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | paid | refunded | cancelled
  amount_cents INTEGER NOT NULL,
  refund_cents INTEGER,
  stripe_session_id TEXT,
  stripe_payment_intent TEXT,
  opened_at INTEGER,
  deleted_by_recipient INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  paid_at INTEGER
);
CREATE INDEX IF NOT EXISTS orders_email ON orders(buyer_email);
CREATE INDEX IF NOT EXISTS orders_moment ON orders(moment_id);

CREATE TABLE IF NOT EXISTS measurements (
  id INTEGER PRIMARY KEY,
  city_id INTEGER NOT NULL,
  moment_id INTEGER,
  source TEXT NOT NULL,
  taken_at INTEGER NOT NULL,
  temperature REAL,
  precipitation REAL,
  snowfall REAL,
  weather_code INTEGER,
  condition_met INTEGER NOT NULL DEFAULT 0,
  disputed INTEGER NOT NULL DEFAULT 0,
  resolution TEXT,                 -- confirmed | rejected (admin)
  note TEXT,
  raw TEXT
);
CREATE INDEX IF NOT EXISTS measurements_moment ON measurements(moment_id, taken_at);
CREATE INDEX IF NOT EXISTS measurements_city ON measurements(city_id, taken_at);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  channel TEXT NOT NULL,           -- email | sms | push
  recipient TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  kind TEXT NOT NULL,
  order_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',  -- queued | sent | logged | failed
  error TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auctions (
  id INTEGER PRIMARY KEY,
  moment_id INTEGER NOT NULL REFERENCES moments(id),
  start_cents INTEGER NOT NULL,
  step_cents INTEGER NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active | awaiting_payment | sold | unsold | cancelled
  winner_bid_id INTEGER,
  pay_deadline INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bids (
  id INTEGER PRIMARY KEY,
  auction_id INTEGER NOT NULL REFERENCES auctions(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active | won | forfeited
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  author TEXT NOT NULL,
  text_en TEXT NOT NULL,
  text_ru TEXT NOT NULL,
  visible INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS faq (
  id INTEGER PRIMARY KEY,
  q_en TEXT NOT NULL, a_en TEXT NOT NULL,
  q_ru TEXT NOT NULL, a_ru TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sim_overrides (
  city_id INTEGER PRIMARY KEY,
  precipitation REAL,
  weather_code INTEGER,
  until INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
`;

const g = globalThis as unknown as { __momentDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (g.__momentDb) return g.__momentDb;
  const file = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "moment.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new DatabaseSync(file);
  conn.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  conn.exec(SCHEMA);
  g.__momentDb = conn;
  const seeded = conn.prepare("SELECT value FROM kv WHERE key = 'seeded'").get();
  if (!seeded) {
    tx(() => {
      seed(conn);
      conn.prepare("INSERT INTO kv(key, value) VALUES ('seeded', '1')").run();
    });
  }
  return conn;
}

type Param = null | number | bigint | string;

export function all<T>(sql: string, ...params: Param[]): T[] {
  return db().prepare(sql).all(...params) as T[];
}
export function one<T>(sql: string, ...params: Param[]): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined;
}
export function run(sql: string, ...params: Param[]) {
  return db().prepare(sql).run(...params);
}

export function tx<T>(fn: () => T): T {
  const conn = g.__momentDb ?? db();
  conn.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    conn.exec("COMMIT");
    return result;
  } catch (e) {
    conn.exec("ROLLBACK");
    throw e;
  }
}

export function kvGet(key: string): string | undefined {
  return one<{ value: string }>("SELECT value FROM kv WHERE key = ?", key)?.value;
}
export function kvSet(key: string, value: string) {
  run("INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
}
