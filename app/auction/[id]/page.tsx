import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { bidsFor, getAuction, maskEmail, minNextBid, topBid } from "@/lib/auction";
import { momentTitle } from "@/lib/moments";
import { currentUser } from "@/lib/auth";
import { getCurrency, getDict } from "@/lib/request";
import { formatDateTime } from "@/lib/time";
import { usd } from "@/lib/currency";
import { Sky } from "@/components/Sky";
import { Price } from "@/components/Price";
import { Timer } from "@/components/Timer";
import { AutoRefresh } from "@/components/AutoRefresh";
import { BidForm } from "../BidForm";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { lang, t } = await getDict();
  const a = getAuction(Number(id));
  return a ? { title: `${t.auction.title}: ${momentTitle(a.moment, lang)}` } : {};
}

export default async function AuctionPage({ params }: Props) {
  const { id } = await params;
  const { lang, t } = await getDict();
  const currency = await getCurrency();
  const a = getAuction(Number(id));
  if (!a) notFound();
  const user = await currentUser();
  const bids = bidsFor(a.id);
  const top = topBid(a.id);
  const active = a.status === "active" && a.ends_at > Date.now();
  const tz = a.moment.city.tz;

  return (
    <>
      <AutoRefresh seconds={30} />
      <section className="hero" style={{ paddingBottom: 32 }}>
        <Sky mode={a.moment.type.kind} className="hero-sky" />
        <div className="container">
          <span className="badge badge-auction">{t.auction.title}</span>
          <h1 style={{ marginTop: 14 }}>{momentTitle(a.moment, lang)}</h1>
          <p className="lead">{lang === "ru" ? a.moment.type.rule_ru : a.moment.type.rule_en}</p>
        </div>
      </section>
      <div className="container grid-2" style={{ alignItems: "start" }}>
        <div className="panel">
          <div className="row between">
            <div>
              <div className="label">{top ? t.auction.current : t.auction.start}</div>
              <Price cents={top?.amount_cents ?? a.start_cents} currency={currency} lang={lang} />
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="label">{active ? t.auction.endsIn : t.auction.ended}</div>
              {active ? <Timer until={a.ends_at} className="price num" /> : <span className="muted">{formatDateTime(a.ends_at, tz, lang)}</span>}
            </div>
          </div>
          <p className="faint small" style={{ marginTop: 10 }}>
            {t.auction.step}: {usd(a.step_cents)} · {t.auction.extend}
          </p>
          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "18px 0" }} />

          {active && !user && (
            <Link href={`/account?next=/auction/${a.id}`} className="btn btn-primary btn-block">
              {t.auction.login}
            </Link>
          )}
          {active && user && !user.card_on_file && (
            <Link href="/account#card" className="btn btn-primary btn-block">
              {t.auction.card}
            </Link>
          )}
          {active && user?.card_on_file ? (
            top?.user_id === user.id ? (
              <p className="notice notice-gold">{t.auction.leading}</p>
            ) : (
              <BidForm auctionId={a.id} minCents={minNextBid(a)} t={t} />
            )
          ) : null}
          {a.status === "awaiting_payment" &&
            (user && top?.user_id === user.id ? (
              <div className="stack">
                <p className="notice notice-gold">{t.auction.won}</p>
                <Link href={`/checkout?auction=${a.id}`} className="btn btn-primary btn-block">
                  {t.auction.payNow}
                </Link>
              </div>
            ) : (
              <p className="notice">{t.auction.awaiting}</p>
            ))}
          {a.status === "sold" && <p className="notice">{t.auction.sold}</p>}
          <p className="hint" style={{ marginTop: 14 }}>
            {t.auction.cardNote}
          </p>
        </div>

        <div className="panel">
          <h3>{t.auction.history}</h3>
          {bids.length ? (
            <table className="table">
              <tbody>
                {bids.map((b) => (
                  <tr key={b.id} style={{ opacity: b.status === "forfeited" ? 0.4 : 1 }}>
                    <td className="num">{usd(b.amount_cents)}</td>
                    <td className="muted">{maskEmail(b.email ?? "")}</td>
                    <td className="faint small">{formatDateTime(b.created_at, tz, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">{t.auction.noBids}</p>
          )}
        </div>
      </div>
    </>
  );
}
