/**
 * Built-in scheduler for long-lived servers (Railway, Docker, `next start`).
 * Runs the monitor every minute; each city is still polled at most every
 * 5 minutes. Disable with INTERNAL_SCHEDULER=0 when an external cron calls
 * /api/cron/tick instead (e.g. on serverless hosting).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.INTERNAL_SCHEDULER === "0") return;
  // Serverless functions don't live between requests: use a cron calling /api/cron/tick.
  if (process.env.VERCEL) return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { tick } = await import("./lib/monitor");
  const run = () =>
    tick().catch((e) => {
      console.error("[monitor] tick failed", e);
    });
  setTimeout(run, 5_000);
  setInterval(run, 60_000);
}
