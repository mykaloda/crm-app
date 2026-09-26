import type { Dict, Lang } from "@/lib/i18n";
import { formatDateTime, formatDuration, formatTime } from "@/lib/time";

export function ArchiveStats(props: {
  t: Dict;
  lang: Lang;
  tz: string;
  startedAt: number;
  endedAt: number;
  maxIntensity: number | null;
  unit?: string;
}) {
  const { t, lang, tz, startedAt, endedAt } = props;
  return (
    <div className="stats">
      <div className="stat">
        <div className="label">{t.m.started}</div>
        <div className="value">{formatTime(startedAt, tz, lang)}</div>
        <div className="faint small">{formatDateTime(startedAt, tz, lang, false)}</div>
      </div>
      <div className="stat">
        <div className="label">{t.m.ended}</div>
        <div className="value">{formatTime(endedAt, tz, lang)}</div>
        <div className="faint small">{formatDateTime(endedAt, tz, lang, false)}</div>
      </div>
      <div className="stat">
        <div className="label">{t.m.duration}</div>
        <div className="value">{formatDuration(endedAt - startedAt, lang)}</div>
      </div>
      <div className="stat">
        <div className="label">{t.m.maxIntensity}</div>
        <div className="value">
          {props.maxIntensity !== null ? `${props.maxIntensity} ${props.unit ?? (lang === "ru" ? "мм/ч" : "mm/h")}` : "—"}
        </div>
      </div>
    </div>
  );
}
