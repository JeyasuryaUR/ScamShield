"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActionBadge, StatusBadge } from "@/components/badges";
import type { Enums } from "@/lib/database.types";
import { formatINR, formatTime } from "@/lib/format";
import { parseReasons, reasonCopy } from "@/lib/reasons";
import { getBrowserClient } from "@/lib/supabase/client";
import { DECISION_WITH_TXN, type DecisionWithTxn, type QueueCounts } from "@/lib/types";

type Tab = "review" | "customer" | "all";
type Status = Enums<"decision_status">;
const TABS: { id: Tab; label: string }[] = [
  { id: "review", label: "Needs review" },
  { id: "customer", label: "Awaiting customer" },
  { id: "all", label: "All flagged" },
];
const MAX_ROWS = 200;

export function QueueLive({ initialRows, counts }: { initialRows: DecisionWithTxn[]; counts: QueueCounts }) {
  const [rows, setRows] = useState(initialRows);
  const [tab, setTab] = useState<Tab>("review");
  const [live, setLive] = useState(false);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  // Totals come from the server; live events move them as statuses change.
  const [liveCounts, setLiveCounts] = useState(counts);
  const statusById = useRef(new Map(initialRows.map((r) => [r.id, r.status])));

  useEffect(() => {
    const supabase = getBrowserClient();
    const channel = supabase
      .channel("review-queue")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "decisions", filter: "action=neq.allow" },
        async (payload) => {
          const id = (payload.new as { id?: number }).id;
          if (!id) return;
          const { data } = await supabase.from("decisions").select(DECISION_WITH_TXN).eq("id", id).single();
          if (!data) return;
          const before = statusById.current.get(id);
          statusById.current.set(id, data.status);
          if (before !== data.status) setLiveCounts((c) => moveCount(c, before, data.status));
          setRows((prev) => [data, ...prev.filter((r) => r.id !== id)].slice(0, MAX_ROWS).sort(byNewest));
          if (payload.eventType === "INSERT") {
            setFresh((s) => new Set(s).add(id));
            setTimeout(() => setFresh((s) => (s.delete(id), new Set(s))), 4000);
          }
        },
      )
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const visible = useMemo(
    () =>
      rows.filter((r) =>
        tab === "review" ? r.status === "pending_review" : tab === "customer" ? r.status === "awaiting_customer" : true,
      ),
    [rows, tab],
  );

  const tabCount: Record<Tab, number> = { review: liveCounts.pending, customer: liveCounts.awaiting, all: rows.length };

  return (
    <section className="rounded-3xl bg-paper p-4 shadow-sm ring-1 ring-sand sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="flex gap-1 rounded-full bg-cream p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                tab === t.id ? "bg-forest text-cream" : "hover:bg-sand"
              }`}
            >
              {t.label} <span className="tabular opacity-70">{tabCount[t.id]}</span>
            </button>
          ))}
        </div>
        <span className="flex items-center gap-2 text-sm">
          <span className={`size-2.5 rounded-full ${live ? "bg-clay animate-pulse" : "bg-sand"}`} aria-hidden="true" />
          {live ? "Live" : "Connecting…"}
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="py-16 text-center text-muted">
          Nothing here right now. Start the replayer to stream payments: <code>python tools/replayer/replay.py</code>
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((r) => (
            <QueueCard key={r.id} row={r} fresh={fresh.has(r.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function QueueCard({ row, fresh }: { row: DecisionWithTxn; fresh: boolean }) {
  const reasons = parseReasons(row.reasons);
  const txn = row.transactions;
  const headline = reasons[0] ? reasonCopy(reasons[0].code).title : "Elevated risk";
  return (
    <li>
      <Link
        href={`/tx/${row.id}`}
        className={`flex items-center gap-4 rounded-2xl border bg-paper px-5 py-4 transition hover:border-forest ${
          row.action === "hold" ? "border-clay" : "border-forest/40"
        } ${fresh ? "ring-4 ring-clay/25" : ""}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold tabular">{txn ? formatINR(txn.amount) : "—"}</span>
            <StatusBadge status={row.status} />
          </div>
          <p className="mt-0.5 truncate text-sm text-muted">
            {headline}
            {reasons.length > 1 && ` +${reasons.length - 1} more`} · {txn ? formatTime(txn.ts) : ""} ·{" "}
            <span className="font-mono text-xs">{txn?.account_id}</span>
          </p>
        </div>
        <span className="hidden text-sm tabular text-muted sm:block">risk {row.risk.toFixed(2)}</span>
        <ActionBadge action={row.action} />
      </Link>
    </li>
  );
}

function moveCount(c: QueueCounts, from: Status | undefined, to: Status): QueueCounts {
  const delta = (s: Status) => (to === s ? 1 : 0) - (from === s ? 1 : 0);
  return { ...c, pending: c.pending + delta("pending_review"), awaiting: c.awaiting + delta("awaiting_customer") };
}

function byNewest(a: DecisionWithTxn, b: DecisionWithTxn) {
  return b.decided_at.localeCompare(a.decided_at);
}
