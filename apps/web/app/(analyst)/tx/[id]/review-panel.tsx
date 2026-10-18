"use client";

import { useActionState } from "react";
import { reviewDecision, type ReviewState } from "./actions";

export function ReviewPanel({ decisionId }: { decisionId: number }) {
  const [state, action, pending] = useActionState<ReviewState, FormData>(reviewDecision, {});

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="decisionId" value={decisionId} />
      <label className="block">
        <span className="text-sm opacity-80">Note for the audit log (optional)</span>
        <textarea
          name="note"
          maxLength={500}
          rows={2}
          placeholder="e.g. Called customer, confirmed they know the payee"
          className="mt-1 w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-sm placeholder:text-cream/40 focus:border-cream/60 focus:outline-none"
        />
      </label>
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          name="verdict"
          value="release"
          disabled={pending}
          className="rounded-full border border-cream px-6 py-2.5 font-semibold transition hover:bg-white/10 disabled:opacity-50"
        >
          Release
        </button>
        <button
          type="submit"
          name="verdict"
          value="keep_hold"
          disabled={pending}
          className="rounded-full bg-clay px-6 py-2.5 font-semibold text-forest transition hover:brightness-105 disabled:opacity-50"
        >
          Keep hold
        </button>
      </div>
      {state.error && (
        <p role="alert" className="rounded-lg bg-clay/20 px-3 py-2 text-sm">
          {state.error}
        </p>
      )}
      {state.done && <p className="text-sm">{state.done}</p>}
    </form>
  );
}
