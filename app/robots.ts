import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/request";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/m/", "/order/", "/checkout", "/account", "/api/"] },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
