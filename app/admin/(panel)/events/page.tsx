import { all } from "@/lib/db";
import { listCities } from "@/lib/moments";
import { simulated } from "@/lib/weather";
import { dt } from "@/lib/admin-format";
import { resendStart, resolveMeasurement, runTick, simulateWeather } from "../../actions";

interface Row {
  id: number;
  city: string;
  moment_id: number | null;
  source: string;
  taken_at: number;
  temperature: number | null;
  precipitation: number | null;
  snowfall: number | null;
  weather_code: number | null;
  condition_met: number;
  disputed: number;
  resolution: string | null;
  note: string | null;
}

export default async function EventsAdmin({ searchParams }: { searchParams: Promise<{ city?: string }> }) {
  const { city } = await searchParams;
  const cities = await listCities(true);
  const disputed = await all<Row>(
    `SELECT m.*, c.name_en AS city FROM measurements m JOIN cities c ON c.id = m.city_id
     WHERE m.disputed = 1 AND m.resolution IS NULL ORDER BY m.taken_at DESC LIMIT 50`,
  );
  const log = await all<Row>(
    `SELECT m.*, c.name_en AS city FROM measurements m JOIN cities c ON c.id = m.city_id
     ${city ? "WHERE c.slug = ?" : ""} ORDER BY m.taken_at DESC LIMIT 300`,
    ...(city ? [city] : []),
  );
  const live = await all<{ id: number; label: string }>(
    `SELECT m.id, t.name_en || ' · ' || c.name_en AS label FROM moments m JOIN cities c ON c.id = m.city_id
     JOIN event_types t ON t.id = m.event_type_id WHERE m.status IN ('live', 'completed') ORDER BY m.id DESC LIMIT 30`,
  );

  return (
    <div className="stack">
      <div className="row between">
        <h1 style={{ fontSize: "2rem", margin: 0 }}>Events &amp; monitoring</h1>
        <form action={runTick}>
          <button className="btn btn-primary btn-small">Poll all cities now</button>
        </form>
      </div>

      <div className="panel">
        <h3>Polling health</h3>
        <table className="table">
          <tbody>
            {cities.map((c) => (
              <tr key={c.id}>
                <td>{c.name_en}</td>
                <td className="small">last poll {dt(c.last_poll_at)}</td>
                <td className={c.fail_count >= 3 ? "error" : "muted"}>{c.fail_count ? `${c.fail_count} failures in a row` : "ok"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h3>Disputed recordings ({disputed.length})</h3>
        {disputed.length === 0 && <p className="muted">Nothing to review.</p>}
        {disputed.map((d) => (
          <div key={d.id} className="inline-form" style={{ borderBottom: "1px solid var(--line)", padding: "8px 0" }}>
            <span>
              {d.city} · moment {d.moment_id} · {dt(d.taken_at)} · {d.source}: {d.precipitation} mm/h, code {d.weather_code}
            </span>
            {(["confirm", "reject"] as const).map((decision) => (
              <form key={decision} action={resolveMeasurement}>
                <input type="hidden" name="id" value={d.id} />
                <input type="hidden" name="decision" value={decision} />
                <button className={`btn btn-small ${decision === "confirm" ? "btn-primary" : "btn-ghost"}`}>{decision}</button>
              </form>
            ))}
          </div>
        ))}
      </div>

      <div className="panel">
        <h3>Send the &quot;event started&quot; notification again</h3>
        <form action={resendStart} className="inline-form">
          <select className="input" name="id" aria-label="moment">
            {live.map((m) => (
              <option key={m.id} value={m.id}>
                #{m.id} {m.label}
              </option>
            ))}
          </select>
          <button className="btn btn-ghost btn-small">Send</button>
        </form>
      </div>

      {simulated() && (
        <div className="panel">
          <h3>Weather simulator</h3>
          <p className="muted small">Override the simulated weather for a city (e.g. 1.2 mm/h rain; code 73 = snow, 95 = thunderstorm).</p>
          <form action={simulateWeather} className="inline-form">
            <select className="input" name="city_id" aria-label="city">
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name_en}
                </option>
              ))}
            </select>
            mm/h <input className="input" name="precipitation" defaultValue="1.2" size={4} />
            code <input className="input" name="code" defaultValue="63" size={4} />
            for, min <input className="input" name="minutes" defaultValue="30" size={4} />
            <button className="btn btn-ghost btn-small">Apply</button>
          </form>
        </div>
      )}

      <div className="panel">
        <div className="row between">
          <h3 style={{ margin: 0 }}>Measurement log</h3>
          <form className="inline-form" method="get">
            <select className="input" name="city" defaultValue={city ?? ""} aria-label="city">
              <option value="">all cities</option>
              {cities.map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.name_en}
                </option>
              ))}
            </select>
            <button className="btn btn-ghost btn-small">Filter</button>
          </form>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>City</th>
                <th>Moment</th>
                <th>Source</th>
                <th>mm/h</th>
                <th>°C</th>
                <th>Code</th>
                <th>Met</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {log.map((r) => (
                <tr key={r.id}>
                  <td className="num small">{dt(r.taken_at)}</td>
                  <td>{r.city}</td>
                  <td className="num">{r.moment_id ?? ""}</td>
                  <td className="small">{r.source}</td>
                  <td className="num">{r.precipitation ?? ""}</td>
                  <td className="num">{r.temperature ?? ""}</td>
                  <td className="num">{r.weather_code ?? ""}</td>
                  <td>{r.disputed ? "⚠" : r.condition_met ? "✓" : ""}</td>
                  <td className="small muted">{[r.note, r.resolution].filter(Boolean).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
