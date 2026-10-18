import Link from "next/link";
import { Suspense } from "react";
import { ShieldLogo } from "@/components/shield-logo";
import { getStaff } from "@/lib/auth";
import { signOut } from "../login/actions";
import { NavLinks, NavLinksFallback } from "./nav-links";

export default function AnalystLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="bg-forest text-cream">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/queue" className="flex items-center gap-2 font-bold">
            <ShieldLogo className="size-7" />
            Scam Shield
          </Link>
          <Suspense fallback={<NavLinksFallback />}>
            <NavLinks />
          </Suspense>
          <div className="ml-auto flex items-center gap-4 text-sm">
            <Link href="/pay" target="_blank" className="opacity-80 hover:opacity-100">
              Customer demo ↗
            </Link>
            <Suspense fallback={<span className="opacity-60">…</span>}>
              <UserBadge />
            </Suspense>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}

async function UserBadge() {
  const staff = await getStaff();
  return (
    <form action={signOut} className="flex items-center gap-3">
      <span>
        {staff.name} <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs capitalize">{staff.role}</span>
      </span>
      <button type="submit" className="underline-offset-4 opacity-80 hover:underline hover:opacity-100">
        Sign out
      </button>
    </form>
  );
}
