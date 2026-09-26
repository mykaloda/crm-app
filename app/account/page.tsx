import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { ordersForEmail } from "@/lib/orders";
import { getMoment, momentTitle } from "@/lib/moments";
import { bidsForUser } from "@/lib/auction";
import { getDict } from "@/lib/request";
import { usd } from "@/lib/currency";
import { formatDateTime } from "@/lib/time";
import { fmt } from "@/lib/i18n";
import { LoginForm } from "./LoginForm";
import { attachCard, changeContact, logout, requestRefund, resend } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account", robots: { index: false } };

export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { lang, t } = await getDict();
  const user = await currentUser();

  if (!user) {
    return (
      <div className="container section">
        <h1 style={{ fontSize: "2.4rem" }}>{t.account.signIn}</h1>
        <LoginForm t={t} next={sp.next} />
      </div>
    );
  }

  const orders = await ordersForEmail(user.email);
  const bids = await bidsForUser(user.id);

  return (
    <div className="container section">
      <div className="row between">
        <h1 style={{ fontSize: "2.4rem", margin: 0 }}>{t.account.title}</h1>
        <form action={logout}>
          <button className="btn btn-ghost btn-small">{t.account.signOut}</button>
        </form>
      </div>
      <p className="muted">{user.email}</p>

      <h2 style={{ marginTop: 32 }}>{t.account.orders}</h2>
      {orders.length === 0 && <p className="muted">{t.account.noOrders}</p>}
      <div className="stack">
        {orders.map(async (o) => {
          const m = (await getMoment(o.moment_id))!;
          const beforeEvent = o.status === "paid" && m.status === "sold";
          const status =
            o.status === "refunded" || o.status === "cancelled"
              ? t.order.refunded
              : t.status[m.status === "sold" ? "sold" : m.status === "live" ? "live" : "completed"];
          return (
            <div key={o.id} className="panel">
              <div className="row between">
                <div>
                  <div className="card-title">{momentTitle(m, lang)}</div>
                  <div className="muted small">
                    {o.id} · {fmt(t.order.for, { name: o.recipient_name })} · {usd(o.amount_cents)} ·{" "}
                    {formatDateTime(o.created_at, m.city.tz, lang, false)}
                  </div>
                </div>
                <span className={`badge badge-${m.status === "live" ? "live" : m.status === "completed" ? "completed" : "sold"}`}>{status}</span>
              </div>
              {o.status === "paid" && (
                <div className="row" style={{ marginTop: 14 }}>
                  <Link href={`/m/${o.token}`} className="btn btn-ghost btn-small">
                    {t.order.open}
                  </Link>
                  <Link href={`/order/${o.id}`} className="btn btn-ghost btn-small">
                    {t.order.certificate}
                  </Link>
                  <form action={resend}>
                    <input type="hidden" name="order" value={o.id} />
                    <button className="btn btn-ghost btn-small">{t.account.resend}</button>
                  </form>
                </div>
              )}
              {beforeEvent && (
                <>
                  <form action={changeContact} className="inline-form" style={{ marginTop: 14 }}>
                    <input type="hidden" name="order" value={o.id} />
                    <label className="small" htmlFor={`c-${o.id}`}>
                      {t.account.editContact}
                    </label>
                    <input id={`c-${o.id}`} name="contact" className="input" defaultValue={o.recipient_contact} required />
                    <button className="btn btn-ghost btn-small">{t.account.save}</button>
                  </form>
                  <details style={{ marginTop: 12 }}>
                    <summary className="faint small" style={{ cursor: "pointer" }}>
                      {t.account.refund}
                    </summary>
                    <p className="muted small">{t.account.refundNote}</p>
                    <form action={requestRefund}>
                      <input type="hidden" name="order" value={o.id} />
                      <button className="btn btn-danger btn-small">{t.account.refund}</button>
                    </form>
                  </details>
                </>
              )}
            </div>
          );
        })}
      </div>

      <h2 style={{ marginTop: 40 }}>{t.account.bids}</h2>
      {bids.length === 0 ? (
        <p className="muted">{t.account.noBids}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {bids.map(async (b) => {
                const m = (await getMoment(b.moment_id))!;
                return (
                  <tr key={b.id}>
                    <td>
                      <Link className="link" href={`/auction/${b.auction_id}`}>
                        {momentTitle(m, lang)}
                      </Link>
                    </td>
                    <td className="num">{usd(b.amount_cents)}</td>
                    <td className="muted">{b.status === "won" ? t.auction.won.split(".")[0] : b.auction_status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={{ marginTop: 40 }} id="card">
        {t.account.card}
      </h2>
      {user.card_on_file ? (
        <p className="notice">{t.account.cardOn}</p>
      ) : (
        <form action={attachCard}>
          <button className="btn btn-primary">{t.account.cardAdd}</button>
          <p className="hint" style={{ marginTop: 8 }}>
            {t.auction.cardNote}
          </p>
        </form>
      )}
    </div>
  );
}
