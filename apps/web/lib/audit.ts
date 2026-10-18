import "server-only";
import { createClient } from "@/lib/supabase/server";

export const AUDIT_EVENTS = [
  "decision.created",
  "review.release",
  "review.keep_hold",
  "customer.verified",
  "customer.cancelled",
] as const;

export type AuditFilters = { txn?: string; event?: string; page: number };
export const AUDIT_PAGE_SIZE = 50;

export function parseAuditFilters(sp: Record<string, string | string[] | undefined>): AuditFilters {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : undefined);
  const event = one("event");
  return {
    txn: one("txn")?.slice(0, 64) || undefined,
    event: AUDIT_EVENTS.includes(event as (typeof AUDIT_EVENTS)[number]) ? event : undefined,
    page: Math.max(1, Number(one("page")) || 1),
  };
}

export async function queryAudit(f: AuditFilters, limit = AUDIT_PAGE_SIZE) {
  const supabase = await createClient();
  let q = supabase
    .from("audit_log")
    .select("id, at, actor, event, txn_id, decision_id, payload, prev_hash, hash", { count: "estimated" })
    .order("id", { ascending: false });
  if (f.txn) q = q.eq("txn_id", f.txn);
  if (f.event) q = q.eq("event", f.event);
  const from = (f.page - 1) * limit;
  const { data, count, error } = await q.range(from, from + limit - 1);
  if (error) throw new Error(error.message);
  return { rows: data, count: count ?? 0 };
}
