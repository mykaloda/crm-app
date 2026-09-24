import type { Metadata } from "next";
import { all } from "@/lib/db";
import { getDict } from "@/lib/request";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return { title: t.pages.faq };
}

export default async function FaqPage() {
  const { lang, t } = await getDict();
  const items = all<{ id: number; q_en: string; a_en: string; q_ru: string; a_ru: string }>("SELECT * FROM faq ORDER BY sort, id");
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((f) => ({
      "@type": "Question",
      name: lang === "ru" ? f.q_ru : f.q_en,
      acceptedAnswer: { "@type": "Answer", text: lang === "ru" ? f.a_ru : f.a_en },
    })),
  };
  return (
    <div className="container section narrow">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <h1>{t.pages.faq}</h1>
      <div className="faq" style={{ marginTop: 24 }}>
        {items.map((f) => (
          <details key={f.id}>
            <summary>{lang === "ru" ? f.q_ru : f.q_en}</summary>
            <p>{lang === "ru" ? f.a_ru : f.a_en}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
