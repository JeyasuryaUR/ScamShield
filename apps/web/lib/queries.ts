import "server-only";
import type { Tables } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { DECISION_WITH_TXN, type DecisionWithTxn, type QueueCounts } from "@/lib/types";

export async function flaggedDecisions(limit = 60): Promise<DecisionWithTxn[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("decisions")
    .select(DECISION_WITH_TXN)
    .neq("action", "allow")
    .order("decided_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data;
}

const UUID = /^[0-9a-f-]{36}$/i;

/** audit_log.actor is 'scorer', 'customer' or a staff user id; map ids to names. */
export async function actorNames(actors: string[]): Promise<(actor: string) => string> {
  const ids = [...new Set(actors.filter((a) => UUID.test(a)))];
  const names = new Map<string, string>();
  if (ids.length) {
    const supabase = await createClient();
    const { data } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    data?.forEach((p) => names.set(p.id, p.full_name));
  }
  return (actor) => names.get(actor) ?? (UUID.test(actor) ? "staff member" : actor);
}

export async function queueCounts(): Promise<QueueCounts> {
  const supabase = await createClient();
  const count = async (status: Tables<"decisions">["status"]) => {
    const { count } = await supabase.from("decisions").select("id", { count: "exact", head: true }).eq("status", status);
    return count ?? 0;
  };
  const [pending, awaiting] = await Promise.all([count("pending_review"), count("awaiting_customer")]);
  const { count: total } = await supabase.from("decisions").select("id", { count: "estimated", head: true });
  return { pending, awaiting, total: total ?? 0 };
}
