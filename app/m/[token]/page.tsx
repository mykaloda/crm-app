import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { all, run } from "@/lib/db";
import { getOrderByToken, type Order } from "@/lib/orders";
import { getMoment, momentTitle, type MomentView } from "@/lib/moments";
import { giverOrDefault, isEmail } from "@/lib/notify";
import { currentWeather, forecast } from "@/lib/weather";
import { siteUrl } from "@/lib/request";
import { dictionaries, fmt, type Dict, type Lang } from "@/lib/i18n";
import { formatDateTime, formatTime, sunrise } from "@/lib/time";
import { Sky } from "@/components/Sky";
import { Timer } from "@/components/Timer";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ShareButton } from "@/components/ShareButton";
import { ArchiveStats } from "@/components/ArchiveStats";
import { Forecast, WeatherNow } from "@/components/Weather";
import { removeRecord, setChannel } from "../actions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

async function load(token: string) {
  const order = await getOrderByToken(token);
  if (!order || (order.status !== "paid" && order.status !== "refunded")) return null;
  return { order, moment: (await getMoment(order.moment_id))! };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const data = await load(token);
  if (!data) return { robots: { index: false } };
  const title = `${momentTitle(data.moment, data.order.lang)} · ${data.order.recipient_name}`;
  return {
    title,
    robots: { index: false, follow: false },
    openGraph: { title, images: [{ url: `/api/share/${token}`, width: 1080, height: 1350 }] },
  };
}

interface M {
  taken_at: number;
  source: string;
  temperature: number | null;
  precipitation: number | null;
  condition_met: number;
  disputed: number;
  note: string | null;
}

export default async function RecipientPage({ params }: Props) {
  const { token } = await params;
  const data = await load(token);
  if (!data) notFound();
  const { order, moment } = data;
  // The recipient sees the page in the language the gift was bought in.
  const lang = order.lang;
  const tt = dictionaries[lang];

  if (order.deleted_by_recipient || order.status === "refunded") {
    return (
      <div className="container section narrow center">
        <p className="muted">{order.deleted_by_recipient ? tt.m.removed : tt.order.refunded}</p>
      </div>
    );
  }
  if (!order.opened_at) await run("UPDATE orders SET opened_at = ? WHERE id = ?", Date.now(), order.id);

  const state = moment.status === "live" ? "live" : moment.status === "completed" ? "archive" : "waiting";
  return (
    <div className="moment-page">
      <Sky mode={state === "waiting" ? "waiting" : state === "archive" ? "archive" : moment.type.kind} />
      <div className="container moment-inner">
        {state === "waiting" && <Waiting order={order} m={moment} t={tt} lang={lang} />}
        {state === "live" && <Live order={order} m={moment} t={tt} lang={lang} />}
        {state === "archive" && <Archive order={order} m={moment} t={tt} lang={lang} />}
        <GiftNote order={order} m={moment} t={tt} lang={lang} revealed={state !== "waiting"} />
        {!order.notify_channel && state === "waiting" && <ChannelPicker order={order} t={tt} />}
        <details style={{ marginTop: 40 }}>
          <summary className="faint small" style={{ cursor: "pointer" }}>
            {tt.m.remove}
          </summary>
          <form action={removeRecord} style={{ marginTop: 12 }}>
            <input type="hidden" name="token" value={order.token} />
            <button className="btn btn-danger btn-small">{tt.m.removeConfirm}</button>
          </form>
        </details>
      </div>
    </div>
  );
}

type Part = { order: Order; m: MomentView; t: Dict; lang: Lang };

async function Waiting({ m, t, lang }: Part) {
  const title = momentTitle(m, lang);
  const astro = m.type.kind === "sunrise" || m.type.kind === "meteor";
  const [now, days] = astro ? [null, null] : await Promise.all([currentWeather(m.city), forecast(m.city)]);
  const expected =
    m.type.kind === "sunrise" && m.earliest_start
      ? sunrise(m.earliest_start, m.city.lat, m.city.lon, m.city.tz)
      : m.type.kind === "meteor"
        ? m.earliest_start
        : null;
  return (
    <>
      <div className="kicker">{title}</div>
      <h1>{fmt(t.m.waitingTitle, { event: (lang === "ru" ? m.type.name_ru : m.type.name_en).toLowerCase() })}</h1>
      <p className="lead" style={{ margin: "0 auto" }}>
        {fmt(t.m.waitingLead, { in: lang === "ru" ? m.city.in_ru : m.city.in_en })}{" "}
        {expected ? fmt(t.m.waitingAstro, { date: formatDateTime(expected, m.city.tz, lang) }) : ""}
      </p>
      {m.earliest_start && m.earliest_start > Date.now() && (
        <p className="muted small" style={{ marginTop: 12 }}>
          {fmt(t.moment.monitoringFrom, { date: formatDateTime(m.earliest_start, m.city.tz, lang, false) })}
        </p>
      )}
      {!astro && (
        <div className="panel" style={{ maxWidth: 620, margin: "32px auto 0", textAlign: "left", background: "rgba(21,27,49,0.75)" }}>
          <WeatherNow r={now} t={t} />
          <Forecast days={days} lang={lang} t={t} />
        </div>
      )}
      <AutoRefresh seconds={300} />
    </>
  );
}

async function latest(m: MomentView) {
  return (await all<M>(
    "SELECT * FROM measurements WHERE moment_id = ? AND note IS NULL ORDER BY taken_at DESC LIMIT 1",
    m.id,
  ))[0];
}

async function Live({ order, m, t, lang }: Part) {
  const last = await latest(m);
  const unit = lang === "ru" ? "мм/ч" : "mm/h";
  return (
    <>
      <AutoRefresh seconds={60} />
      <span className="badge badge-live">{t.status.live}</span>
      <h1 style={{ marginTop: 16 }}>{fmt(t.m.liveTitle, { name: order.recipient_name })}</h1>
      <p className="lead" style={{ margin: "0 auto" }}>{fmt(t.m.liveLead, { title: momentTitle(m, lang) })}</p>
      <div className="big-timer">
        <Timer since={m.started_at ?? Date.now()} />
      </div>
      <div className="faint small">{t.m.elapsed}</div>
      <div className="stats">
        <div className="stat">
          <div className="label">{t.m.started}</div>
          <div className="value">{formatTime(m.started_at!, m.city.tz, lang)}</div>
        </div>
        <div className="stat">
          <div className="label">{t.m.temperature}</div>
          <div className="value">{last?.temperature != null ? `${Math.round(last.temperature)}°C` : "—"}</div>
        </div>
        <div className="stat">
          <div className="label">{t.m.intensity}</div>
          <div className="value">{last?.precipitation != null ? `${last.precipitation} ${unit}` : "—"}</div>
        </div>
        <div className="stat">
          <div className="label">{t.m.maxIntensity}</div>
          <div className="value">{m.max_intensity != null ? `${m.max_intensity} ${unit}` : "—"}</div>
        </div>
      </div>
      <p className="faint small">{t.m.updates}</p>
    </>
  );
}

async function Archive({ order, m, t, lang }: Part) {
  const log = await all<M>("SELECT * FROM measurements WHERE moment_id = ? ORDER BY taken_at DESC LIMIT 500", m.id);
  const title = momentTitle(m, lang);
  const astro = m.type.kind === "sunrise" || m.type.kind === "meteor";
  return (
    <>
      <div className="kicker">{fmt(t.m.giftFor, { name: order.recipient_name })}</div>
      <h1>{title}</h1>
      <p className="lead" style={{ margin: "0 auto" }}>{formatDateTime(m.started_at!, m.city.tz, lang, false)}</p>
      <ArchiveStats
        t={t}
        lang={lang}
        tz={m.city.tz}
        startedAt={m.started_at!}
        endedAt={m.ended_at!}
        maxIntensity={astro ? null : m.max_intensity}
      />
      <div className="row" style={{ justifyContent: "center" }}>
        <ShareButton url={`${siteUrl()}/m/${order.token}`} title={title} label={t.m.share} />
        <a className="btn btn-ghost" href={`/api/share/${order.token}`} download={`moment-${order.id}.png`}>
          {t.m.image}
        </a>
      </div>
      {m.confirmed_by && <p className="faint small" style={{ marginTop: 16 }}>{fmt(t.m.sources, { sources: m.confirmed_by })}</p>}
      {log.length > 0 && (
        <details className="panel" style={{ maxWidth: 720, margin: "28px auto 0", textAlign: "left" }}>
          <summary style={{ cursor: "pointer" }}>
            {t.m.measurements} ({log.length})
          </summary>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table">
              <tbody>
                {log.map((r, i) => (
                  <tr key={i}>
                    <td className="num">{formatDateTime(r.taken_at, m.city.tz, lang)}</td>
                    <td className="muted">{r.source}</td>
                    <td className="num">{r.precipitation ?? "—"}</td>
                    <td className="num">{r.temperature != null ? `${r.temperature}°` : ""}</td>
                    <td>{r.disputed ? "⚠" : r.condition_met ? "✓" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </>
  );
}

function GiftNote({ order, t, lang, revealed }: Part & { revealed: boolean }) {
  const hidden = Boolean(order.hide_message) && !revealed;
  return (
    <div className="gift-note">
      {order.message && !hidden && <blockquote>«{order.message}»</blockquote>}
      {order.message && hidden && <p className="muted" style={{ margin: 0 }}>{t.m.hiddenMessage}</p>}
      <div className="muted small" style={{ marginTop: 8 }}>
        {fmt(t.m.giftFor, { name: order.recipient_name })} · {fmt(t.m.from, { name: giverOrDefault(order.giver_name, lang) })}
      </div>
    </div>
  );
}

function ChannelPicker({ order, t }: { order: Order; t: Dict }) {
  const options = [isEmail(order.recipient_contact) ? "email" : "sms", "none"] as const;
  return (
    <form action={setChannel} className="gift-note" style={{ textAlign: "left" }}>
      <input type="hidden" name="token" value={order.token} />
      <div style={{ fontWeight: 600, marginBottom: 12 }}>{t.m.notifyTitle}</div>
      <div className="segmented">
        {options.map((o, i) => (
          <label key={o}>
            <input type="radio" name="channel" value={o} defaultChecked={i === 0} /> {t.m[o]}
          </label>
        ))}
      </div>
      <button className="btn btn-ghost btn-small" style={{ marginTop: 12 }}>
        {t.account.save}
      </button>
      <Link href="/faq" className="link small" style={{ marginLeft: 12 }}>
        FAQ
      </Link>
    </form>
  );
}
