import { approx, usd, type Currency } from "@/lib/currency";
import type { Lang } from "@/lib/i18n";

export function Price({ cents, currency, lang, from }: { cents: number; currency: Currency; lang: Lang; from?: string }) {
  const alt = approx(cents, currency, lang);
  return (
    <span className="price">
      {from ? `${from} ` : ""}
      {usd(cents)}
      {alt && <span className="price-approx">{alt}</span>}
    </span>
  );
}
