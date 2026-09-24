import type { Dict, Lang } from "@/lib/i18n";
import { fmt } from "@/lib/i18n";
import { skyOf, type ForecastDay, type Reading } from "@/lib/weather";

export function WeatherIcon({ code, size = 40 }: { code: number | null; size?: number }) {
  const sky = skyOf(code);
  const common = { width: size, height: size, viewBox: "0 0 48 48", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, "aria-hidden": true };
  const cloud = <path d="M14 30a7 7 0 0 1 1-13.9A10 10 0 0 1 34 18a6 6 0 0 1 0 12H14z" />;
  if (sky === "clear")
    return (
      <svg {...common} style={{ color: "var(--gold)" }}>
        <circle cx="24" cy="24" r="8" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
          <path key={a} d="M24 8v4" transform={`rotate(${a} 24 24)`} />
        ))}
      </svg>
    );
  return (
    <svg {...common} style={{ color: sky === "thunder" ? "var(--gold)" : "var(--sky)" }}>
      {cloud}
      {sky === "rain" && <path d="M18 35l-2 5M25 35l-2 5M32 35l-2 5" />}
      {sky === "snow" && <path d="M18 37h.01M25 39h.01M32 37h.01" strokeWidth={4} />}
      {sky === "thunder" && <path d="M25 32l-4 7h6l-4 7" />}
    </svg>
  );
}

export function WeatherNow({ r, t }: { r: Reading | null; t: Dict }) {
  if (!r) return <p className="muted">{t.weather.unavailable}</p>;
  const sky = skyOf(r.weatherCode);
  return (
    <div className="weather-now">
      <WeatherIcon code={r.weatherCode} size={52} />
      <div className="temp">{r.temperature !== null ? `${Math.round(r.temperature)}°` : "—"}</div>
      <div>
        <div>{t.weather[sky]}</div>
        <div className="muted small">{fmt(t.weather.precip, { v: r.precipitation })}</div>
      </div>
    </div>
  );
}

export function Forecast({ days, lang, t }: { days: ForecastDay[] | null; lang: Lang; t: Dict }) {
  if (!days?.length) return null;
  const fmtDay = new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", { weekday: "short", timeZone: "UTC" });
  return (
    <div>
      <div className="label" style={{ marginTop: 18 }}>{t.weather.forecast}</div>
      <div className="forecast">
        {days.slice(0, 7).map((d) => (
          <div key={d.date}>
            <span className="faint">{fmtDay.format(new Date(d.date + "T12:00:00Z"))}</span>
            <span style={{ display: "flex", justifyContent: "center", margin: "4px 0" }}>
              <WeatherIcon code={d.code} size={24} />
            </span>
            <strong>{Math.round(d.tMax)}°</strong>
            <span className="faint">{Math.round(d.tMin)}°</span>
            {d.precip > 0 && <span className="wet" style={{ display: "block" }}>{Math.round(d.precip * 10) / 10}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
