import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { AdminNav } from "@/components/AdminNav";
import { simulated } from "@/lib/weather";
import { stripe } from "@/lib/stripe";
import { temporaryDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin", robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const modes = [
    temporaryDatabase() ? "database: TEMPORARY (connect Neon Postgres in Vercel → Storage)" : null,
    simulated() ? "weather: simulated" : null,
    stripe() ? null : "payments: test mode",
    process.env.RESEND_API_KEY ? null : "email: log only",
  ].filter(Boolean);
  return (
    <div className="container" style={{ paddingTop: 16, paddingBottom: 48 }}>
      <AdminNav />
      {modes.length > 0 && <p className="notice small">{modes.join(" · ")}</p>}
      {children}
    </div>
  );
}
