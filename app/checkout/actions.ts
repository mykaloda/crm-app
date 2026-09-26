"use server";

import { redirect } from "next/navigation";
import { run } from "@/lib/db";
import { createOrder, getOrder, markPaid, type OrderError } from "@/lib/orders";
import { currentMomentOfSeries, getMoment, momentPath, momentTitle, unlockMoment } from "@/lib/moments";
import { getAuction, topBid } from "@/lib/auction";
import { currentUser } from "@/lib/auth";
import { getLang } from "@/lib/request";
import { createPaymentSession, stripe } from "@/lib/stripe";
import { MIN } from "@/lib/time";

export interface CheckoutState {
  error?: OrderError | "consent" | "generic";
}

export async function checkout(_: CheckoutState, form: FormData): Promise<CheckoutState> {
  // Bot protection: a hidden honeypot field and a minimum fill time.
  if (form.get("website")) return { error: "generic" };
  const startedAt = Number(form.get("started") ?? 0);
  if (startedAt && Date.now() - startedAt < 2500) return { error: "generic" };
  if (form.get("consent") !== "on") return { error: "consent" };

  const lang = await getLang();
  const slug = String(form.get("moment") ?? "");
  const auctionId = Number(form.get("auction") ?? 0) || undefined;

  let momentId: number;
  let amountCents: number | undefined;
  if (auctionId) {
    const a = await getAuction(auctionId);
    const user = await currentUser();
    const top = a ? (await topBid(a.id)) : undefined;
    if (!a || a.status !== "awaiting_payment" || !user || !top || top.id !== a.winner_bid_id || top.user_id !== user.id) {
      return { error: "taken" };
    }
    momentId = a.moment_id;
    amountCents = top.amount_cents;
  } else {
    const m = await currentMomentOfSeries(slug);
    if (!m || m.status !== "on_sale" || m.sale_type !== "fixed") return { error: "taken" };
    momentId = m.id;
  }

  const sendLater = form.get("sendMode") === "later";
  const sendAtIso = String(form.get("sendAtIso") ?? "");
  const sendAt = sendLater && sendAtIso ? Date.parse(sendAtIso) : null;
  if (sendLater && (!sendAt || Number.isNaN(sendAt))) return { error: "date" };

  const { order, error } = await createOrder({
    momentId,
    lang,
    buyerEmail: String(form.get("buyerEmail") ?? ""),
    giverName: String(form.get("giverName") ?? ""),
    recipientName: String(form.get("recipientName") ?? ""),
    recipientContact: String(form.get("recipientContact") ?? ""),
    message: String(form.get("message") ?? ""),
    hideMessage: form.get("hideMessage") === "on",
    sendAt,
    auctionId,
    amountCents,
  });
  if (error || !order) return { error: error ?? "generic" };

  if (stripe()) {
    let url: string | null = null;
    try {
      const m = (await getMoment(momentId))!;
      const session = await createPaymentSession(order, momentTitle(m, lang), `/checkout/cancel?order=${order.id}`);
      await run("UPDATE orders SET stripe_session_id = ? WHERE id = ?", session.id, order.id);
      // Keep the reservation for as long as the Stripe session lives.
      if (!auctionId) await run("UPDATE moments SET locked_until = ? WHERE id = ?", Date.now() + 31 * MIN, momentId);
      url = session.url;
    } catch (e) {
      console.error("Stripe session failed", e);
      if (!auctionId) await unlockMoment(momentId);
      await run("UPDATE orders SET status = 'cancelled' WHERE id = ?", order.id);
      return { error: "generic" };
    }
    redirect(url!);
  }
  redirect(`/checkout/pay/${order.id}`);
}

/** Test payment (only when Stripe is not configured). */
export async function completeTestPayment(form: FormData) {
  if (stripe()) throw new Error("Test payments are disabled when Stripe is configured");
  const id = String(form.get("order"));
  await markPaid(id, null);
  redirect(`/order/${id}?paid=1`);
}

export async function cancelTestPayment(form: FormData) {
  const id = String(form.get("order"));
  const order = await getOrder(id);
  if (order && order.status === "pending") {
    await run("UPDATE orders SET status = 'cancelled' WHERE id = ?", id);
    if (!order.auction_id) await unlockMoment(order.moment_id);
    const m = await getMoment(order.moment_id);
    redirect(m ? momentPath(m) : "/moments");
  }
  redirect("/moments");
}
