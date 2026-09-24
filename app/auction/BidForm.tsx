"use client";

import { useActionState } from "react";
import { bid, type BidState } from "./actions";
import { fmt, type Dict } from "@/lib/i18n";

export function BidForm({ auctionId, minCents, t }: { auctionId: number; minCents: number; t: Dict }) {
  const [state, action, pending] = useActionState<BidState, FormData>(bid, {});
  const errors: Record<string, string> = {
    ...t.auction.errors,
    low: fmt(t.auction.errors.low, { min: `$${((state.min ?? minCents) / 100).toLocaleString("en-US")}` }),
    login: t.auction.login,
  };
  return (
    <form action={action} className="stack">
      <input type="hidden" name="auction" value={auctionId} />
      <div className="field">
        <label htmlFor="amount">{t.auction.yourBid}</label>
        <input
          id="amount"
          name="amount"
          type="number"
          inputMode="decimal"
          min={minCents / 100}
          step="1"
          defaultValue={minCents / 100}
          className="input"
          required
        />
      </div>
      {state.error && <p className="notice notice-red">{errors[state.error]}</p>}
      <button className="btn btn-primary btn-block" disabled={pending}>
        {pending ? "…" : t.auction.place}
      </button>
    </form>
  );
}
