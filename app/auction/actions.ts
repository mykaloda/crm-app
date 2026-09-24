"use server";

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { placeBid } from "@/lib/auction";
import { flushNotifications } from "@/lib/notify";

export interface BidState {
  error?: "closed" | "low" | "self" | "card" | "login";
  min?: number;
  ok?: boolean;
}

export async function bid(_: BidState, form: FormData): Promise<BidState> {
  const user = await currentUser();
  if (!user) return { error: "login" };
  const auctionId = Number(form.get("auction"));
  const amount = Math.round(Number(String(form.get("amount")).replace(",", ".")) * 100);
  if (!Number.isFinite(amount) || amount <= 0) return { error: "low" };
  const res = placeBid(auctionId, user, amount);
  void flushNotifications();
  revalidatePath(`/auction/${auctionId}`);
  return res.error ? res : { ok: true };
}
