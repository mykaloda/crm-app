import { notFound, redirect } from "next/navigation";
import { getOrder } from "@/lib/orders";
import { getMoment, momentTitle } from "@/lib/moments";
import { stripe } from "@/lib/stripe";
import { getDict } from "@/lib/request";
import { usd } from "@/lib/currency";
import { cancelTestPayment, completeTestPayment } from "../../actions";

export const dynamic = "force-dynamic";

export default async function TestPayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { lang, t } = await getDict();
  if (stripe()) notFound();
  const order = getOrder(id);
  if (!order) notFound();
  if (order.status === "paid") redirect(`/order/${id}`);
  const m = getMoment(order.moment_id)!;
  return (
    <div className="container section narrow">
      <div className="panel">
        <div className="kicker">{t.demoPay.title}</div>
        <h1 style={{ fontSize: "2.2rem" }}>{momentTitle(m, lang)}</h1>
        <p className="price" style={{ fontSize: "1.6rem" }}>{usd(order.amount_cents)}</p>
        <p className="notice">{t.demoPay.note}</p>
        {order.status === "pending" ? (
          <div className="row" style={{ marginTop: 20 }}>
            <form action={completeTestPayment}>
              <input type="hidden" name="order" value={order.id} />
              <button className="btn btn-primary">{t.demoPay.pay}</button>
            </form>
            <form action={cancelTestPayment}>
              <input type="hidden" name="order" value={order.id} />
              <button className="btn btn-ghost">{t.demoPay.cancel}</button>
            </form>
          </div>
        ) : (
          <p className="notice notice-red">{t.checkout.errors.taken}</p>
        )}
      </div>
    </div>
  );
}
