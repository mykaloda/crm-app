import Link from "next/link";
import { all } from "@/lib/db";
import { queryMoments, soldCount } from "@/lib/moments";
import { getCurrency, getDict } from "@/lib/request";
import { MomentCard } from "@/components/MomentCard";
import { Sky } from "@/components/Sky";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { lang, t } = await getDict();
  const currency = await getCurrency();
  const showcase = await queryMoments(
    "m.status = 'on_sale' AND c.hidden = 0 ORDER BY m.sale_type = 'auction', m.price_cents LIMIT 6",
  );
  const sold = await soldCount();
  const reviews = await all<{ id: number; author: string; text_en: string; text_ru: string }>(
    "SELECT * FROM reviews WHERE visible = 1 ORDER BY created_at DESC LIMIT 6",
  );

  return (
    <>
      <section className="hero">
        <Sky mode="rain" className="hero-sky" />
        <div className="container">
          <div className="kicker">{t.home.kicker}</div>
          <h1>{t.home.title}</h1>
          <p className="lead">{t.home.lead}</p>
          <div className="row actions">
            <Link href="/moments" className="btn btn-primary">
              {t.home.cta}
            </Link>
            <Link href="/how-it-works" className="btn btn-ghost">
              {t.home.secondary}
            </Link>
          </div>
          <div className="counter">
            <strong className="num">{sold.toLocaleString(lang === "ru" ? "ru-RU" : "en-US")}</strong>
            <span>{t.home.sold}</span>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>{t.home.stepsTitle}</h2>
          <div className="steps" style={{ marginTop: 20 }}>
            {t.home.steps.map(([title, text]) => (
              <div className="step" key={title}>
                <h3>{title}</h3>
                <p className="muted" style={{ margin: 0 }}>
                  {text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="row between" style={{ marginBottom: 20 }}>
            <h2 style={{ margin: 0 }}>{t.home.showcase}</h2>
            <Link href="/moments" className="link">
              {t.home.all} →
            </Link>
          </div>
          <div className="grid">
            {showcase.map((m) => (
              <MomentCard key={m.id} m={m} lang={lang} t={t} currency={currency} />
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="panel" style={{ display: "grid", gap: 8 }}>
            <div className="kicker">{t.tagline}</div>
            <h2 style={{ margin: 0 }}>{t.home.uniqueTitle}</h2>
            <p className="lead" style={{ margin: 0 }}>
              {t.home.uniqueText}
            </p>
          </div>
        </div>
      </section>

      {reviews.length > 0 && (
        <section className="section">
          <div className="container">
            <h2>{t.home.reviews}</h2>
            <div className="grid" style={{ marginTop: 20 }}>
              {reviews.map((r) => (
                <figure key={r.id} className="panel-flat" style={{ margin: 0 }}>
                  <blockquote style={{ margin: 0, fontFamily: "var(--font-serif)", fontSize: "1.3rem", lineHeight: 1.35 }}>
                    “{lang === "ru" ? r.text_ru : r.text_en}”
                  </blockquote>
                  <figcaption className="muted small" style={{ marginTop: 12 }}>
                    {r.author}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
