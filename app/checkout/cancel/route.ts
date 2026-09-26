import { NextResponse, type NextRequest } from "next/server";
import { run } from "@/lib/db";
import { getOrder } from "@/lib/orders";
import { getMoment, momentSlug, unlockMoment } from "@/lib/moments";

/** Stripe cancel_url: releases the reservation and returns to checkout. */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("order") ?? "";
  const order = await getOrder(id);
  if (!order) return NextResponse.redirect(new URL("/moments", req.url));
  if (order.status === "pending") {
    await run("UPDATE orders SET status = 'cancelled' WHERE id = ?", id);
    if (!order.auction_id) await unlockMoment(order.moment_id);
  }
  if (order.auction_id) return NextResponse.redirect(new URL(`/auction/${order.auction_id}`, req.url));
  const m = await getMoment(order.moment_id);
  return NextResponse.redirect(new URL(m ? `/checkout?moment=${momentSlug(m)}&cancelled=1` : "/moments", req.url));
}
