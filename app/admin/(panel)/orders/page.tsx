import Link from "next/link";
import { all } from "@/lib/db";
import { getMoment, momentTitle } from "@/lib/moments";
import type { Order } from "@/lib/orders";
import { usd } from "@/lib/currency";
import { dt } from "@/lib/admin-format";
import { adminContact, adminRefund, adminResend } from "../../actions";

export default async function OrdersAdmin({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { q, status } = await searchParams;
  const where: string[] = [];
  const params: string[] = [];
  if (q) {
    where.push("(id LIKE ? OR buyer_email LIKE ? OR recipient_name LIKE ? OR recipient_contact LIKE ?)");
    params.push(...Array(4).fill(`%${q}%`));
  }
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  const orders = await all<Order>(
    `SELECT * FROM orders ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT 200`,
    ...params,
  );

  return (
    <div className="stack">
      <h1 style={{ fontSize: "2rem" }}>Orders</h1>
      <form className="inline-form" method="get">
        <input className="input" name="q" defaultValue={q} placeholder="Order, email, recipient" />
        <select className="input" name="status" defaultValue={status ?? ""} aria-label="status">
          <option value="">any status</option>
          {["pending", "paid", "refunded", "cancelled"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <button className="btn btn-ghost btn-small">Search</button>
      </form>
      <div className="stack">
        {orders.map(async (o) => {
          const m = (await getMoment(o.moment_id))!;
          return (
            <div key={o.id} className="panel" style={{ padding: 16 }}>
              <div className="row between">
                <div>
                  <strong>{o.id}</strong> · {momentTitle(m, "en")} · <span className="num">{usd(o.amount_cents)}</span>
                  <div className="muted small">
                    {o.status} · moment {m.status} · created {dt(o.created_at)} · paid {dt(o.paid_at)} · buyer {o.buyer_email} ·
                    recipient {o.recipient_name} ({o.recipient_contact || "removed"}) · sent {dt(o.sent_at)}
                    {o.refund_cents ? ` · refunded ${usd(o.refund_cents)}` : ""}
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <Link className="btn btn-ghost btn-small" href={`/m/${o.token}`}>
                    Page
                  </Link>
                  {o.status === "paid" && (
                    <form action={adminResend}>
                      <input type="hidden" name="id" value={o.id} />
                      <button className="btn btn-ghost btn-small">Resend link</button>
                    </form>
                  )}
                </div>
              </div>
              {o.status === "paid" && m.status === "sold" && (
                <div className="row" style={{ marginTop: 10 }}>
                  <form action={adminContact} className="inline-form">
                    <input type="hidden" name="id" value={o.id} />
                    <input className="input" name="contact" defaultValue={o.recipient_contact} aria-label="contact" />
                    <button className="btn btn-ghost btn-small">Update contact</button>
                  </form>
                  <form action={adminRefund} className="inline-form">
                    <input type="hidden" name="id" value={o.id} />
                    fee % <input className="input" name="fee" defaultValue={process.env.REFUND_FEE_PERCENT ?? 5} size={3} />
                    <button className="btn btn-danger btn-small">Refund</button>
                  </form>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
