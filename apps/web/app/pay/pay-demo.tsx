"use client";

import { useState } from "react";
import { ReasonList } from "@/components/reason-list";
import { RiskBar } from "@/components/risk-bar";
import { ShieldLogo } from "@/components/shield-logo";
import { DEMO_BALANCE, SCENARIOS, type Scenario } from "@/lib/demo";
import { formatINR } from "@/lib/format";

type Decision = {
  txn_id: string;
  risk: number;
  action: "allow" | "verify" | "hold";
  reasons: { code: string; weight: number }[];
  model_version: string;
  latency_ms: number;
};
type Copy = { title: string; body: string };
type Warnings = { en: Copy; ta: Copy; source: "template" | "llm" };

type Phase =
  | { step: "choose" }
  | { step: "scoring"; scenario: Scenario }
  | { step: "result"; scenario: Scenario; decision: Decision; warnings: Warnings | null; roundTripMs: number }
  | { step: "done"; scenario: Scenario; decision: Decision; outcome: "verified" | "cancelled"; note?: string }
  | { step: "error"; message: string };

export function PayDemo() {
  const [phase, setPhase] = useState<Phase>({ step: "choose" });

  async function pay(scenario: Scenario) {
    setPhase({ step: "scoring", scenario });
    const t0 = performance.now();
    const res = await fetch("/api/pay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenarioId: scenario.id }),
    }).catch(() => null);
    if (!res?.ok) {
      setPhase({ step: "error", message: "The scoring service is not reachable. Is the scorer running?" });
      return;
    }
    const { decision, warnings } = (await res.json()) as { decision: Decision; warnings: Warnings | null };
    setPhase({ step: "result", scenario, decision, warnings, roundTripMs: performance.now() - t0 });

    // Swap in friendlier LLM wording if it arrives; the template is already on screen.
    if (decision.action !== "allow") {
      fetch("/api/warnings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: decision.action,
          codes: decision.reasons.map((r) => r.code),
          amount: scenario.amount,
        }),
      })
        .then((r) => (r.ok ? (r.json() as Promise<Warnings>) : null))
        .then((llm) => {
          if (llm?.source !== "llm") return;
          setPhase((p) => (p.step === "result" && p.decision.txn_id === decision.txn_id ? { ...p, warnings: llm } : p));
        })
        .catch(() => {});
    }
  }

  async function respond(outcome: "verified" | "cancelled") {
    if (phase.step !== "result") return;
    const { scenario, decision } = phase;
    const res = await fetch("/api/pay/respond", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txnId: decision.txn_id, outcome }),
    }).catch(() => null);
    const note = res?.ok ? undefined : "(Not recorded in the audit log: the scorer's Supabase sink is off.)";
    setPhase({ step: "done", scenario, decision, outcome, note });
  }

  const decision = phase.step === "result" || phase.step === "done" ? phase.decision : null;

  return (
    <div className="grid items-start gap-10 lg:grid-cols-[22rem_1fr]">
      <Phone>
        {phase.step === "choose" && <Choose onPay={pay} />}
        {phase.step === "scoring" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <ShieldLogo className="size-12 animate-pulse" />
            <p className="font-semibold">Checking this payment…</p>
          </div>
        )}
        {phase.step === "result" && <Result phase={phase} onRespond={respond} onBack={() => setPhase({ step: "choose" })} />}
        {phase.step === "done" && (
          <Done
            outcome={phase.outcome}
            scenario={phase.scenario}
            note={phase.note}
            onBack={() => setPhase({ step: "choose" })}
          />
        )}
        {phase.step === "error" && (
          <div className="flex flex-1 flex-col justify-center gap-4">
            <p role="alert">{phase.message}</p>
            <BackButton onClick={() => setPhase({ step: "choose" })} />
          </div>
        )}
      </Phone>

      <section className="rounded-3xl bg-forest-2 p-6" aria-live="polite">
        <h2 className="text-lg font-semibold">What the bank sees</h2>
        {!decision ? (
          <p className="mt-2 opacity-80">
            Priya pays her grocer, her mother and her landlord regularly. Try the usual payments first, then the
            marketplace seller, then the “KYC officer” call.
          </p>
        ) : (
          <div className="mt-4 space-y-6">
            <RiskBar risk={decision.risk} label={decision.action.toUpperCase()} />
            <ReasonList reasons={decision.reasons} detailed />
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="opacity-70">Model scoring time</dt>
                <dd className="text-xl font-semibold">{decision.latency_ms.toFixed(2)} ms</dd>
              </div>
              {phase.step === "result" && (
                <div>
                  <dt className="opacity-70">Round trip from this browser</dt>
                  <dd className="text-xl font-semibold">{Math.round(phase.roundTripMs)} ms</dd>
                </div>
              )}
              <div className="col-span-2">
                <dt className="opacity-70">Model version · transaction</dt>
                <dd className="font-mono text-xs">
                  {decision.model_version} · {decision.txn_id}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </section>
    </div>
  );
}

function Phone({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-152 w-full max-w-88 flex-col rounded-[2.5rem] border-10 border-forest-2 bg-cream p-6 text-forest shadow-2xl">
      {children}
    </div>
  );
}

function Choose({ onPay }: { onPay: (s: Scenario) => void }) {
  return (
    <div className="flex flex-1 flex-col">
      <p className="text-sm text-muted">Hi Priya · balance {formatINR(DEMO_BALANCE)}</p>
      <h3 className="mt-1 mb-5 text-2xl font-bold">Send money</h3>
      <ul className="space-y-3">
        {SCENARIOS.map((s) => (
          <li key={s.id}>
            <button
              onClick={() => onPay(s)}
              className="w-full rounded-2xl border border-forest/30 bg-paper p-4 text-left transition hover:border-forest"
            >
              <span className="flex justify-between gap-2">
                <span className="font-semibold">{s.payeeName}</span>
                <span className="font-bold">{formatINR(s.amount)}</span>
              </span>
              <span className="mt-1 block text-sm text-muted">{s.label}</span>
              <span className="mt-1 block text-xs text-muted">
                {String(s.hour % 12 || 12)}:{String(s.minute).padStart(2, "0")} {s.hour < 12 ? "am" : "pm"} ·{" "}
                {s.note}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Result({
  phase,
  onRespond,
  onBack,
}: {
  phase: Extract<Phase, { step: "result" }>;
  onRespond: (o: "verified" | "cancelled") => void;
  onBack: () => void;
}) {
  const { decision, scenario, warnings } = phase;
  if (decision.action === "allow" || !warnings) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-moss-soft text-3xl text-moss">✓</span>
        <p className="text-xl font-bold">Paid {formatINR(scenario.amount)}</p>
        <p className="text-muted">to {scenario.payeeName}</p>
        <BackButton onClick={onBack} />
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col">
      <ShieldLogo className="size-10" />
      <h3 className="mt-4 text-2xl font-bold leading-tight">{warnings.en.title}</h3>
      <p className="mt-2">{warnings.en.body}</p>
      <p className="mt-4 font-tamil text-lg font-semibold" lang="ta">
        {warnings.ta.title}
      </p>
      <p className="font-tamil text-sm" lang="ta">
        {warnings.ta.body}
      </p>
      <div className="mt-auto space-y-3 pt-6">
        {decision.action === "verify" && (
          <button
            onClick={() => onRespond("verified")}
            className="w-full rounded-full bg-forest py-3 font-semibold text-cream hover:bg-forest-2"
          >
            Verify it is you
          </button>
        )}
        <button
          onClick={() => onRespond("cancelled")}
          className="w-full rounded-full border border-forest py-3 font-semibold hover:bg-sand"
        >
          Cancel payment
        </button>
        {decision.action === "hold" && (
          <p className="text-center text-xs text-muted">An analyst is reviewing this payment now.</p>
        )}
      </div>
    </div>
  );
}

function Done({
  outcome,
  scenario,
  note,
  onBack,
}: {
  outcome: "verified" | "cancelled";
  scenario: Scenario;
  note?: string;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <p className="text-xl font-bold">
        {outcome === "verified" ? `Verified. ${formatINR(scenario.amount)} sent.` : "Payment cancelled."}
      </p>
      <p className="text-muted">
        {outcome === "verified"
          ? "Thanks for confirming it was you."
          : "Good call. If someone asked you to pay, hang up and call your bank on the number on your card."}
      </p>
      {note && <p className="text-xs text-muted">{note}</p>}
      <BackButton onClick={onBack} />
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="mt-4 text-sm font-semibold underline underline-offset-4">
      Make another payment
    </button>
  );
}
