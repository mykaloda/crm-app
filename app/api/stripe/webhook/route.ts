import type Stripe from "stripe";
import { run } from "@/lib/db";
import { getOrder, markPaid } from "@/lib/orders";
import { unlockMoment } from "@/lib/moments";
import { stripe } from "@/lib/stripe";

export async function POST(req: Request) {
  const s = stripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!s || !secret) return new Response("Stripe is not configured", { status: 400 });

  let event: Stripe.Event;
  try {
    event = s.webhooks.constructEvent(await req.text(), req.headers.get("stripe-signature") ?? "", secret);
  } catch (e) {
    return new Response(`Bad signature: ${String(e)}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object;
    if (session.mode === "payment" && session.payment_status === "paid") {
      const orderId = session.metadata?.order_id;
      const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      if (orderId) markPaid(orderId, pi ?? null);
    }
    if (session.mode === "setup" && session.metadata?.user_id) {
      run(
        "UPDATE users SET card_on_file = 1, stripe_customer_id = COALESCE(?, stripe_customer_id) WHERE id = ?",
        typeof session.customer === "string" ? session.customer : null,
        Number(session.metadata.user_id),
      );
    }
  }

  if (event.type === "checkout.session.expired") {
    const orderId = event.data.object.metadata?.order_id;
    const order = orderId ? getOrder(orderId) : undefined;
    if (order && order.status === "pending") {
      run("UPDATE orders SET status = 'cancelled' WHERE id = ?", order.id);
      if (!order.auction_id) unlockMoment(order.moment_id);
    }
  }

  return Response.json({ received: true });
}
