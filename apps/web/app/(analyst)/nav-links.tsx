"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/queue", label: "Review queue" },
  { href: "/audit", label: "Audit log" },
  { href: "/model", label: "Model & audit" },
] as const;

export function NavLinks() {
  return <Links path={usePathname()} />;
}

/** Same links without the active state, shown while the pathname streams in. */
export function NavLinksFallback() {
  return <Links path="" />;
}

function Links({ path }: { path: string }) {
  return (
    <nav className="flex gap-1 text-sm">
      {LINKS.map((l) => {
        const active = path.startsWith(l.href) || (l.href === "/queue" && path.startsWith("/tx"));
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 transition ${active ? "bg-cream text-forest" : "hover:bg-white/10"}`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
