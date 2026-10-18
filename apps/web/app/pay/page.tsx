import type { Metadata } from "next";
import Link from "next/link";
import { ShieldLogo } from "@/components/shield-logo";
import { PayDemo } from "./pay-demo";

export const metadata: Metadata = { title: "Customer demo" };

export default function PayPage() {
  return (
    <main className="flex-1 bg-forest text-cream">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ShieldLogo className="size-9" />
            <div>
              <h1 className="text-2xl font-bold">Customer view</h1>
              <p className="text-sm opacity-80">Pick a payment. It goes through the live scorer, exactly like the stream.</p>
            </div>
          </div>
          <Link href="/queue" className="rounded-full border border-cream/40 px-4 py-2 text-sm hover:bg-white/10">
            Analyst queue →
          </Link>
        </header>
        <PayDemo />
        <p className="mt-10 text-center text-xs opacity-60">Illustrative proof of concept · sample data only · Team Inat</p>
      </div>
    </main>
  );
}
