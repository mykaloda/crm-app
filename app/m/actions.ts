"use server";

import { revalidatePath } from "next/cache";
import { run } from "@/lib/db";
import { getOrderByToken } from "@/lib/orders";

export async function setChannel(form: FormData) {
  const token = String(form.get("token"));
  const channel = String(form.get("channel"));
  if (!["email", "sms", "none"].includes(channel)) return;
  if (!getOrderByToken(token)) return;
  run("UPDATE orders SET notify_channel = ? WHERE token = ?", channel, token);
  revalidatePath(`/m/${token}`);
}

/** Recipient's right to unsubscribe and delete the record (legal section). */
export async function removeRecord(form: FormData) {
  const token = String(form.get("token"));
  if (!getOrderByToken(token)) return;
  run(
    "UPDATE orders SET deleted_by_recipient = 1, notify_channel = 'none', recipient_contact = '', message = NULL WHERE token = ?",
    token,
  );
  revalidatePath(`/m/${token}`);
}
