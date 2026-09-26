import type { MetadataRoute } from "next";
import { all } from "@/lib/db";
import { listCities } from "@/lib/moments";
import { siteUrl } from "@/lib/request";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const pages = ["", "/moments", "/how-it-works", "/faq", "/terms", "/privacy"].map((p) => ({ url: `${base}${p}` }));
  const cities = (await listCities()).map((c) => ({ url: `${base}/city/${c.slug}` }));
  const series = (await all<{ slug: string }>("SELECT slug FROM offerings WHERE active = 1")).map((o) => ({ url: `${base}/moments/${o.slug}` }));
  return [...pages, ...cities, ...series];
}
