"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser, endSession, requestLoginCode, verifyLoginCode } from "@/lib/auth";
import { getOrder, refundOrder, sendGift, updateRecipientContact } from "@/lib/orders";
import { flushNotifications, isEmail } from "@/lib/notify";
import { getLang } from "@/lib/request";
import { run } from "@/lib/db";
import { createSetupSession, stripe } from "@/lib/stripe";

export interface LoginState {
  step: "email" | "code";
  email?: string;
  demoCode?: string | null;
  error?: string;
}

export async function login(state: LoginState, form: FormData): Promise<LoginState> {
  const lang = await getLang();
  if (form.get("website")) return state;
  if (state.step === "email") {
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    if (!isEmail(email)) return { step: "email", error: "email" };
    const demoCode = requestLoginCode(email, lang);
    return { step: "code", email, demoCode };
  }
  const ok = await verifyLoginCode(state.email ?? "", String(form.get("code") ?? ""));
  if (!ok) return { ...state, error: "code" };
  const next = String(form.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/account");
}

export async function logout() {
  await endSession();
  redirect("/account");
}

async function ownOrder(form: FormData) {
  const user = await currentUser();
  const order = getOrder(String(form.get("order")));
  if (!user || !order || order.buyer_email !== user.email) return null;
  return order;
}

export async function changeContact(form: FormData) {
  const order = await ownOrder(form);
  if (order) updateRecipientContact(order.id, String(form.get("contact") ?? ""));
  revalidatePath("/account");
}

export async function resend(form: FormData) {
  const order = await ownOrder(form);
  if (order) {
    sendGift(order.id);
    await flushNotifications();
  }
  revalidatePath("/account");
}

export async function requestRefund(form: FormData) {
  const order = await ownOrder(form);
  if (order) {
    try {
      await refundOrder(order.id);
    } catch (e) {
      console.error(e);
    }
  }
  revalidatePath("/account");
}

export async function attachCard() {
  const user = await currentUser();
  if (!user) redirect("/account");
  if (!stripe()) {
    // Test mode: mark a test card as attached.
    run("UPDATE users SET card_on_file = 1 WHERE id = ?", user.id);
    revalidatePath("/account");
    return;
  }
  const { session, customer } = await createSetupSession(user.id, user.email, user.stripe_customer_id);
  run("UPDATE users SET stripe_customer_id = ? WHERE id = ?", customer, user.id);
  redirect(session.url!);
}

