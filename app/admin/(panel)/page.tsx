import { all, one } from "@/lib/db";
import { usd } from "@/lib/currency";
import { DAY } from "@/lib/time";
import { listCities } from "@/lib/moments";
import { runTick } from "../actions";

async function sales(since: number) {
  return (await one<{ n: number; s: number | null }>(
    "SELECT COUNT(*)::int AS n, SUM(amount_cents)::float8 AS s FROM orders WHERE status = 'paid' AND paid_at >= ?",
    since,
  ))!;
}

export default async function Dashboard() {
  const now = Date.now();
  const periods = [
    ["Today", await sales(now - DAY)],
    ["7 days", await sales(now - 7 * DAY)],
    ["30 days", await sales(now - 30 * DAY)],
    ["All time", await sales(0)],
  ] as const;
  const created = (await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM orders WHERE created_at >= ?", now - 30 * DAY))!.n;
  const paid = (await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM orders WHERE status IN ('paid', 'refunded') AND created_at >= ?", now - 30 * DAY))!.n;
  const statuses = await all<{ status: string; n: number }>("SELECT status, COUNT(*)::int AS n FROM moments GROUP BY status");
  const totalSold = statuses.filter((s) => ["sold", "live", "completed"].includes(s.status)).reduce((a, s) => a + s.n, 0);
  const waiting = statuses.find((s) => s.status === "sold")?.n ?? 0;
  const byCity = await all<{ name: string; n: number; avg: number | null }>(
    `SELECT c.name_en AS name, COUNT(*)::int AS n, AVG(m.started_at - o.paid_at)::float8 AS avg
     FROM moments m JOIN cities c ON c.id = m.city_id JOIN orders o ON o.moment_id = m.id AND o.status = 'paid'
     WHERE m.started_at IS NOT NULL GROUP BY c.id ORDER BY c.name_en`,
  );
  const failing = (await listCities(true)).filter((c) => c.fail_count >= 3);

  return (
    <div className="stack">
      <div className="row between">
        <h1 style={{ fontSize: "2rem", margin: 0 }}>Dashboard</h1>
        <form action={runTick}>
          <button className="btn btn-ghost btn-small">Run monitor now</button>
        </form>
      </div>
      {failing.length > 0 && (
        <p className="notice notice-red">Weather polling failing: {failing.map((c) => `${c.name_en} (${c.fail_count})`).join(", ")}</p>
      )}
      <div className="kpis">
        {periods.map(([label, s]) => (
          <div className="kpi" key={label}>
            <div className="label">{label}</div>
            <div className="value">{usd(s.s ?? 0)}</div>
            <div className="faint small">{s.n} orders</div>
          </div>
        ))}
      </div>
      <div className="kpis">
        <div className="kpi">
          <div className="label">Checkout → paid (30 d)</div>
          <div className="value">{created ? Math.round((paid / created) * 100) : 0}%</div>
          <div className="faint small">
            {paid} of {created} started checkouts
          </div>
        </div>
        <div className="kpi">
          <div className="label">Sold moments waiting</div>
          <div className="value">{totalSold ? Math.round((waiting / totalSold) * 100) : 0}%</div>
          <div className="faint small">
            {waiting} of {totalSold}
          </div>
        </div>
        {statuses.map((s) => (
          <div className="kpi" key={s.status}>
            <div className="label">Moments: {s.status}</div>
            <div className="value">{s.n}</div>
          </div>
        ))}
      </div>
      <div className="panel">
        <h3>Average time from purchase to event, by city</h3>
        {byCity.length === 0 ? (
          <p className="muted">No completed events yet.</p>
        ) : (
          <table className="table">
            <tbody>
              {byCity.map((c) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td className="num">{c.n} events</td>
                  <td className="num">{c.avg ? `${(c.avg / DAY).toFixed(1)} days` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="faint small">Catalog → checkout → payment funnel by page views is tracked in GA4 / Meta Pixel when configured.</p>
    </div>
  );
}
