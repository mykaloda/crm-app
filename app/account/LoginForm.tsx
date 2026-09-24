"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";
import { fmt, type Dict } from "@/lib/i18n";

export function LoginForm({ t, next }: { t: Dict; next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, { step: "email" });
  return (
    <form action={action} className="panel stack" style={{ maxWidth: 440 }}>
      <input type="hidden" name="next" value={next ?? ""} />
      <div className="hp" aria-hidden>
        <input name="website" tabIndex={-1} autoComplete="off" />
      </div>
      {state.step === "email" ? (
        <>
          <p className="muted" style={{ margin: 0 }}>{t.account.signInLead}</p>
          <div className="field">
            <label htmlFor="email">{t.account.email}</label>
            <input id="email" name="email" type="email" className="input" required autoComplete="email" />
          </div>
          {state.error && <p className="notice notice-red">{t.checkout.errors.email}</p>}
          <button className="btn btn-primary btn-block" disabled={pending}>
            {t.account.sendCode}
          </button>
        </>
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>{state.email}</p>
          {state.demoCode && <p className="notice notice-gold">{fmt(t.account.demoCode, { code: state.demoCode })}</p>}
          <div className="field">
            <label htmlFor="code">{t.account.code}</label>
            <input id="code" name="code" className="input" inputMode="numeric" autoComplete="one-time-code" required maxLength={6} />
          </div>
          {state.error && <p className="notice notice-red">{t.account.badCode}</p>}
          <button className="btn btn-primary btn-block" disabled={pending}>
            {t.account.verify}
          </button>
        </>
      )}
    </form>
  );
}
