"use client";

import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";

export function LoginForm() {
  const params = useSearchParams();
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  const profileMissing = params.get("error") === "no-profile";

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={params.get("next") ?? "/queue"} />
      <label className="block">
        <span className="text-sm font-medium">Work email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="mt-1 w-full rounded-xl border border-forest/30 bg-paper px-4 py-2.5 outline-none focus:border-forest"
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded-xl border border-forest/30 bg-paper px-4 py-2.5 outline-none focus:border-forest"
        />
      </label>
      {(state.error || profileMissing) && (
        <p role="alert" className="rounded-lg bg-clay-soft px-3 py-2 text-sm text-forest">
          {state.error ?? "Your account has no staff profile yet. Ask an admin to add you."}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-forest py-3 font-semibold text-cream transition hover:bg-forest-2 disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
