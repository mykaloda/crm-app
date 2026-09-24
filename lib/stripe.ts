import Stripe from "stripe";
import { siteUrl } from "./request";
import type { Order } from "./orders";
import { MIN } from "./time";

let client: Stripe | null | undefined;

/** Stripe client, or null when keys are not configured (test payment mode). */
export function stripe(): Stripe | null {
  if (client !== undefined) return client;
  client = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
  return client;
}

export async function createPaymentSession(order: Order, title: string, cancelPath: string) {
  const s = stripe()!;
  const session = await s.checkout.sessions.create({
    mode: "payment",
    customer_email: order.buyer_email,
    client_reference_id: order.id,
    metadata: { order_id: order.id },
    payment_intent_data: { metadata: { order_id: order.id } },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: order.amount_cents,
          tax_behavior: "inclusive",
          product_data: { name: title, description: `Digital gift for ${order.recipient_name}` },
        },
      },
    ],
    // Stripe Tax computes VAT / sales tax by the buyer's country.
    automatic_tax: { enabled: process.env.STRIPE_TAX === "1" },
    billing_address_collection: process.env.STRIPE_TAX === "1" ? "required" : "auto",
    locale: order.lang === "ru" ? "ru" : "en",
    expires_at: Math.floor((Date.now() + 31 * MIN) / 1000),
    success_url: `${siteUrl()}/order/${order.id}?paid=1`,
    cancel_url: `${siteUrl()}${cancelPath}`,
  });
  return session;
}

/** Saves a card for auction bidding (Checkout in setup mode). */
export async function createSetupSession(userId: number, email: string, customerId: string | null) {
  const s = stripe()!;
  const customer = customerId ?? (await s.customers.create({ email, metadata: { user_id: String(userId) } })).id;
  const session = await s.checkout.sessions.create({
    mode: "setup",
    customer,
    currency: "usd",
    payment_method_types: ["card"],
    metadata: { user_id: String(userId), purpose: "auction_card" },
    success_url: `${siteUrl()}/account?card=1`,
    cancel_url: `${siteUrl()}/account`,
  });
  return { session, customer };
}
