"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { adminLogin, requireAdmin } from "@/lib/auth";
import { one, run } from "@/lib/db";
import { getMoment, invalidateTypes, openNextMoment, type City } from "@/lib/moments";
import { endMoment, startMoment, tick } from "@/lib/monitor";
import { getOrder, refundOrder, sendGift, updateRecipientContact } from "@/lib/orders";
import { cancelAuctionsForMoment, forceCloseAuction } from "@/lib/auction";
import { flushNotifications, queue } from "@/lib/notify";
import { notifyStarted } from "@/lib/orders";
import { saveOverride } from "@/lib/weather";
import { zonedTime } from "@/lib/time";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => Number(str(f, k).replace(",", "."));
const cents = (f: FormData, k: string) => Math.round(num(f, k) * 100);

export async function login(_: { error?: boolean }, form: FormData): Promise<{ error?: boolean }> {
  if (!(await adminLogin(str(form, "password")))) return { error: true };
  redirect("/admin");
}

function done(path: string) {
  revalidatePath(path);
}

/** "2027-02-14T00:00" in the city's time zone -> UTC ms. */
function localInput(value: string, tz: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  return zonedTime(tz, +m[1], +m[2], +m[3], +m[4], +m[5]);
}

// ---------------------------------------------------------------- cities & prices

export async function saveCity(form: FormData) {
  await requireAdmin();
  const id = num(form, "id");
  const fields = [
    str(form, "slug").toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    str(form, "name_en"),
    str(form, "name_ru"),
    str(form, "in_en") || `in ${str(form, "name_en")}`,
    str(form, "in_ru") || `в ${str(form, "name_ru")}`,
    str(form, "country").toUpperCase(),
    num(form, "lat"),
    num(form, "lon"),
    str(form, "tz"),
  ] as const;
  try {
    new Intl.DateTimeFormat("en", { timeZone: fields[8] });
  } catch {
    throw new Error(`Unknown time zone: ${fields[8]}`);
  }
  if (id) {
    run(
      `UPDATE cities SET slug = ?, name_en = ?, name_ru = ?, in_en = ?, in_ru = ?, country = ?, lat = ?, lon = ?, tz = ?,
       hidden = ? WHERE id = ?`,
      ...fields, form.get("hidden") === "on" ? 1 : 0, id,
    );
  } else {
    run("INSERT INTO cities(slug, name_en, name_ru, in_en, in_ru, country, lat, lon, tz) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", ...fields);
  }
  done("/admin/cities");
}

export async function saveOffering(form: FormData) {
  await requireAdmin();
  const id = num(form, "id");
  const price = cents(form, "price");
  const sale = str(form, "sale_type") === "auction" ? "auction" : "fixed";
  const active = form.get("active") === "on" ? 1 : 0;
  if (id) {
    run("UPDATE offerings SET price_cents = ?, sale_type = ?, active = ? WHERE id = ?", price, sale, active, id);
    // Unsold open moments follow the new price.
    run("UPDATE moments SET price_cents = ?, sale_type = ? WHERE offering_id = ? AND status = 'on_sale'", price, sale, id);
  } else {
    const city = one<City>("SELECT * FROM cities WHERE id = ?", num(form, "city_id"))!;
    const type = one<{ slug: string }>("SELECT slug FROM event_types WHERE id = ?", num(form, "event_type_id"))!;
    const res = run(
      "INSERT INTO offerings(slug, city_id, event_type_id, price_cents, sale_type) VALUES (?, ?, ?, ?, ?)",
      `${type.slug}-${city.slug}`, city.id, num(form, "event_type_id"), price, sale,
    );
    openNextMoment(Number(res.lastInsertRowid), Date.now());
  }
  done("/admin/cities");
}

// ---------------------------------------------------------------- event types

export async function saveType(form: FormData) {
  await requireAdmin();
  run(
    `UPDATE event_types SET name_en = ?, name_ru = ?, title_en = ?, title_ru = ?, threshold = ?, min_duration_min = ?,
      end_quiet_min = ?, season_start = ?, window_start = ?, window_end = ?, rule_en = ?, rule_ru = ?,
      start_text_en = ?, start_text_ru = ? WHERE id = ?`,
    str(form, "name_en"), str(form, "name_ru"), str(form, "title_en"), str(form, "title_ru"), num(form, "threshold"),
    Math.max(5, num(form, "min_duration_min")), Math.max(5, num(form, "end_quiet_min")),
    str(form, "season_start") || null, str(form, "window_start") || null, str(form, "window_end") || null,
    str(form, "rule_en"), str(form, "rule_ru"), str(form, "start_text_en"), str(form, "start_text_ru"), num(form, "id"),
  );
  invalidateTypes();
  done("/admin/types");
}

// ---------------------------------------------------------------- moments

export async function createOneOff(form: FormData) {
  await requireAdmin();
  const city = one<City>("SELECT * FROM cities WHERE id = ?", num(form, "city_id"))!;
  const start = localInput(str(form, "start"), city.tz);
  const end = localInput(str(form, "end"), city.tz);
  if (!start || !end || end <= start) throw new Error("Invalid window");
  const sale = str(form, "sale_type") === "auction" ? "auction" : "fixed";
  const res = run(
    `INSERT INTO moments(city_id, event_type_id, seq, label_en, label_ru, price_cents, sale_type, status,
      earliest_start, window_end, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, 'on_sale', ?, ?, ?)`,
    city.id, num(form, "event_type_id"), str(form, "label_en"), str(form, "label_ru") || str(form, "label_en"),
    cents(form, "price"), sale, start, end, Date.now(),
  );
  if (sale === "auction") {
    const now = Date.now();
    run(
      `INSERT INTO auctions(moment_id, start_cents, step_cents, starts_at, ends_at, status, created_at)
       VALUES (?, ?, 2500, ?, ?, 'active', ?)`,
      Number(res.lastInsertRowid), cents(form, "price"), now, Math.min(start - 3600_000, now + 7 * 86400_000), now,
    );
  }
  done("/admin/moments");
}

/** Opens the next meteor shower (or any manual-recurrence series) for an offering. */
export async function openManualMoment(form: FormData) {
  await requireAdmin();
  const offering = one<{ id: number; city_id: number }>("SELECT id, city_id FROM offerings WHERE id = ?", num(form, "offering_id"))!;
  const city = one<City>("SELECT * FROM cities WHERE id = ?", offering.city_id)!;
  const start = localInput(str(form, "start"), city.tz);
  const end = localInput(str(form, "end"), city.tz);
  if (!start || !end || end <= start) throw new Error("Invalid window");
  openNextMoment(offering.id, Date.now(), { start, end });
  done("/admin/moments");
}

export async function forceStart(form: FormData) {
  await requireAdmin();
  const id = num(form, "id");
  startMoment(id, Date.now(), "admin");
  await flushNotifications();
  done("/admin/moments");
}

export async function forceEnd(form: FormData) {
  await requireAdmin();
  const id = num(form, "id");
  endMoment(id, Date.now());
  await flushNotifications();
  done("/admin/moments");
}

export async function cancelMoment(form: FormData) {
  await requireAdmin();
  const id = num(form, "id");
  run("UPDATE moments SET status = 'cancelled' WHERE id = ? AND status = 'on_sale'", id);
  cancelAuctionsForMoment(id);
  done("/admin/moments");
}

// ---------------------------------------------------------------- events & monitoring

export async function resolveMeasurement(form: FormData) {
  await requireAdmin();
  const id = num(form, "id");
  const decision = str(form, "decision") === "confirm" ? "confirmed" : "rejected";
  const row = one<{ moment_id: number; taken_at: number }>("SELECT moment_id, taken_at FROM measurements WHERE id = ?", id);
  run("UPDATE measurements SET resolution = ? WHERE id = ?", decision, id);
  if (row && decision === "confirmed") {
    const m = getMoment(row.moment_id);
    if (m?.status === "sold") startMoment(m.id, row.taken_at, "admin decision (two sources)");
    await flushNotifications();
  }
  done("/admin/events");
}

export async function resendStart(form: FormData) {
  await requireAdmin();
  const m = getMoment(num(form, "id"));
  if (m && (m.status === "live" || m.status === "completed")) notifyStarted(m);
  await flushNotifications();
  done("/admin/events");
}

export async function runTick() {
  await requireAdmin();
  await tick(Date.now(), { force: true });
  done("/admin/events");
}

export async function simulateWeather(form: FormData) {
  await requireAdmin();
  const precip = str(form, "precipitation");
  const code = str(form, "code");
  saveOverride(num(form, "city_id"), precip === "" ? null : Number(precip), code === "" ? null : Number(code), num(form, "minutes") || 30);
  done("/admin/events");
}

// ---------------------------------------------------------------- orders

export async function adminResend(form: FormData) {
  await requireAdmin();
  sendGift(str(form, "id"));
  await flushNotifications();
  done("/admin/orders");
}

export async function adminRefund(form: FormData) {
  await requireAdmin();
  await refundOrder(str(form, "id"), num(form, "fee"));
  done("/admin/orders");
}

export async function adminContact(form: FormData) {
  await requireAdmin();
  const order = getOrder(str(form, "id"));
  if (order) updateRecipientContact(order.id, str(form, "contact"));
  done("/admin/orders");
}

// ---------------------------------------------------------------- auctions

export async function createLot(form: FormData) {
  await requireAdmin();
  const now = Date.now();
  const momentId = num(form, "moment_id");
  cancelAuctionsForMoment(momentId);
  run("UPDATE moments SET sale_type = 'auction' WHERE id = ? AND status = 'on_sale'", momentId);
  const m = getMoment(momentId)!;
  const ends = localInput(str(form, "ends"), m.city.tz) ?? now + 7 * 86400_000;
  run(
    `INSERT INTO auctions(moment_id, start_cents, step_cents, starts_at, ends_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    momentId, cents(form, "start"), cents(form, "step") || 2500, now, ends, now,
  );
  done("/admin/auctions");
}

export async function closeLot(form: FormData) {
  await requireAdmin();
  forceCloseAuction(num(form, "id"));
  await flushNotifications();
  done("/admin/auctions");
}

// ---------------------------------------------------------------- content

export async function saveFaq(form: FormData) {
  await requireAdmin();
  const id = num(form, "id");
  const vals = [str(form, "q_en"), str(form, "a_en"), str(form, "q_ru"), str(form, "a_ru"), num(form, "sort")] as const;
  if (form.get("delete") === "on" && id) run("DELETE FROM faq WHERE id = ?", id);
  else if (id) run("UPDATE faq SET q_en = ?, a_en = ?, q_ru = ?, a_ru = ?, sort = ? WHERE id = ?", ...vals, id);
  else run("INSERT INTO faq(q_en, a_en, q_ru, a_ru, sort) VALUES (?, ?, ?, ?, ?)", ...vals);
  done("/admin/content");
}

export async function saveReview(form: FormData) {
  await requireAdmin();
  const id = num(form, "id");
  if (form.get("delete") === "on" && id) run("DELETE FROM reviews WHERE id = ?", id);
  else if (id)
    run(
      "UPDATE reviews SET author = ?, text_en = ?, text_ru = ?, visible = ? WHERE id = ?",
      str(form, "author"), str(form, "text_en"), str(form, "text_ru"), form.get("visible") === "on" ? 1 : 0, id,
    );
  else
    run(
      "INSERT INTO reviews(author, text_en, text_ru, visible, created_at) VALUES (?, ?, ?, 1, ?)",
      str(form, "author"), str(form, "text_en"), str(form, "text_ru") || str(form, "text_en"), Date.now(),
    );
  done("/admin/content");
}

export async function testEmail(form: FormData) {
  await requireAdmin();
  queue({ channel: "email", to: str(form, "to"), subject: "Moment test", body: "Test message from the admin panel.", kind: "test" });
  await flushNotifications();
  done("/admin/outbox");
}
