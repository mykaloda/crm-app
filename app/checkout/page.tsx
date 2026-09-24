import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { availability, currentMomentOfSeries, momentTitle, type MomentView } from "@/lib/moments";
import { getAuction, topBid } from "@/lib/auction";
import { currentUser } from "@/lib/auth";
import { getCurrency, getDict } from "@/lib/request";
import { fmt } from "@/lib/i18n";
import { usd } from "@/lib/currency";
import { Sky } from "@/components/Sky";
import { Price } from "@/components/Price";
import { CheckoutForm } from "./CheckoutForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { lang, t } = await getDict();
  const currency = await getCurrency();
  const user = await currentUser();

  let moment: MomentView | undefined;
  let amount = 0;
  let auctionId: number | undefined;
  let blocked: string | null = null;

  if (sp.auction) {
    const a = getAuction(Number(sp.auction));
    if (!a) notFound();
    const top = topBid(a.id);
    moment = a.moment;
    auctionId = a.id;
    amount = top?.amount_cents ?? a.start_cents;
    if (!user) blocked = t.auction.login;
    else if (a.status !== "awaiting_payment" || top?.user_id !== user.id) blocked = t.auction.errors.closed;
  } else {
    moment = currentMomentOfSeries(sp.moment ?? "");
    if (!moment) notFound();
    amount = moment.price_cents;
    const status = availability(moment);
    if (status === "reserved") blocked = t.moment.reserved;
    else if (status !== "available") blocked = t.moment.notAvailable;
  }

  const title = momentTitle(moment, lang);

  return (
    <div className="container section">
      <h1 style={{ fontSize: "2.4rem" }}>{t.checkout.title}</h1>
      <div className="grid-2" style={{ marginTop: 20, alignItems: "start" }}>
        <div>
          {sp.cancelled && <p className="notice" style={{ marginBottom: 16 }}>{t.checkout.cancelled}</p>}
          {blocked ? (
            <div className="panel">
              <p className="notice notice-red">{blocked}</p>
              <Link href={sp.auction ? "/account" : "/moments"} className="btn btn-ghost" style={{ marginTop: 16 }}>
                {sp.auction ? t.account.signIn : t.common.back}
              </Link>
            </div>
          ) : (
            <CheckoutForm
              t={t}
              moment={sp.moment}
              auction={auctionId}
              priceLabel={fmt(t.checkout.pay, { price: usd(amount) })}
              defaultEmail={user?.email}
            />
          )}
        </div>
        <aside className="panel" style={{ position: "relative", overflow: "hidden", isolation: "isolate", minHeight: 260 }}>
          <Sky mode={moment.type.kind} />
          <div className="kicker">{t.checkout.summary}</div>
          <h2 style={{ fontSize: "2rem" }}>{title}</h2>
          <Price cents={amount} currency={currency} lang={lang} />
          <p className="muted small" style={{ marginTop: 16 }}>
            {lang === "ru" ? moment.type.rule_ru : moment.type.rule_en}
          </p>
          {!blocked && !auctionId && <p className="notice notice-gold small">{t.checkout.lockNote}</p>}
        </aside>
      </div>
    </div>
  );
}
