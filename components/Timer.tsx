"use client";

import { useEffect, useState } from "react";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Counts up from `since` (live page) or down to `until` (auction). */
export function Timer({ since, until, className }: { since?: number; until?: number; className?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ref = now ?? since ?? until ?? 0;
  const ms = Math.max(0, since !== undefined ? ref - since : (until ?? 0) - ref);
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const text = `${d ? `${d}d ` : ""}${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return (
    <span className={className} suppressHydrationWarning>
      {now === null ? "--:--:--" : text}
    </span>
  );
}
