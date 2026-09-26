import Link from "next/link";
import { all } from "@/lib/db";
import { eventTypes, listCities, momentPath, momentTitle, queryMoments } from "@/lib/moments";
import { usd } from "@/lib/currency";
import { dt } from "@/lib/admin-format";
import { cancelMoment, createOneOff, forceEnd, forceStart, openManualMoment } from "../../actions";

export default async function MomentsAdmin({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const moments = await queryMoments(
    `${status ? "m.status = ?" : "m.status NOT IN ('expired', 'cancelled')"} ORDER BY m.id DESC LIMIT 300`,
    ...(status ? [status] : []),
  );
  const cities = await listCities(true);
  const types = await eventTypes();
  const manualOfferings = await all<{ id: number; slug: string }>(
    "SELECT o.id, o.slug FROM offerings o JOIN event_types t ON t.id = o.event_type_id WHERE t.recurrence = 'manual'",
  );
  const owners = new Map(
    (await all<{ moment_id: number; recipient_name: string; id: string }>("SELECT moment_id, recipient_name, id FROM orders WHERE status = 'paid'")).map(
      (o) => [o.moment_id, o],
    ),
  );
  const now = Date.now();

  return (
    <div className="stack">
      <h1 style={{ fontSize: "2rem" }}>Moments</h1>
      <div className="row small">
        {["", "on_sale", "sold", "live", "completed", "expired", "cancelled"].map((s) => (
          <Link key={s} href={s ? `/admin/moments?status=${s}` : "/admin/moments"} className="link">
            {s || "active"}
          </Link>
        ))}
      </div>
      <div className="table-wrap panel">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Moment</th>
              <th>Status</th>
              <th>Price</th>
              <th>Monitoring</th>
              <th>Owner</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {moments.map((m) => {
              const owner = owners.get(m.id);
              return (
                <tr key={m.id}>
                  <td className="num">{m.id}</td>
                  <td>
                    <Link className="link" href={momentPath(m)}>
                      {momentTitle(m, "en")}
                    </Link>{" "}
                    <span className="faint">№{m.seq}</span>
                  </td>
                  <td>
                    {m.status}
                    {m.locked_until && m.locked_until > now ? " (locked)" : ""}
                    {m.window_end && m.window_end < now && m.status === "sold" ? " ⚠ window passed" : ""}
                  </td>
                  <td className="num">{usd(m.price_cents)} {m.sale_type === "auction" ? "(auction)" : ""}</td>
                  <td className="small">
                    {m.earliest_start ? `from ${dt(m.earliest_start)}` : "continuous"}
                    {m.window_end ? ` to ${dt(m.window_end)}` : ""}
                    {m.hits ? ` · hits ${m.hits}` : ""}
                    {m.started_at ? ` · started ${dt(m.started_at)}` : ""}
                    {m.ended_at ? ` · ended ${dt(m.ended_at)}` : ""}
                  </td>
                  <td className="small">{owner ? `${owner.recipient_name} (${owner.id})` : ""}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      {m.status === "sold" && (
                        <form action={forceStart}>
                          <input type="hidden" name="id" value={m.id} />
                          <button className="btn btn-ghost btn-small">Start now</button>
                        </form>
                      )}
                      {m.status === "live" && (
                        <form action={forceEnd}>
                          <input type="hidden" name="id" value={m.id} />
                          <button className="btn btn-ghost btn-small">End now</button>
                        </form>
                      )}
                      {m.status === "on_sale" && (
                        <form action={cancelMoment}>
                          <input type="hidden" name="id" value={m.id} />
                          <button className="btn btn-danger btn-small">Withdraw</button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h3>Create a one-off moment</h3>
        <p className="muted small">E.g. &quot;Rain in Paris on February 14&quot;. Times are local to the city.</p>
        <form action={createOneOff} className="inline-form">
          <select className="input" name="city_id" aria-label="city">
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name_en}
              </option>
            ))}
          </select>
          <select className="input" name="event_type_id" aria-label="type">
            {types
              .filter((t) => t.kind === "rain" || t.kind === "snow" || t.kind === "thunder")
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name_en}
                </option>
              ))}
          </select>
          <input className="input" name="label_en" placeholder="Rain in Paris on February 14" required size={28} />
          <input className="input" name="label_ru" placeholder="Дождь в Париже 14 февраля" size={28} />
          <input className="input" type="datetime-local" name="start" required aria-label="window start" />
          <input className="input" type="datetime-local" name="end" required aria-label="window end" />
          $<input className="input" name="price" defaultValue={150} size={6} aria-label="price" />
          <select className="input" name="sale_type" aria-label="sale type">
            <option value="fixed">fixed</option>
            <option value="auction">auction</option>
          </select>
          <button className="btn btn-primary btn-small">Create</button>
        </form>
      </div>

      {manualOfferings.length > 0 && (
        <div className="panel">
          <h3>Open the next astronomical moment</h3>
          <p className="muted small">Meteor showers: enter the peak window from the astronomical calendar (local time).</p>
          <form action={openManualMoment} className="inline-form">
            <select className="input" name="offering_id" aria-label="series">
              {manualOfferings.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.slug}
                </option>
              ))}
            </select>
            <input className="input" type="datetime-local" name="start" required aria-label="start" />
            <input className="input" type="datetime-local" name="end" required aria-label="end" />
            <button className="btn btn-primary btn-small">Open</button>
          </form>
        </div>
      )}
    </div>
  );
}
