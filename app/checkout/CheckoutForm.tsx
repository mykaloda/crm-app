"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { checkout, type CheckoutState } from "./actions";
import type { Dict } from "@/lib/i18n";

const LIMIT = 200;

export function CheckoutForm(props: {
  t: Dict;
  moment?: string;
  auction?: number;
  priceLabel: string;
  defaultEmail?: string;
}) {
  const { t } = props;
  const [state, action, pending] = useActionState<CheckoutState, FormData>(checkout, {});
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"now" | "later">("now");
  const [sendAt, setSendAt] = useState("");
  const [started, setStarted] = useState(0);
  useEffect(() => setStarted(Date.now()), []);

  const errors = t.checkout.errors as Record<string, string>;
  const [before, after] = t.checkout.consent.split("{terms}");

  return (
    <form action={action} className="panel" noValidate>
      <input type="hidden" name="moment" value={props.moment ?? ""} />
      <input type="hidden" name="auction" value={props.auction ?? ""} />
      <input type="hidden" name="started" value={started} />
      <input type="hidden" name="sendAtIso" value={sendAt ? new Date(sendAt).toISOString() : ""} />
      <div className="hp" aria-hidden>
        <label>
          Website <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="field">
        <label htmlFor="recipientName">{t.checkout.recipientName}</label>
        <input id="recipientName" name="recipientName" className="input" required maxLength={80} autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="recipientContact">{t.checkout.contact}</label>
        <input id="recipientContact" name="recipientContact" className="input" required maxLength={120} autoComplete="off" inputMode="email" />
        <span className="hint">{t.checkout.contactHint}</span>
      </div>
      <div className="field">
        <label htmlFor="message">{t.checkout.message}</label>
        <textarea
          id="message"
          name="message"
          className="input"
          maxLength={LIMIT}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <span className="hint row between">
          <span>{t.checkout.messageHint}</span>
          <span className="num">
            {message.length}/{LIMIT}
          </span>
        </span>
        <label className="check">
          <input type="checkbox" name="hideMessage" /> {t.checkout.hideMessage}
        </label>
      </div>
      <div className="field">
        <label htmlFor="giverName">{t.checkout.giverName}</label>
        <input id="giverName" name="giverName" className="input" maxLength={80} autoComplete="name" />
      </div>
      <div className="field">
        <label htmlFor="buyerEmail">{t.checkout.buyerEmail}</label>
        <input
          id="buyerEmail"
          name="buyerEmail"
          type="email"
          className="input"
          required
          autoComplete="email"
          defaultValue={props.defaultEmail}
        />
        <span className="hint">{t.checkout.buyerEmailHint}</span>
      </div>
      <div className="field">
        <span className="label">{t.checkout.send}</span>
        <div className="segmented">
          <label>
            <input type="radio" name="sendMode" value="now" checked={mode === "now"} onChange={() => setMode("now")} />
            {t.checkout.sendNow}
          </label>
          <label>
            <input type="radio" name="sendMode" value="later" checked={mode === "later"} onChange={() => setMode("later")} />
            {t.checkout.sendLater}
          </label>
        </div>
        {mode === "later" && (
          <input
            type="datetime-local"
            className="input"
            aria-label={t.checkout.sendLater}
            value={sendAt}
            onChange={(e) => setSendAt(e.target.value)}
            required
          />
        )}
      </div>
      <div className="field">
        <label className="check">
          <input type="checkbox" name="consent" required />
          <span>
            {before}
            <Link href="/terms" className="link" target="_blank">
              {t.checkout.termsLink}
            </Link>
            {after}
          </span>
        </label>
      </div>

      {state.error && (
        <p className="notice notice-red" role="alert" style={{ marginTop: 16 }}>
          {errors[state.error] ?? errors.generic}
        </p>
      )}

      <button className="btn btn-primary btn-block" style={{ marginTop: 20 }} disabled={pending}>
        {pending ? "…" : props.priceLabel}
      </button>
      <p className="hint center" style={{ marginTop: 10 }}>
        {t.checkout.payNote}
        <br />
        {t.checkout.taxes}
      </p>
    </form>
  );
}
