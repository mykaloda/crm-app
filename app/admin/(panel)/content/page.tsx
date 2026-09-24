import { all } from "@/lib/db";
import { saveFaq, saveReview } from "../../actions";

export default function ContentAdmin() {
  const faq = all<{ id: number; q_en: string; a_en: string; q_ru: string; a_ru: string; sort: number }>("SELECT * FROM faq ORDER BY sort, id");
  const reviews = all<{ id: number; author: string; text_en: string; text_ru: string; visible: number }>(
    "SELECT * FROM reviews ORDER BY created_at DESC",
  );
  return (
    <div className="stack">
      <h1 style={{ fontSize: "2rem" }}>Content</h1>
      <h2 style={{ fontSize: "1.5rem" }}>FAQ</h2>
      {[...faq, { id: 0, q_en: "", a_en: "", q_ru: "", a_ru: "", sort: faq.length }].map((f) => (
        <form key={f.id} action={saveFaq} className="panel" style={{ display: "grid", gap: 8 }}>
          <input type="hidden" name="id" value={f.id} />
          <div className="inline-form">
            <input className="input" name="q_en" defaultValue={f.q_en} placeholder="Question (en)" size={40} required />
            <input className="input" name="q_ru" defaultValue={f.q_ru} placeholder="Вопрос (ru)" size={40} required />
            sort <input className="input" name="sort" defaultValue={f.sort} size={3} />
          </div>
          <textarea className="input" name="a_en" defaultValue={f.a_en} placeholder="Answer (en)" required />
          <textarea className="input" name="a_ru" defaultValue={f.a_ru} placeholder="Ответ (ru)" required />
          <div className="inline-form">
            <button className="btn btn-ghost btn-small">{f.id ? "Save" : "Add question"}</button>
            {f.id > 0 && (
              <label className="check">
                <input type="checkbox" name="delete" /> delete
              </label>
            )}
          </div>
        </form>
      ))}

      <h2 style={{ fontSize: "1.5rem", marginTop: 24 }}>Reviews</h2>
      <p className="muted small">Publish only real customer reviews, with their permission.</p>
      {[...reviews, { id: 0, author: "", text_en: "", text_ru: "", visible: 1 }].map((r) => (
        <form key={r.id} action={saveReview} className="panel" style={{ display: "grid", gap: 8 }}>
          <input type="hidden" name="id" value={r.id} />
          <input className="input" name="author" defaultValue={r.author} placeholder="Author" required />
          <textarea className="input" name="text_en" defaultValue={r.text_en} placeholder="Text (en)" required />
          <textarea className="input" name="text_ru" defaultValue={r.text_ru} placeholder="Текст (ru)" />
          <div className="inline-form">
            {r.id > 0 && (
              <>
                <label className="check">
                  <input type="checkbox" name="visible" defaultChecked={!!r.visible} /> visible
                </label>
                <label className="check">
                  <input type="checkbox" name="delete" /> delete
                </label>
              </>
            )}
            <button className="btn btn-ghost btn-small">{r.id ? "Save" : "Add review"}</button>
          </div>
        </form>
      ))}
    </div>
  );
}
