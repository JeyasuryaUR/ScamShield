"use client";

import { useState, useTransition } from "react";
import { verifyChain, type ChainResult } from "./actions";

export function VerifyChain() {
  const [result, setResult] = useState<ChainResult | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={() => start(async () => setResult(await verifyChain()))}
        disabled={pending}
        className="rounded-full border border-forest px-4 py-2 text-sm font-semibold transition hover:bg-forest hover:text-cream disabled:opacity-50"
      >
        {pending ? "Checking…" : "Verify hash chain"}
      </button>
      {result && "error" in result && <span className="text-sm text-clay">{result.error}</span>}
      {result && "ok" in result && (
        <span
          role="status"
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${result.ok ? "bg-moss-soft text-moss" : "bg-clay text-forest"}`}
        >
          {result.ok
            ? `Intact: ${result.checked.toLocaleString()} entries, none altered`
            : `Broken at entry #${result.firstBadId}: the log was altered`}
        </span>
      )}
    </div>
  );
}
