import type { Metadata } from "next";
import { eventTypes, listCities, queryMoments } from "@/lib/moments";
import { getCurrency, getDict } from "@/lib/request";
import { MomentCard } from "@/components/MomentCard";
import { usd } from "@/lib/currency";
import { fmt } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return { title: t.catalog.title, description: t.catalog.lead };
}

const PRICE_CAPS = [5000, 20000, 50000, 100000];

export default async function Catalog({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { lang, t } = await getDict();
  const currency = await getCurrency();
  const cities = listCities();
  const types = eventTypes();

  const where = ["c.hidden = 0"];
  const params: (string | number)[] = [];
  if (sp.city) {
    where.push("c.slug = ?");
    params.push(sp.city);
  }
  if (sp.type) {
    where.push("m.event_type_id = (SELECT id FROM event_types WHERE slug = ?)");
    params.push(sp.type);
  }
  if (sp.max && Number(sp.max) > 0) {
    where.push("m.price_cents <= ?");
    params.push(Number(sp.max));
  }
  if (sp.show === "all") {
    // Latest moment of every series, whatever its status.
    where.push("m.id IN (SELECT MAX(id) FROM moments WHERE offering_id IS NOT NULL GROUP BY offering_id)");
  } else {
    where.push("m.status = 'on_sale'");
  }
  const moments = queryMoments(`${where.join(" AND ")} ORDER BY m.sale_type = 'auction', m.price_cents, c.name_en`, ...params);

  return (
    <div className="container section">
      <h1>{t.catalog.title}</h1>
      <p className="lead">{t.catalog.lead}</p>

      <form className="filters panel" style={{ margin: "24px 0 28px", padding: 16 }} method="get">
        <div className="field">
          <label htmlFor="f-city">{t.catalog.city}</label>
          <select id="f-city" name="city" className="input" defaultValue={sp.city ?? ""}>
            <option value="">{t.catalog.any}</option>
            {cities.map((c) => (
              <option key={c.id} value={c.slug}>
                {lang === "ru" ? c.name_ru : c.name_en}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ marginTop: 0 }}>
          <label htmlFor="f-type">{t.catalog.type}</label>
          <select id="f-type" name="type" className="input" defaultValue={sp.type ?? ""}>
            <option value="">{t.catalog.any}</option>
            {types.map((ty) => (
              <option key={ty.id} value={ty.slug}>
                {lang === "ru" ? ty.name_ru : ty.name_en}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ marginTop: 0 }}>
          <label htmlFor="f-max">{t.catalog.price}</label>
          <select id="f-max" name="max" className="input" defaultValue={sp.max ?? ""}>
            <option value="">{t.catalog.any}</option>
            {PRICE_CAPS.map((p) => (
              <option key={p} value={p}>
                {fmt(t.catalog.upTo, { price: usd(p) })}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ marginTop: 0 }}>
          <label htmlFor="f-show">{t.catalog.status}</label>
          <select id="f-show" name="show" className="input" defaultValue={sp.show ?? ""}>
            <option value="">{t.catalog.onSale}</option>
            <option value="all">{t.catalog.everything}</option>
          </select>
        </div>
        <button className="btn btn-primary" type="submit">
          {t.catalog.apply}
        </button>
      </form>

      {moments.length ? (
        <div className="grid">
          {moments.map((m) => (
            <MomentCard key={m.id} m={m} lang={lang} t={t} currency={currency} />
          ))}
        </div>
      ) : (
        <p className="muted">{t.catalog.empty}</p>
      )}
    </div>
  );
}
