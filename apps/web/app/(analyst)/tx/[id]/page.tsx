import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionBadge, StatusBadge } from "@/components/badges";
import { ReasonList } from "@/components/reason-list";
import { RiskBar } from "@/components/risk-bar";
import { canReview, getStaff } from "@/lib/auth";
import { featureRows } from "@/lib/features";
import { formatDateTime, formatINR, formatTime, riskLevel } from "@/lib/format";
import { actorNames } from "@/lib/queries";
import { parseReasons } from "@/lib/reasons";
import { createClient } from "@/lib/supabase/server";
import { DECISION_WITH_TXN } from "@/lib/types";
import { ReviewPanel } from "./review-panel";

export const metadata: Metadata = { title: "Decision" };

export default function DecisionPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="space-y-6">
      <Link href="/queue" className="text-sm text-muted hover:text-forest">
        ← Review queue
      </Link>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-3xl bg-sand/60" />}>
        <Decision params={params} />
      </Suspense>
    </div>
  );
}

async function Decision({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const supabase = await createClient();
  const [staff, { data: d }] = await Promise.all([
    getStaff(),
    supabase.from("decisions").select(DECISION_WITH_TXN).eq("id", id).maybeSingle(),
  ]);
  if (!d || !d.transactions) notFound();
  const txn = d.transactions;

  const [{ data: history }, { data: audit }, { data: reviews }] = await Promise.all([
    supabase
      .from("transactions")
      .select("id, payee_id, amount, type, ts")
      .eq("account_id", txn.account_id)
      .neq("id", txn.id)
      .lt("ts", txn.ts)
      .order("ts", { ascending: false })
      .limit(8),
    supabase.from("audit_log").select("id, at, actor, event, hash").eq("txn_id", txn.id).order("id"),
    supabase.from("reviews").select("verdict, note, created_at, profiles(full_name)").eq("decision_id", d.id),
  ]);
  const reasons = parseReasons(d.reasons);
  const nameOf = await actorNames((audit ?? []).map((a) => a.actor));

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-6">
        <section className="rounded-3xl bg-paper p-6 ring-1 ring-sand">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-4xl font-bold tabular">{formatINR(txn.amount)}</p>
              <p className="mt-1 text-muted">
                {txn.type.replace("_", " ").toLowerCase()} · {formatDateTime(txn.ts)} · via {txn.channel}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={d.status} />
              <ActionBadge action={d.action} />
            </div>
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-muted">From account</dt>
              <dd className="font-mono">{txn.account_id}</dd>
            </div>
            <div>
              <dt className="text-muted">To payee</dt>
              <dd className="font-mono">{txn.payee_id}</dd>
            </div>
            <div>
              <dt className="text-muted">Balance before</dt>
              <dd className="tabular">{formatINR(txn.old_balance)}</dd>
            </div>
            <div>
              <dt className="text-muted">Model</dt>
              <dd className="font-mono text-xs">
                {d.model_version} · scored in {d.latency_ms.toFixed(2)} ms
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-3xl bg-forest p-6 text-cream">
          <h2 className="mb-4 opacity-90">Why it was flagged</h2>
          <ReasonList reasons={reasons} detailed />
          <div className="mt-6">
            <RiskBar risk={d.risk} label={riskLevel(d.risk)} />
          </div>
          <div className="mt-6 border-t border-white/15 pt-5">
            {d.status === "pending_review" && canReview(staff) ? (
              <ReviewPanel decisionId={d.id} />
            ) : d.status === "pending_review" ? (
              <p className="text-sm opacity-80">Waiting for an analyst. Your role ({staff.role}) is read-only.</p>
            ) : (
              <ReviewSummary reviews={reviews ?? []} status={d.status} />
            )}
          </div>
        </section>
      </div>

      <div className="space-y-6">
        <section className="rounded-3xl bg-paper p-6 ring-1 ring-sand">
          <h2 className="mb-3 font-semibold">Model inputs</h2>
          <table className="w-full text-sm">
            <tbody>
              {featureRows(d.features).map((f) => (
                <tr key={f.key} className="border-t border-sand first:border-0">
                  <td className="py-1.5 pr-3 text-muted">{f.label}</td>
                  <td className="py-1.5 text-right font-medium tabular">{f.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="rounded-3xl bg-paper p-6 ring-1 ring-sand">
          <h2 className="mb-3 font-semibold">Earlier payments from this account</h2>
          {history?.length ? (
            <ul className="space-y-1.5 text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex justify-between gap-3">
                  <span className="truncate">
                    <span className={h.payee_id === txn.payee_id ? "font-semibold text-clay" : ""}>
                      {h.payee_id}
                    </span>{" "}
                    <span className="text-muted">· {formatTime(h.ts)}</span>
                  </span>
                  <span className="tabular">{formatINR(h.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No earlier payments stored for this account.</p>
          )}
        </section>

        <section className="rounded-3xl bg-paper p-6 ring-1 ring-sand">
          <h2 className="mb-3 font-semibold">Audit trail</h2>
          <ol className="space-y-2 text-sm">
            {(audit ?? []).map((a) => (
              <li key={a.id} className="flex justify-between gap-3">
                <span>
                  <span className="font-medium">{a.event}</span>{" "}
                  <span className="text-muted">by {nameOf(a.actor)}</span>
                </span>
                <span className="font-mono text-xs text-muted" title={a.hash}>
                  {formatTime(a.at)} · {a.hash.slice(0, 8)}
                </span>
              </li>
            ))}
          </ol>
          <Link href={`/audit?txn=${txn.id}`} className="mt-3 inline-block text-sm underline underline-offset-4">
            Open in audit log
          </Link>
        </section>
      </div>
    </div>
  );
}

function ReviewSummary({
  reviews,
  status,
}: {
  reviews: { verdict: string; note: string | null; created_at: string; profiles: { full_name: string } | null }[];
  status: string;
}) {
  if (reviews.length === 0)
    return <p className="text-sm opacity-80">No analyst action needed (status: {status.replaceAll("_", " ")}).</p>;
  return (
    <ul className="space-y-2 text-sm">
      {reviews.map((r) => (
        <li key={r.created_at}>
          <span className="font-semibold">{r.verdict === "release" ? "Released" : "Kept on hold"}</span> by{" "}
          {r.profiles?.full_name ?? "analyst"} at {formatDateTime(r.created_at)}
          {r.note && <p className="opacity-80">“{r.note}”</p>}
        </li>
      ))}
    </ul>
  );
}
