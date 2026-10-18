import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AUDIT_EVENTS, AUDIT_PAGE_SIZE, parseAuditFilters, queryAudit, type AuditFilters } from "@/lib/audit";
import { formatDateTime } from "@/lib/format";
import { actorNames } from "@/lib/queries";
import { VerifyChain } from "./verify-chain";

export const metadata: Metadata = { title: "Audit log" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audit log</h1>
          <p className="mt-1 max-w-2xl text-muted">
            Every decision, review and customer response, with its inputs. Append-only, and each entry carries a
            hash of the one before it, so any edit breaks the chain.
          </p>
        </div>
        <VerifyChain />
      </div>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-3xl bg-sand/60" />}>
        <AuditTable searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function AuditTable({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseAuditFilters(await searchParams);
  const { rows, count } = await queryAudit(filters);
  const nameOf = await actorNames(rows.map((r) => r.actor));
  const exportQuery = new URLSearchParams(
    Object.entries({ txn: filters.txn, event: filters.event }).filter((e): e is [string, string] => !!e[1]),
  );

  return (
    <section className="rounded-3xl bg-paper p-4 ring-1 ring-sand sm:p-6">
      <form className="mb-4 flex flex-wrap items-end gap-3" action="/audit">
        <label className="text-sm">
          <span className="block text-muted">Transaction ID</span>
          <input
            name="txn"
            defaultValue={filters.txn}
            className="mt-1 rounded-lg border border-sand bg-cream px-3 py-1.5 font-mono"
          />
        </label>
        <label className="text-sm">
          <span className="block text-muted">Event</span>
          <select name="event" defaultValue={filters.event ?? ""} className="mt-1 rounded-lg border border-sand bg-cream px-3 py-1.5">
            <option value="">All events</option>
            {AUDIT_EVENTS.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
        </label>
        <button className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-cream">Filter</button>
        <a
          href={`/api/audit/export?${exportQuery}`}
          className="ml-auto rounded-full border border-forest px-4 py-2 text-sm font-semibold hover:bg-forest hover:text-cream"
        >
          Export CSV
        </a>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full min-w-180 text-left text-sm">
          <thead className="text-muted">
            <tr className="border-b border-sand">
              <th className="py-2 pr-3 font-medium">#</th>
              <th className="py-2 pr-3 font-medium">Time (IST)</th>
              <th className="py-2 pr-3 font-medium">Event</th>
              <th className="py-2 pr-3 font-medium">Actor</th>
              <th className="py-2 pr-3 font-medium">Transaction</th>
              <th className="py-2 pr-3 font-medium">Detail</th>
              <th className="py-2 font-medium">Hash</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-sand/70 align-top">
                <td className="py-2 pr-3 tabular text-muted">{r.id}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(r.at)}</td>
                <td className="py-2 pr-3 font-medium">{r.event}</td>
                <td className="py-2 pr-3">{nameOf(r.actor)}</td>
                <td className="py-2 pr-3 font-mono text-xs">
                  {r.decision_id ? <Link href={`/tx/${r.decision_id}`} className="underline">{r.txn_id}</Link> : r.txn_id}
                </td>
                <td className="py-2 pr-3">
                  <details>
                    <summary className="cursor-pointer text-muted">inputs</summary>
                    <pre className="mt-1 max-w-md overflow-x-auto rounded-lg bg-cream p-2 text-xs">
                      {JSON.stringify(r.payload, null, 2)}
                    </pre>
                  </details>
                </td>
                <td className="py-2 font-mono text-xs text-muted" title={`prev ${r.prev_hash ?? "none"}`}>
                  {r.hash.slice(0, 12)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="py-10 text-center text-muted">No entries match.</p>}
      </div>
      <Pager filters={filters} total={count} />
    </section>
  );
}

function Pager({ filters, total }: { filters: AuditFilters; total: number }) {
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const href = (page: number) => {
    const q = new URLSearchParams({ page: String(page) });
    if (filters.txn) q.set("txn", filters.txn);
    if (filters.event) q.set("event", filters.event);
    return `/audit?${q}`;
  };
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-muted">
      <span>
        Page {filters.page} of ~{pages} · ~{total.toLocaleString()} entries
      </span>
      <div className="flex gap-2">
        {filters.page > 1 && <Link href={href(filters.page - 1)} className="underline">Newer</Link>}
        {filters.page < pages && <Link href={href(filters.page + 1)} className="underline">Older</Link>}
      </div>
    </div>
  );
}
