import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// Shapes of ml/artifacts/metrics.json and shortcut_audit.json (uploaded by ml/src/publish.py).
const Counts = z.object({ allow: z.number(), verify: z.number(), hold: z.number() });

export const Metrics = z.object({
  model_version: z.string(),
  trained_at: z.string(),
  dataset: z.string(),
  test_rows: z.number(),
  test_fraud: z.number(),
  pr_auc: z.number(),
  roc_auc: z.number(),
  recall_at_1pct_fpr: z.number(),
  recall_at_0_1pct_fpr: z.number(),
  verify_threshold: z.number(),
  hold_threshold: z.number(),
  actions: z.object({ fraud: Counts, legit: Counts }),
  fraud_amount_intercepted_pct: z.number(),
  reason_codes_on_flagged_fraud: z.record(z.string(), z.number()),
  feature_importance_gain: z.record(z.string(), z.number()),
});
export type Metrics = z.infer<typeof Metrics>;

const AuditFeature = z.object({
  name: z.string(),
  kind: z.string(),
  strength: z.string().optional(),
  description: z.string().optional(),
  perm_drop: z.number(),
  mask_drop: z.number(),
  flagged: z.boolean(),
  relied_on: z.boolean(),
  pass: z.number().nullable().optional(),
  retrain_recall_drop: z.number().optional(),
});
const ModelScore = z.object({ pr_auc: z.number().nullable(), recall_at_1pct_fpr: z.number().nullable() });

export const Audit = z.object({
  mode: z.string(),
  ran_at: z.string(),
  noise_floor: z.number(),
  passes: z.number().default(1),
  planted: z.number().optional(),
  recovered: z.number().optional(),
  recovery_rate: z.number().optional(),
  missed: z.array(z.string()).optional(),
  false_alarms: z.array(z.string()).optional(),
  flagged: z.array(z.string()),
  model_all_columns: ModelScore,
  model_without_flagged: ModelScore,
  clean_model: ModelScore.optional(),
  features: z.array(AuditFeature),
});
export type Audit = z.infer<typeof Audit>;

export async function latestModelReport() {
  const supabase = await createClient();
  const { data: model } = await supabase
    .from("model_versions")
    .select("version, metrics, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!model) return null;

  const { data: audits } = await supabase
    .from("shortcut_audits")
    .select("mode, result")
    .eq("model_version", model.version)
    .order("created_at", { ascending: false });

  const metrics = Metrics.safeParse(model.metrics);
  const planted = audits?.find((a) => a.mode === "planted");
  const ieee = audits?.find((a) => a.mode === "ieee");
  const audit = planted ? Audit.safeParse(planted.result) : null;
  const ieeeAudit = ieee ? Audit.safeParse(ieee.result) : null;
  return {
    version: model.version,
    metrics: metrics.success ? metrics.data : null,
    audit: audit?.success ? audit.data : null,
    ieeeAudit: ieeeAudit?.success ? ieeeAudit.data : null,
  };
}
