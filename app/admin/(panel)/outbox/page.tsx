import { all } from "@/lib/db";
import { dt } from "@/lib/admin-format";
import { testEmail } from "../../actions";

export default function Outbox() {
  const rows = all<{ id: number; channel: string; recipient: string; subject: string | null; body: string; kind: string; status: string; error: string | null; created_at: number }>(
    "SELECT * FROM notifications ORDER BY id DESC LIMIT 200",
  );
  return (
    <div className="stack">
      <h1 style={{ fontSize: "2rem" }}>Outbox</h1>
      <p className="muted small">
        Every email, SMS and push. &quot;logged&quot; means the provider is not configured, so the message was only recorded here.
      </p>
      <form action={testEmail} className="inline-form">
        <input className="input" name="to" type="email" placeholder="test@example.com" required />
        <button className="btn btn-ghost btn-small">Send test email</button>
      </form>
      <div className="stack">
        {rows.map((n) => (
          <details key={n.id} className="panel" style={{ padding: 14 }}>
            <summary style={{ cursor: "pointer" }}>
              <span className="faint small">{dt(n.created_at)}</span> · {n.channel} · {n.kind} · {n.recipient} ·{" "}
              <span className={n.status === "failed" ? "error" : "muted"}>{n.status}</span>
              {n.subject ? ` · ${n.subject}` : ""}
            </summary>
            <pre style={{ whiteSpace: "pre-wrap", margin: "10px 0 0", fontFamily: "inherit", color: "var(--muted)" }}>{n.body}</pre>
            {n.error && <p className="error small">{n.error}</p>}
          </details>
        ))}
      </div>
    </div>
  );
}
