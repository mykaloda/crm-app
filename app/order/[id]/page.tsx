import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrder } from "@/lib/orders";
import { getMoment, momentTitle } from "@/lib/moments";
import { giverOrDefault } from "@/lib/notify";
import { getDict, siteUrl } from "@/lib/request";
import { fmt } from "@/lib/i18n";
import { formatDateTime } from "@/lib/time";
import { AutoRefresh } from "@/components/AutoRefresh";
import { CopyButton } from "@/components/CopyButton";
import { sendNow } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Order", robots: { index: false } };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { lang, t } = await getDict();
  const order = getOrder(id);
  if (!order) notFound();
  const m = getMoment(order.moment_id)!;
  const title = momentTitle(m, lang);
  const recipientUrl = `${siteUrl()}/m/${order.token}`;

  if (order.status === "pending") {
    return (
      <div className="container section narrow center">
        <AutoRefresh seconds={3} />
        <h1 style={{ fontSize: "2.2rem" }}>{t.order.pending}</h1>
        <p className="muted">
          {t.order.number} {order.id}
        </p>
      </div>
    );
  }

  return (
    <div className="container section narrow">
      {order.status === "refunded" && <p className="notice notice-red">{t.order.refunded}</p>}
      {order.status === "paid" && (
        <>
          <div className="kicker">
            {t.order.number} {order.id}
          </div>
          <h1 style={{ fontSize: "2.4rem" }}>{t.order.thanks}</h1>
        </>
      )}

      <div className="cert" style={{ marginTop: 24 }}>
        <div className="kicker">{t.order.certificate}</div>
        <h2 style={{ fontSize: "2rem", marginBottom: 8 }}>{title}</h2>
        <div className="muted">{fmt(t.order.for, { name: "" }).trim()}</div>
        <div className="for">{order.recipient_name}</div>
        {order.message && <p style={{ fontFamily: "var(--font-serif)", fontSize: "1.3rem", marginTop: 16 }}>«{order.message}»</p>}
        <p className="muted small">{fmt(t.order.from, { name: giverOrDefault(order.giver_name, lang) })}</p>
      </div>

      {order.status === "paid" && (
        <div className="panel" style={{ marginTop: 24 }}>
          <div className="label">{t.order.link}</div>
          <p style={{ wordBreak: "break-all", margin: "6px 0 14px" }}>
            <Link className="link" href={`/m/${order.token}`}>
              {recipientUrl}
            </Link>
          </p>
          <div className="row">
            <CopyButton text={recipientUrl} label={t.order.copy} done={t.order.copied} />
            <a className="btn btn-ghost btn-small" href={`/api/order/${order.id}/certificate`}>
              {t.order.download}
            </a>
            {!order.sent_at && (
              <form action={sendNow}>
                <input type="hidden" name="order" value={order.id} />
                <button className="btn btn-primary btn-small">{t.order.sendNow}</button>
              </form>
            )}
          </div>
          <p className="muted small" style={{ marginTop: 14, marginBottom: 0 }}>
            {order.sent_at
              ? fmt(t.order.sent, { contact: order.recipient_contact })
              : order.send_at
                ? fmt(t.order.scheduled, { date: formatDateTime(order.send_at, m.city.tz, lang) })
                : ""}
          </p>
        </div>
      )}

      <div className="row" style={{ marginTop: 20 }}>
        <Link href={`/m/${order.token}`} className="link">
          {t.order.open} →
        </Link>
        <Link href="/account" className="link">
          {t.order.manage} →
        </Link>
      </div>
    </div>
  );
}
