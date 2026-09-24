"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCurrency, setLang } from "@/app/actions/prefs";
import { CURRENCIES } from "@/lib/currency";

export function Prefs({ lang, currency }: { lang: string; currency: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const apply = (fn: () => Promise<void>) =>
    start(async () => {
      await fn();
      router.refresh();
    });
  return (
    <div className="row" style={{ gap: 8, opacity: pending ? 0.6 : 1 }}>
      <select
        className="pill-select"
        aria-label="Currency"
        value={currency}
        onChange={(e) => apply(() => setCurrency(e.target.value))}
      >
        {CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <div className="lang-switch" role="group" aria-label="Language">
        {["en", "ru"].map((l) => (
          <button key={l} type="button" aria-pressed={lang === l} onClick={() => apply(() => setLang(l))}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}
