"use server";

import { createClient } from "@/lib/supabase/server";

export type ChainResult = { ok: boolean; checked: number; firstBadId: number | null } | { error: string };

export async function verifyChain(): Promise<ChainResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("verify_audit_chain");
  if (error || !data?.[0]) return { error: error?.message ?? "no result" };
  return { ok: data[0].ok, checked: Number(data[0].checked), firstBadId: data[0].first_bad_id };
}
