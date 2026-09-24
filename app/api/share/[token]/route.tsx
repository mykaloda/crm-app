import { getOrderByToken } from "@/lib/orders";
import { getMoment, momentTitle } from "@/lib/moments";
import { momentImage } from "@/lib/og";
import { dictionaries } from "@/lib/i18n";
import { formatDateTime, formatDuration, formatTime } from "@/lib/time";

/** 1080x1350 picture for social media (archive), or a teaser before the event. */
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const order = getOrderByToken(token);
  if (!order || order.status !== "paid" || order.deleted_by_recipient) return new Response("Not found", { status: 404 });
  const m = getMoment(order.moment_id)!;
  const lang = order.lang;
  const t = dictionaries[lang];
  const lines: string[] = [];
  if (m.status === "completed" && m.started_at && m.ended_at) {
    lines.push(formatDateTime(m.started_at, m.city.tz, lang, false));
    lines.push(
      `${formatTime(m.started_at, m.city.tz, lang)} – ${formatTime(m.ended_at, m.city.tz, lang)} · ${formatDuration(m.ended_at - m.started_at, lang)}`,
    );
  } else {
    lines.push(t.status[m.status === "live" ? "live" : "sold"]);
  }
  const img = await momentImage({
    kind: m.type.kind,
    kicker: t.tagline,
    title: momentTitle(m, lang),
    name: order.recipient_name,
    lines,
    footer: "Moment",
    width: 1080,
    height: 1350,
  });
  img.headers.set("Cache-Control", m.status === "completed" ? "public, max-age=31536000, immutable" : "public, max-age=300");
  return img;
}
