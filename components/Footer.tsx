import Link from "next/link";
import type { Dict } from "@/lib/i18n";

export function Footer({ t }: { t: Dict }) {
  return (
    <footer className="footer">
      <div className="container">
        <p style={{ maxWidth: 620 }}>{t.footer.note}</p>
        <div className="footer-links">
          <Link href="/moments">{t.nav.catalog}</Link>
          <Link href="/how-it-works">{t.nav.how}</Link>
          <Link href="/faq">{t.nav.faq}</Link>
          <Link href="/terms">{t.footer.terms}</Link>
          <Link href="/privacy">{t.footer.privacy}</Link>
        </div>
        <p style={{ marginTop: 16 }}>© {new Date().getFullYear()} {t.brand}</p>
      </div>
    </footer>
  );
}
