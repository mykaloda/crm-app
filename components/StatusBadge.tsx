import type { Availability } from "@/lib/moments";
import type { Dict } from "@/lib/i18n";

export function StatusBadge({ status, t }: { status: Availability; t: Dict }) {
  return <span className={`badge badge-${status}`}>{t.status[status]}</span>;
}
