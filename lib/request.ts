import { cookies, headers } from "next/headers";
import { dictionaries, type Lang } from "./i18n";
import { CURRENCIES, type Currency } from "./currency";

export async function getLang(): Promise<Lang> {
  const c = (await cookies()).get("lang")?.value;
  if (c === "en" || c === "ru") return c;
  const accept = (await headers()).get("accept-language") ?? "";
  return /^(ru|uk|be|kk)\b/i.test(accept) ? "ru" : "en";
}

export async function getDict() {
  const lang = await getLang();
  return { lang, t: dictionaries[lang] };
}

export async function getCurrency(): Promise<Currency> {
  const c = (await cookies()).get("cur")?.value as Currency | undefined;
  return c && CURRENCIES.includes(c) ? c : "USD";
}

export function siteUrl(): string {
  return (process.env.SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}
