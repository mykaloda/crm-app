import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cityName, getCity, momentTitle, queryMoments } from "@/lib/moments";
import { currentWeather, forecast } from "@/lib/weather";
import { getCurrency, getDict } from "@/lib/request";
import { formatDateTime, formatDuration } from "@/lib/time";
import { MomentCard } from "@/components/MomentCard";
import { Forecast, WeatherNow } from "@/components/Weather";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { lang, t } = await getDict();
  const city = await getCity(slug);
  if (!city) return {};
  return { title: cityName(city, lang), description: `${cityName(city, lang)}: ${t.city.available}` };
}

export default async function CityPage({ params }: Props) {
  const { slug } = await params;
  const { lang, t } = await getDict();
  const currency = await getCurrency();
  const city = await getCity(slug);
  if (!city || city.hidden) notFound();
  const [now, days] = await Promise.all([currentWeather(city), forecast(city)]);
  const available = await queryMoments("m.city_id = ? AND m.status = 'on_sale' ORDER BY m.price_cents", city.id);
  const history = await queryMoments(
    "m.city_id = ? AND m.status IN ('completed', 'live', 'sold') ORDER BY COALESCE(m.started_at, m.created_at) DESC LIMIT 20",
    city.id,
  );

  return (
    <div className="container section">
      <h1>{cityName(city, lang)}</h1>
      <div className="panel" style={{ marginTop: 16 }}>
        <div className="label">{t.city.now}</div>
        <WeatherNow r={now} t={t} />
        <Forecast days={days} lang={lang} t={t} />
      </div>

      <h2 style={{ marginTop: 48 }}>{t.city.available}</h2>
      {available.length ? (
        <div className="grid">
          {available.map((m) => (
            <MomentCard key={m.id} m={m} lang={lang} t={t} currency={currency} />
          ))}
        </div>
      ) : (
        <p className="muted">{t.city.none}</p>
      )}

      <h2 style={{ marginTop: 48 }}>{t.city.history}</h2>
      {history.length ? (
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {history.map((m) => (
                <tr key={m.id}>
                  <td>{momentTitle(m, lang)} · №{m.seq}</td>
                  <td className="muted">{t.status[m.status === "sold" ? "sold" : m.status === "live" ? "live" : "completed"]}</td>
                  <td className="muted">{m.started_at ? formatDateTime(m.started_at, city.tz, lang) : ""}</td>
                  <td className="muted">{m.started_at && m.ended_at ? formatDuration(m.ended_at - m.started_at, lang) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">{t.city.noHistory}</p>
      )}
    </div>
  );
}
