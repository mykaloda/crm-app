import { tick } from "@/lib/monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Monitoring entry point for an external scheduler (Vercel Cron, Railway
 * cron, GitHub Actions…). Call every 5 minutes with
 * `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const key = new URL(req.url).searchParams.get("key");
  if (secret ? auth !== `Bearer ${secret}` && key !== secret : process.env.NODE_ENV === "production") {
    return new Response("Unauthorized", { status: 401 });
  }
  const report = await tick();
  return Response.json(report);
}
