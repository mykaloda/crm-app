import { eventTypes } from "@/lib/moments";
import { saveType } from "../../actions";

export default function TypesAdmin() {
  const types = eventTypes();
  return (
    <div className="stack">
      <h1 style={{ fontSize: "2rem" }}>Event types</h1>
      <p className="muted small">
        Titles and notification texts support {"{in}"} (&quot;in Paris&quot; / &quot;в Париже&quot;), {"{city}"} and {"{recipient}"}.
        Kind and recurrence are fixed per type: {types.map((t) => `${t.slug}=${t.kind}/${t.recurrence}`).join(", ")}.
      </p>
      {types.map((t) => (
        <form key={t.id} action={saveType} className="panel" style={{ display: "grid", gap: 10 }}>
          <input type="hidden" name="id" value={t.id} />
          <h3 style={{ margin: 0 }}>
            {t.slug} <span className="faint small">({t.kind}, {t.recurrence})</span>
          </h3>
          <div className="inline-form">
            <input className="input" name="name_en" defaultValue={t.name_en} aria-label="name en" />
            <input className="input" name="name_ru" defaultValue={t.name_ru} aria-label="name ru" />
            <input className="input" name="title_en" defaultValue={t.title_en} aria-label="title en" size={30} />
            <input className="input" name="title_ru" defaultValue={t.title_ru} aria-label="title ru" size={30} />
          </div>
          <div className="inline-form small">
            threshold <input className="input" name="threshold" defaultValue={t.threshold} size={4} />
            min duration, min <input className="input" name="min_duration_min" defaultValue={t.min_duration_min} size={4} />
            end after quiet, min <input className="input" name="end_quiet_min" defaultValue={t.end_quiet_min} size={4} />
            season start MM-DD <input className="input" name="season_start" defaultValue={t.season_start ?? ""} size={6} />
            window <input className="input" name="window_start" defaultValue={t.window_start ?? ""} size={11} placeholder="12-31 18:00" />–
            <input className="input" name="window_end" defaultValue={t.window_end ?? ""} size={11} placeholder="01-01 06:00" />
          </div>
          <textarea className="input" name="rule_en" defaultValue={t.rule_en} aria-label="rule en" />
          <textarea className="input" name="rule_ru" defaultValue={t.rule_ru} aria-label="rule ru" />
          <input className="input" name="start_text_en" defaultValue={t.start_text_en} aria-label="start text en" />
          <input className="input" name="start_text_ru" defaultValue={t.start_text_ru} aria-label="start text ru" />
          <div>
            <button className="btn btn-ghost btn-small">Save</button>
          </div>
        </form>
      ))}
    </div>
  );
}
