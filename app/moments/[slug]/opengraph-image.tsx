import { currentMomentOfSeries, momentTitle } from "@/lib/moments";
import { momentImage } from "@/lib/og";
import { usd } from "@/lib/currency";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Moment";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await currentMomentOfSeries(slug);
  if (!m) return new Response("Not found", { status: 404 });
  return momentImage({
    kind: m.type.kind,
    kicker: "The moment exchange",
    title: momentTitle(m, "en"),
    lines: [`${m.sale_type === "auction" ? "from " : ""}${usd(m.price_cents)} · one owner only`],
    footer: "Moment",
    ...size,
  });
}
