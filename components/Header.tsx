import Link from "next/link";
import type { Dict, Lang } from "@/lib/i18n";
import { Prefs } from "./Prefs";

export function Header({ lang, t, currency }: { lang: Lang; t: Dict; currency: string }) {
  const links = [
    ["/moments", t.nav.catalog],
    ["/how-it-works", t.nav.how],
    ["/faq", t.nav.faq],
    ["/account", t.nav.account],
  ] as const;
  return (
    <header className="header">
      <div className="container header-inner">
        <Link href="/" className="logo" aria-label={t.brand}>
          <span className="logo-mark" aria-hidden />
          {t.brand}
        </Link>
        <nav className="nav" aria-label="Main">
          {links.map(([href, label]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="header-tools">
          <Prefs lang={lang} currency={currency} />
          <details className="mobile-menu menu-btn">
            <summary className="btn btn-ghost btn-small" aria-label="Menu">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </summary>
            <nav className="mobile-nav" aria-label="Mobile">
              {links.map(([href, label]) => (
                <Link key={href} href={href}>
                  {label}
                </Link>
              ))}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
