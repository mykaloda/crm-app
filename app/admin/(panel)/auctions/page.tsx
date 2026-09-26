import Link from "next/link";
import { all } from "@/lib/db";
import { bidsFor, type Auction } from "@/lib/auction";
import { getMoment, momentTitle, queryMoments } from "@/lib/moments";
import { usd } from "@/lib/currency";
import { dt } from "@/lib/admin-format";
import { closeLot, createLot } from "../../actions";

export default async function AuctionsAdmin() {
  const auctions = await all<Auction>("SELECT * FROM auctions ORDER BY id DESC LIMIT 100");
  const candidates = await queryMoments("m.status = 'on_sale' ORDER BY m.id DESC");
  return (
    <div className="stack">
      <h1 style={{ fontSize: "2rem" }}>Auctions</h1>
      <div className="panel">
        <h3>Create a lot</h3>
        <form action={createLot} className="inline-form">
          <select className="input" name="moment_id" aria-label="moment">
            {candidates.map((m) => (
              <option key={m.id} value={m.id}>
                #{m.id} {momentTitle(m, "en")}
              </option>
            ))}
          </select>
          start $<input className="input" name="start" defaultValue={300} size={6} />
          step $<input className="input" name="step" defaultValue={25} size={4} />
          ends (city time) <input className="input" type="datetime-local" name="ends" required />
          <button className="btn btn-primary btn-small">Create</button>
        </form>
      </div>
      <div className="panel table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Lot</th>
              <th>Status</th>
              <th>Top bid</th>
              <th>Ends</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {auctions.map(async (a) => {
              const m = (await getMoment(a.moment_id))!;
              const bids = await bidsFor(a.id);
              return (
                <tr key={a.id}>
                  <td>{a.id}</td>
                  <td>
                    <Link className="link" href={`/auction/${a.id}`}>
                      {momentTitle(m, "en")}
                    </Link>
                  </td>
                  <td>
                    {a.status}
                    {a.pay_deadline && a.status === "awaiting_payment" ? ` (pay by ${dt(a.pay_deadline)})` : ""}
                  </td>
                  <td className="num">
                    {bids[0] ? `${usd(bids[0].amount_cents)} · ${bids[0].email}` : `start ${usd(a.start_cents)}`} ({bids.length})
                  </td>
                  <td className="small">{dt(a.ends_at)}</td>
                  <td>
                    {a.status === "active" && (
                      <form action={closeLot}>
                        <input type="hidden" name="id" value={a.id} />
                        <button className="btn btn-ghost btn-small">Close now</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
