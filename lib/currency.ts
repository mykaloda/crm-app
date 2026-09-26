/** Prices are charged in USD; other currencies are shown for reference only. */
export const CURRENCIES = ["USD", "EUR", "GBP", "UAH", "RUB"] as const;
export type Currency = (typeof CURRENCIES)[number];

const DEFAULT_RATES: Record<Currency, number> = { USD: 1, EUR: 0.86, GBP: 0.75, UAH: 41.5, RUB: 82 };

function rates(): Record<Currency, number> {
  try {
    return { ...DEFAULT_RATES, ...(process.env.DISPLAY_RATES ? JSON.parse(process.env.DISPLAY_RATES) : {}) };
  } catch {
    return DEFAULT_RATES;
  }
}

export function usd(cents: number): string {
  const v = cents / 100;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: v % 1 ? 2 : 0 })}`;
}

export function approx(cents: number, cur: Currency, lang: "en" | "ru"): string | null {
  if (cur === "USD") return null;
  const value = (cents / 100) * rates()[cur];
  return (
    "≈ " +
    new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-GB", {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 0,
    }).format(value)
  );
}
