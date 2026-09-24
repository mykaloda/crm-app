import crypto from "node:crypto";
import { all, one, run, tx } from "./db";
import { getMoment, lockMoment, momentTitle, type MomentView } from "./moments";
import { flushNotifications, giverOrDefault, isEmail, isPhone, link, queue, tpl, type Channel } from "./notify";
import { usd } from "./currency";
import { formatDuration, MIN } from "./time";
import type { Lang } from "./i18n";

export interface Order {
  id: string;
  moment_id: number;
  user_id: number | null;
  auction_id: number | null;
  token: string;
  lang: Lang;
  buyer_email: string;
  giver_name: string | null;
  recipient_name: string;
  recipient_contact: string;
  message: string | null;
  hide_message: number;
  send_at: number | null;
  sent_at: number | null;
  notify_channel: string | null;
  status: "pending" | "paid" | "refunded" | "cancelled";
  amount_cents: number;
  refund_cents: number | null;
  stripe_session_id: string | null;
  stripe_payment_intent: string | null;
  opened_at: number | null;
  deleted_by_recipient: number;
  created_at: number;
  paid_at: number | null;
}

export const MESSAGE_LIMIT = 200;

/** Unguessable recipient token: 32 random bytes, 43 url-safe characters. */
export function newToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function newOrderId() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(8);
  return "M" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function getOrder(id: string) {
  return one<Order>("SELECT * FROM orders WHERE id = ?", id);
}
export function getOrderByToken(token: string) {
  return one<Order>("SELECT * FROM orders WHERE token = ?", token);
}

export function ensureUser(email: string, name?: string | null): number {
  const e = email.trim().toLowerCase();
  const existing = one<{ id: number }>("SELECT id FROM users WHERE email = ?", e);
  if (existing) return existing.id;
  return Number(run("INSERT INTO users(email, name, created_at) VALUES (?, ?, ?)", e, name ?? null, Date.now()).lastInsertRowid);
}

export interface OrderInput {
  momentId: number;
  lang: Lang;
  buyerEmail: string;
  giverName?: string;
  recipientName: string;
  recipientContact: string;
  message?: string;
  hideMessage?: boolean;
  sendAt?: number | null;
  auctionId?: number;
  amountCents?: number;
}

export type OrderError = "recipient" | "contact" | "email" | "message" | "taken" | "date";

export function validateOrder(i: OrderInput): OrderError | null {
  if (!i.recipientName.trim() || i.recipientName.length > 80) return "recipient";
  if (!isEmail(i.recipientContact) && !isPhone(i.recipientContact)) return "contact";
  if (!isEmail(i.buyerEmail)) return "email";
  if ((i.message ?? "").length > MESSAGE_LIMIT) return "message";
  if (i.sendAt && i.sendAt < Date.now() - 5 * MIN) return "date";
  return null;
}

/** Creates a pending order and reserves the moment for 15 minutes. */
export function createOrder(i: OrderInput): { order?: Order; error?: OrderError } {
  const error = validateOrder(i);
  if (error) return { error };
  if (!i.auctionId && !lockMoment(i.momentId, 15)) return { error: "taken" };
  const moment = getMoment(i.momentId)!;
  const userId = ensureUser(i.buyerEmail, i.giverName);
  const id = newOrderId();
  run(
    `INSERT INTO orders(id, moment_id, user_id, auction_id, token, lang, buyer_email, giver_name, recipient_name,
      recipient_contact, message, hide_message, send_at, amount_cents, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, i.momentId, userId, i.auctionId ?? null, newToken(), i.lang, i.buyerEmail.trim().toLowerCase(),
    i.giverName?.trim() || null, i.recipientName.trim(), i.recipientContact.trim(), i.message?.trim() || null,
    i.hideMessage ? 1 : 0, i.sendAt ?? null, i.amountCents ?? moment.price_cents, Date.now(),
  );
  return { order: getOrder(id)! };
}

/**
 * Idempotent payment confirmation (Stripe webhook or test payment). Marks the
 * moment sold, issues the certificate and sends the gift if due.
 */
export function markPaid(orderId: string, paymentIntent?: string | null): Order | undefined {
  const done = tx(() => {
    const order = getOrder(orderId);
    if (!order || order.status === "paid") return false;
    const moment = getMoment(order.moment_id);
    if (!moment || moment.status !== "on_sale") {
      // Lost the race (lock expired and someone else paid). Keep the money traceable for a refund.
      run("UPDATE orders SET status = 'cancelled', stripe_payment_intent = ? WHERE id = ?", paymentIntent ?? null, orderId);
      queue({
        channel: "email",
        to: process.env.ADMIN_EMAIL || order.buyer_email,
        subject: `Payment for unavailable moment: ${orderId}`,
        body: `Order ${orderId} was paid after the moment became unavailable. Refund it in the admin panel.`,
        kind: "admin_alert",
        orderId,
      });
      return false;
    }
    run(
      "UPDATE orders SET status = 'paid', paid_at = ?, stripe_payment_intent = COALESCE(?, stripe_payment_intent) WHERE id = ?",
      Date.now(), paymentIntent ?? null, orderId,
    );
    run("UPDATE moments SET status = 'sold', locked_until = NULL WHERE id = ?", order.moment_id);
    if (order.auction_id) run("UPDATE auctions SET status = 'sold' WHERE id = ?", order.auction_id);
    // Cancel other pending orders for the same moment.
    run("UPDATE orders SET status = 'cancelled' WHERE moment_id = ? AND status = 'pending' AND id != ?", order.moment_id, orderId);
    return true;
  });
  const order = getOrder(orderId);
  if (done && order) {
    const moment = getMoment(order.moment_id)!;
    const title = momentTitle(moment, order.lang);
    queue({
      channel: "email",
      to: order.buyer_email,
      subject: tpl(order.lang, "certificateSubject", { title }),
      body: tpl(order.lang, "certificate", {
        title,
        recipient: order.recipient_name,
        order: order.id,
        orderUrl: link(`/order/${order.id}`),
        link: link(`/m/${order.token}`),
      }),
      kind: "certificate",
      orderId: order.id,
    });
    if (!order.send_at || order.send_at <= Date.now()) sendGift(order.id);
    void flushNotifications();
  }
  return order;
}

export function recipientChannel(order: Order): Channel | null {
  if (order.deleted_by_recipient || order.notify_channel === "none") return null;
  if (order.notify_channel === "push") return "push";
  if (order.notify_channel === "sms" && isPhone(order.recipient_contact)) return "sms";
  return isEmail(order.recipient_contact) ? "email" : "sms";
}

/** Sends the recipient their personal link. */
export function sendGift(orderId: string) {
  const order = getOrder(orderId);
  if (!order || order.status !== "paid") return false;
  const moment = getMoment(order.moment_id)!;
  const title = momentTitle(moment, order.lang);
  const vars = {
    recipient: order.recipient_name,
    giver: giverOrDefault(order.giver_name, order.lang),
    title,
    titleLower: lowerFirst(title),
    link: link(`/m/${order.token}`),
  };
  const channel = isEmail(order.recipient_contact) ? "email" : "sms";
  queue({
    channel,
    to: order.recipient_contact,
    subject: tpl(order.lang, "giftSubject", vars),
    body: tpl(order.lang, channel === "sms" ? "giftSms" : "gift", vars),
    kind: "gift_sent",
    orderId,
  });
  run("UPDATE orders SET sent_at = ? WHERE id = ?", Date.now(), orderId);
  return true;
}

function lowerFirst(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function paidOrdersFor(momentId: number) {
  return all<Order>("SELECT * FROM orders WHERE moment_id = ? AND status = 'paid'", momentId);
}

export function notifyStarted(moment: MomentView) {
  for (const order of paidOrdersFor(moment.id)) {
    const text = (order.lang === "ru" ? moment.type.start_text_ru : moment.type.start_text_en)
      .replaceAll("{recipient}", order.recipient_name)
      .replaceAll("{in}", order.lang === "ru" ? moment.city.in_ru : moment.city.in_en)
      .replaceAll("{city}", order.lang === "ru" ? moment.city.name_ru : moment.city.name_en);
    const url = link(`/m/${order.token}`);
    const channel = recipientChannel(order);
    if (channel) {
      queue({
        channel,
        to: order.recipient_contact,
        subject: tpl(order.lang, "startedSubject", {}),
        body: channel === "sms" ? `${text} ${url}` : tpl(order.lang, "started", { text, link: url }),
        kind: "event_started",
        orderId: order.id,
      });
    }
    queue({
      channel: "email",
      to: order.buyer_email,
      subject: tpl(order.lang, "buyerStartedSubject", {}),
      body: tpl(order.lang, "buyerStarted", { title: momentTitle(moment, order.lang), recipient: order.recipient_name, link: url }),
      kind: "event_started_buyer",
      orderId: order.id,
    });
  }
}

export function notifyEnded(moment: MomentView) {
  const duration = (moment.ended_at ?? 0) - (moment.started_at ?? 0);
  for (const order of paidOrdersFor(moment.id)) {
    const channel = recipientChannel(order);
    const vars = {
      title: momentTitle(moment, order.lang),
      duration: formatDuration(duration, order.lang),
      link: link(`/m/${order.token}`),
    };
    if (channel) {
      queue({
        channel,
        to: order.recipient_contact,
        subject: tpl(order.lang, "endedSubject", vars),
        body: tpl(order.lang, "ended", vars),
        kind: "event_ended",
        orderId: order.id,
      });
    }
  }
}

/** Refund before the event, minus payment fees. */
export async function refundOrder(orderId: string, feePercent = Number(process.env.REFUND_FEE_PERCENT ?? 5)) {
  const order = getOrder(orderId);
  if (!order || order.status !== "paid") throw new Error("Order is not paid");
  const moment = getMoment(order.moment_id)!;
  if (moment.status !== "sold") throw new Error("The event has already started; refunds are closed");
  const refund = Math.round(order.amount_cents * (1 - feePercent / 100));
  const { stripe } = await import("./stripe");
  const s = stripe();
  if (s && order.stripe_payment_intent) {
    await s.refunds.create({ payment_intent: order.stripe_payment_intent, amount: refund });
  }
  tx(() => {
    run("UPDATE orders SET status = 'refunded', refund_cents = ? WHERE id = ?", refund, orderId);
    run(
      `UPDATE moments SET status = 'on_sale', hits = 0, candidate_start = NULL, locked_until = NULL
       WHERE id = ? AND status = 'sold'`,
      order.moment_id,
    );
  });
  return refund;
}

export function updateRecipientContact(orderId: string, contact: string): boolean {
  const order = getOrder(orderId);
  if (!order || order.status !== "paid") return false;
  if (!isEmail(contact) && !isPhone(contact)) return false;
  const moment = getMoment(order.moment_id)!;
  if (moment.status !== "sold") return false;
  run("UPDATE orders SET recipient_contact = ?, notify_channel = NULL WHERE id = ?", contact.trim(), orderId);
  return true;
}

export function cancelStalePending(now = Date.now()) {
  run("UPDATE orders SET status = 'cancelled' WHERE status = 'pending' AND created_at < ?", now - 2 * 60 * MIN);
}

export function processScheduledSends(now = Date.now()) {
  const due = all<{ id: string }>(
    "SELECT id FROM orders WHERE status = 'paid' AND sent_at IS NULL AND send_at IS NOT NULL AND send_at <= ?",
    now,
  );
  for (const o of due) sendGift(o.id);
  return due.length;
}

export function ordersForEmail(email: string) {
  return all<Order>("SELECT * FROM orders WHERE buyer_email = ? AND status != 'pending' ORDER BY created_at DESC", email.toLowerCase());
}

export function price(order: Order) {
  return usd(order.amount_cents);
}
