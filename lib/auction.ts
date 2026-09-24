import { all, one, run, tx } from "./db";
import { getMoment, momentTitle, type MomentView } from "./moments";
import { link, queue, tpl } from "./notify";
import { usd } from "./currency";
import { DAY, HOUR, MIN } from "./time";
import type { User } from "./auth";

export interface Auction {
  id: number;
  moment_id: number;
  start_cents: number;
  step_cents: number;
  starts_at: number;
  ends_at: number;
  status: "active" | "awaiting_payment" | "sold" | "unsold" | "cancelled";
  winner_bid_id: number | null;
  pay_deadline: number | null;
  created_at: number;
}

export interface Bid {
  id: number;
  auction_id: number;
  user_id: number;
  amount_cents: number;
  status: "active" | "won" | "forfeited";
  created_at: number;
  email?: string;
}

export const EXTEND_WINDOW = 5 * MIN;
export const PAY_WINDOW = 24 * HOUR;

export function getAuction(id: number): (Auction & { moment: MomentView }) | undefined {
  const a = one<Auction>("SELECT * FROM auctions WHERE id = ?", id);
  if (!a) return undefined;
  return { ...a, moment: getMoment(a.moment_id)! };
}

export function auctionForMoment(momentId: number) {
  return one<Auction>("SELECT * FROM auctions WHERE moment_id = ? ORDER BY id DESC LIMIT 1", momentId);
}

export function bidsFor(auctionId: number) {
  return all<Bid>(
    `SELECT b.*, u.email FROM bids b JOIN users u ON u.id = b.user_id
     WHERE b.auction_id = ? ORDER BY b.amount_cents DESC, b.id ASC`,
    auctionId,
  );
}

export function topBid(auctionId: number) {
  return one<Bid>(
    "SELECT * FROM bids WHERE auction_id = ? AND status != 'forfeited' ORDER BY amount_cents DESC, id ASC LIMIT 1",
    auctionId,
  );
}

export function minNextBid(a: Auction) {
  const top = topBid(a.id);
  return top ? top.amount_cents + a.step_cents : a.start_cents;
}

/** Masks bidder emails for the public history: "an***@gmail.com". */
export function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}***@${domain}`;
}

export type BidError = "closed" | "low" | "self" | "card";

export function placeBid(auctionId: number, user: User, amountCents: number): { error?: BidError; min?: number } {
  return tx(() => {
    const a = one<Auction>("SELECT * FROM auctions WHERE id = ?", auctionId);
    const now = Date.now();
    if (!a || a.status !== "active" || now >= a.ends_at || now < a.starts_at) return { error: "closed" as const };
    if (!user.card_on_file) return { error: "card" as const };
    const top = topBid(a.id);
    if (top && top.user_id === user.id) return { error: "self" as const };
    const min = minNextBid(a);
    if (amountCents < min) return { error: "low" as const, min };
    run(
      "INSERT INTO bids(auction_id, user_id, amount_cents, created_at) VALUES (?, ?, ?, ?)",
      a.id, user.id, amountCents, now,
    );
    // Anti-sniping: a bid in the last 5 minutes extends the auction by 5 minutes.
    if (a.ends_at - now < EXTEND_WINDOW) run("UPDATE auctions SET ends_at = ends_at + ? WHERE id = ?", EXTEND_WINDOW, a.id);
    if (top) {
      const prev = one<{ email: string }>("SELECT email FROM users WHERE id = ?", top.user_id)!;
      const m = getMoment(a.moment_id)!;
      queue({
        channel: "email",
        to: prev.email,
        subject: tpl("en", "outbidSubject", {}),
        body: tpl("en", "outbid", { amount: usd(amountCents), title: momentTitle(m, "en"), link: link(`/auction/${a.id}`) }),
        kind: "outbid",
      });
    }
    return {};
  });
}

function offerToWinner(a: Auction, bid: Bid, now: number) {
  run("UPDATE bids SET status = 'won' WHERE id = ?", bid.id);
  run(
    "UPDATE auctions SET status = 'awaiting_payment', winner_bid_id = ?, pay_deadline = ? WHERE id = ?",
    bid.id, now + PAY_WINDOW, a.id,
  );
  const user = one<{ email: string }>("SELECT email FROM users WHERE id = ?", bid.user_id)!;
  const m = getMoment(a.moment_id)!;
  queue({
    channel: "email",
    to: user.email,
    subject: tpl("en", "wonSubject", {}),
    body: tpl("en", "won", { title: momentTitle(m, "en"), amount: usd(bid.amount_cents), link: link(`/checkout?auction=${a.id}`) }),
    kind: "auction_won",
  });
}

function relaunch(a: Auction, now: number) {
  run("UPDATE auctions SET status = 'unsold' WHERE id = ?", a.id);
  const m = getMoment(a.moment_id);
  if (!m || m.status !== "on_sale") return;
  if (m.earliest_start && m.earliest_start <= now + DAY) return; // too close to the event
  const days = one<{ d: number }>("SELECT auction_days AS d FROM offerings WHERE id = ?", m.offering_id ?? 0)?.d ?? 7;
  let ends = now + days * DAY;
  if (m.earliest_start) ends = Math.min(ends, m.earliest_start - HOUR);
  run(
    `INSERT INTO auctions(moment_id, start_cents, step_cents, starts_at, ends_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    a.moment_id, a.start_cents, a.step_cents, now, ends, now,
  );
}

/** Closes finished auctions, enforces the 24-hour payment window. */
export function processAuctions(now = Date.now()) {
  const ended = all<Auction>("SELECT * FROM auctions WHERE status = 'active' AND ends_at <= ?", now);
  for (const a of ended) {
    tx(() => {
      const top = topBid(a.id);
      if (top) offerToWinner(a, top, now);
      else relaunch(a, now);
    });
  }

  const overdue = all<Auction>(
    "SELECT * FROM auctions WHERE status = 'awaiting_payment' AND pay_deadline <= ?",
    now,
  );
  for (const a of overdue) {
    tx(() => {
      const won = one<Bid>("SELECT * FROM bids WHERE id = ?", a.winner_bid_id ?? 0);
      if (won) run("UPDATE bids SET status = 'forfeited' WHERE auction_id = ? AND user_id = ?", a.id, won.user_id);
      const next = topBid(a.id);
      if (next) offerToWinner(a, next, now);
      else relaunch(a, now);
    });
  }

  // Reminder four hours before the payment deadline.
  const remind = all<Auction & { email: string; reminded: number }>(
    `SELECT a.*, u.email FROM auctions a JOIN bids b ON b.id = a.winner_bid_id JOIN users u ON u.id = b.user_id
     WHERE a.status = 'awaiting_payment' AND a.pay_deadline - ? < ? AND NOT EXISTS (
       SELECT 1 FROM notifications n WHERE n.kind = 'auction_reminder' AND n.recipient = u.email
       AND n.created_at > a.pay_deadline - ?)`,
    now, 4 * HOUR, PAY_WINDOW,
  );
  for (const a of remind) {
    const m = getMoment(a.moment_id)!;
    queue({
      channel: "email",
      to: a.email,
      subject: tpl("en", "reminderSubject", {}),
      body: tpl("en", "reminder", { title: momentTitle(m, "en"), link: link(`/checkout?auction=${a.id}`) }),
      kind: "auction_reminder",
    });
  }
}

export function forceCloseAuction(id: number) {
  run("UPDATE auctions SET ends_at = ? WHERE id = ? AND status = 'active'", Date.now() - 1, id);
  processAuctions();
}

export function cancelAuctionsForMoment(momentId: number) {
  run("UPDATE auctions SET status = 'cancelled' WHERE moment_id = ? AND status IN ('active', 'awaiting_payment')", momentId);
}

export function bidsForUser(userId: number) {
  return all<Bid & { auction_status: string; moment_id: number; ends_at: number }>(
    `SELECT b.*, a.status AS auction_status, a.moment_id, a.ends_at FROM bids b JOIN auctions a ON a.id = b.auction_id
     WHERE b.user_id = ? ORDER BY b.created_at DESC`,
    userId,
  );
}
