"use server";

import { revalidatePath } from "next/cache";
import { getOrder, sendGift } from "@/lib/orders";
import { flushNotifications } from "@/lib/notify";

export async function sendNow(form: FormData) {
  const id = String(form.get("order"));
  const order = await getOrder(id);
  if (!order || order.status !== "paid") return;
  await sendGift(id);
  await flushNotifications();
  revalidatePath(`/order/${id}`);
}
