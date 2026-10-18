"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const Review = z.object({
  decisionId: z.coerce.number().int().positive(),
  verdict: z.enum(["release", "keep_hold"]),
  note: z.string().max(500).optional(),
});

export type ReviewState = { error?: string; done?: string };

export async function reviewDecision(_: ReviewState, form: FormData): Promise<ReviewState> {
  const parsed = Review.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Invalid review." };

  // Role checks, the state transition and the audit entry all happen inside Postgres.
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_decision", {
    p_decision_id: parsed.data.decisionId,
    p_verdict: parsed.data.verdict,
    p_note: parsed.data.note || undefined,
  });
  if (error) return { error: error.message };

  refresh();
  return { done: parsed.data.verdict === "release" ? "Released. The payment will go through." : "Kept on hold." };
}
