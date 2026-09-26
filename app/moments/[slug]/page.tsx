import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  availability,
  cityName,
  currentMomentOfSeries,
  momentTitle,
  queryMoments,
} from "@/lib/moments";
import { auctionForMoment } from "@/lib/auction";
import { getCurrency, getDict } from "@/lib/request";
import { fmt } from "@/lib/i18n";
import { formatDateTime, HOUR } from "@/lib/time";
import { Sky } from "@/components/Sky";
import { Price } from "@/components/Price";
import { StatusBadge } from "@/components/StatusBadge";
import { ArchiveStats } from "@/components/ArchiveStats";
import { MomentCard } from "@/components/MomentCard";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { lang, t } = await getDict();
  const m = await currentMomentOfSeries(slug);
  if (!m) return {};
  const title = momentTitle(m, lang);
  return { title, description: `${title}. ${t.moment.get[0]}`, alternates: { canonical: `/moments/${slug}` } };
}

export default async function MomentPage({ params }: Props) {
  const { slug } = await params;
  const { lang, t } = await getDict();
  const currency = await getCurrency();
  const m = await currentMomentOfSeries(slug);
  if (!m) notFound();
  const status = availability(m);
  const title = momentTitle(m, lang);
  const auction = m.sale_type === "auction" ? (await auctionForMoment(m.id)) : undefined;
  const others = await queryMoments(
    "m.event_type_id = ? AND m.status = 'on_sale' AND m.id != ? AND c.hidden = 0 ORDER BY m.price_cents LIMIT 3",
    m.event_type_id,
    m.id,
  );
  const tz = m.city.tz;
  const rule = lang === "ru" ? m.type.rule_ru : m.type.rule_en;
  const sampleStart = Date.UTC(2026, 3, 14, 16, 42);

  return (
    <>
      <section className="hero" style={{ paddingBottom: 40 }}>
        <Sky mode={m.type.kind} className="hero-sky" />
        <div className="container">
          <div className="row" style={{ marginBottom: 12 }}>
            <StatusBadge status={status} t={t} />
            <Link href={`/city/${m.city.slug}`} className="link small">
              {cityName(m.city, lang)}
            </Link>
          </div>
          <h1>{title}</h1>
          <div className="row" style={{ gap: 20, marginTop: 20 }}>
            <Price cents={m.price_cents} currency={currency} lang={lang} from={m.sale_type === "auction" ? t.common.from : undefined} />
            {status === "available" && (
              <Link href={`/checkout?moment=${slug}`} className="btn btn-primary">
                {t.moment.give}
              </Link>
            )}
            {status === "auction" && auction && (
              <Link href={`/auction/${auction.id}`} className="btn btn-primary">
                {t.moment.bid}
              </Link>
            )}
          </div>
          {status === "reserved" && <p className="notice" style={{ marginTop: 16 }}>{t.moment.reserved}</p>}
          {(status === "sold" || status === "live") && <p className="notice" style={{ marginTop: 16 }}>{t.moment.notAvailable}</p>}
          <p className="faint small" style={{ marginTop: 16 }}>
            {fmt(t.moment.number, { n: m.seq })}
            {m.earliest_start && m.earliest_start > Date.now() && !m.window_end
              ? ` · ${fmt(t.moment.monitoringFrom, { date: formatDateTime(m.earliest_start, tz, lang, false) })}`
              : ""}
            {m.window_end && m.earliest_start
              ? ` · ${fmt(t.moment.window, {
                  from: formatDateTime(m.earliest_start, tz, lang),
                  to: formatDateTime(m.window_end, tz, lang),
                })}`
              : ""}
          </p>
        </div>
      </section>

      <section className="section-tight">
        <div className="container grid-2">
          <div className="panel">
            <h2 style={{ fontSize: "1.8rem" }}>{t.moment.whatTheyGet}</h2>
            <ul className="stack" style={{ paddingLeft: 20, color: "var(--muted)" }}>
              {t.moment.get.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
            <h3 style={{ marginTop: 24 }}>{t.moment.rule}</h3>
            <p className="muted">{rule}</p>
            <p className="muted small" style={{ margin: 0 }}>
              {t.moment.noExpiry}
            </p>
          </div>
          <div className="panel" style={{ position: "relative", overflow: "hidden", isolation: "isolate" }}>
            <Sky mode="archive" />
            <div className="kicker">{t.moment.sample}</div>
            <h3>{title}</h3>
            <p className="muted small">{t.moment.sampleNote}</p>
            <div style={{ margin: "0 -8px" }}>
              <ArchiveStats
                t={t}
                lang={lang}
                tz={tz}
                startedAt={sampleStart}
                endedAt={sampleStart + 1.4 * HOUR}
                maxIntensity={m.type.kind === "rain" ? 2.8 : null}
              />
            </div>
            <div className="gift-note" style={{ margin: 0, textAlign: "left" }}>
              <blockquote>{lang === "ru" ? "«Чтобы ты всегда помнила этот город»" : "“So you always remember this city”"}</blockquote>
              <div className="muted small">{fmt(t.m.from, { name: lang === "ru" ? "Алекс" : "Alex" })}</div>
            </div>
          </div>
        </div>
      </section>

      {others.length > 0 && (
        <section className="section">
          <div className="container">
            <h2>{t.moment.otherCities}</h2>
            <div className="grid" style={{ marginTop: 16 }}>
              {others.map((o) => (
                <MomentCard key={o.id} m={o} lang={lang} t={t} currency={currency} />
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
