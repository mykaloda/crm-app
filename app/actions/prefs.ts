"use server";

import { cookies } from "next/headers";
import { CURRENCIES, type Currency } from "@/lib/currency";

const year = 365 * 24 * 3600;

export async function setLang(lang: string) {
  if (lang !== "en" && lang !== "ru") return;
  (await cookies()).set("lang", lang, { maxAge: year, path: "/", sameSite: "lax" });
}

export async function setCurrency(cur: string) {
  if (!CURRENCIES.includes(cur as Currency)) return;
  (await cookies()).set("cur", cur, { maxAge: year, path: "/", sameSite: "lax" });
}
