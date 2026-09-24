export function dt(ts: number | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
