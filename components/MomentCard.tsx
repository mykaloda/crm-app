import Link from "next/link";
import { availability, cityName, momentPath, momentTitle, type MomentView } from "@/lib/moments";
import type { Dict, Lang } from "@/lib/i18n";
import type { Currency } from "@/lib/currency";
import { auctionForMoment, minNextBid } from "@/lib/auction";
import { Sky } from "./Sky";
import { Price } from "./Price";
import { StatusBadge } from "./StatusBadge";

export function MomentCard({ m, lang, t, currency }: { m: MomentView; lang: Lang; t: Dict; currency: Currency }) {
  const status = availability(m);
  const auction = m.sale_type === "auction" ? auctionForMoment(m.id) : undefined;
  const href = auction && status === "auction" ? `/auction/${auction.id}` : momentPath(m);
  const priceCents = auction && auction.status === "active" ? minNextBid(auction) : m.price_cents;
  return (
    <Link href={href} className="card">
      <div className="card-art">
        <Sky mode={m.type.kind} />
        <StatusBadge status={status} t={t} />
      </div>
      <div className="card-body">
        <div className="card-title">{momentTitle(m, lang)}</div>
        <div className="card-meta">
          {cityName(m.city, lang)} · {lang === "ru" ? m.type.name_ru : m.type.name_en}
        </div>
        <div className="card-foot">
          <Price cents={priceCents} currency={currency} lang={lang} from={m.sale_type === "auction" ? t.common.from : undefined} />
        </div>
      </div>
    </Link>
  );
}
