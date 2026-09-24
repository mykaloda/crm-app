"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/admin", "Dashboard"],
  ["/admin/events", "Events & monitoring"],
  ["/admin/moments", "Moments"],
  ["/admin/orders", "Orders"],
  ["/admin/auctions", "Auctions"],
  ["/admin/cities", "Cities & prices"],
  ["/admin/types", "Event types"],
  ["/admin/content", "Content"],
  ["/admin/outbox", "Outbox"],
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="admin-nav" aria-label="Admin">
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} aria-current={path === href ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
