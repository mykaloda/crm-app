import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { kvGet, kvSet, one, run } from "./db";
import { ensureUser } from "./orders";
import { flushNotifications, queue, tpl } from "./notify";
import type { Lang } from "./i18n";
import { DAY, MIN } from "./time";

export interface User {
  id: number;
  email: string;
  name: string | null;
  stripe_customer_id: string | null;
  card_on_file: number;
  created_at: number;
}

function secret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  let s = kvGet("session_secret");
  if (!s) {
    s = crypto.randomBytes(32).toString("hex");
    kvSet("session_secret", s);
  }
  return s;
}

const secure = process.env.NODE_ENV === "production";

export async function currentUser(): Promise<User | null> {
  const sid = (await cookies()).get("sid")?.value;
  if (!sid) return null;
  return (
    one<User>(
      "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?",
      sid,
      Date.now(),
    ) ?? null
  );
}

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

/** Creates a 6-digit one-time code. Returns it only when email delivery is not configured. */
export function requestLoginCode(email: string, lang: Lang): string | null {
  const e = email.trim().toLowerCase();
  const code = String(crypto.randomInt(100000, 1000000));
  run("DELETE FROM login_codes WHERE email = ? OR expires_at < ?", e, Date.now());
  run("INSERT INTO login_codes(email, code, expires_at) VALUES (?, ?, ?)", e, code, Date.now() + 15 * MIN);
  queue({ channel: "email", to: e, subject: tpl(lang, "loginSubject", {}), body: tpl(lang, "login", { code }), kind: "login_code" });
  void flushNotifications();
  return emailConfigured() ? null : code;
}

export async function verifyLoginCode(email: string, code: string): Promise<boolean> {
  const e = email.trim().toLowerCase();
  const row = one<{ code: string; attempts: number }>(
    "SELECT code, attempts FROM login_codes WHERE email = ? AND expires_at > ?",
    e,
    Date.now(),
  );
  if (!row || row.attempts >= 5) return false;
  if (row.code !== code.trim()) {
    run("UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?", e);
    return false;
  }
  run("DELETE FROM login_codes WHERE email = ?", e);
  await startSession(ensureUser(e));
  return true;
}

export async function startSession(userId: number) {
  const token = crypto.randomBytes(32).toString("base64url");
  run("INSERT INTO sessions(token, user_id, expires_at) VALUES (?, ?, ?)", token, userId, Date.now() + 30 * DAY);
  (await cookies()).set("sid", token, { httpOnly: true, sameSite: "lax", secure, maxAge: 30 * 24 * 3600, path: "/" });
}

export async function endSession() {
  const jar = await cookies();
  const sid = jar.get("sid")?.value;
  if (sid) run("DELETE FROM sessions WHERE token = ?", sid);
  jar.delete("sid");
}

// ---------------------------------------------------------------- admin

function adminPassword(): string | null {
  return process.env.ADMIN_PASSWORD || (process.env.NODE_ENV !== "production" ? "admin" : null);
}

function adminToken(): string {
  return crypto.createHmac("sha256", secret()).update(`admin:${adminPassword()}`).digest("base64url");
}

export async function isAdmin(): Promise<boolean> {
  if (!adminPassword()) return false;
  const v = (await cookies()).get("adm")?.value;
  if (!v) return false;
  const a = Buffer.from(v);
  const b = Buffer.from(adminToken());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function adminLogin(password: string): Promise<boolean> {
  const expected = adminPassword();
  if (!expected) return false;
  const a = crypto.createHash("sha256").update(password).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  if (!crypto.timingSafeEqual(a, b)) return false;
  (await cookies()).set("adm", adminToken(), { httpOnly: true, sameSite: "lax", secure, maxAge: 7 * 24 * 3600, path: "/" });
  return true;
}

export async function requireAdmin() {
  if (!(await isAdmin())) redirect("/admin/login");
}
