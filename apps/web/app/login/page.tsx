import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ShieldLogo } from "@/components/shield-logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="grid flex-1 md:grid-cols-2">
      <section className="flex flex-col justify-between bg-forest p-10 text-cream">
        <p className="text-sm">Team Inat</p>
        <div>
          <ShieldLogo className="size-14" />
          <h1 className="mt-6 text-5xl font-bold tracking-tight">Scam Shield</h1>
          <p className="mt-4 max-w-md text-lg opacity-90">
            Real-time decisions that stop payment scams before the money leaves.
          </p>
        </div>
        <p className="text-sm opacity-70">IBM Z Datathon 2026 · Real-Time AI for Critical Decisions</p>
      </section>
      <section className="flex items-center justify-center p-10">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold">Analyst sign in</h2>
          <p className="mt-1 mb-6 text-sm text-muted">For fraud analysts and compliance staff.</p>
          <Suspense>
            <LoginForm />
          </Suspense>
          <p className="mt-8 text-sm text-muted">
            Looking for the customer view?{" "}
            <Link href="/pay" className="font-semibold text-forest underline underline-offset-4">
              Open the payment demo
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
