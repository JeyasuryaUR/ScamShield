import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";

// Mirrors services/scorer/scorer/schemas.py
export const ScoreResponse = z.object({
  txn_id: z.string(),
  risk: z.number(),
  action: z.enum(["allow", "verify", "hold"]),
  reasons: z.array(z.object({ code: z.string(), weight: z.number() })),
  model_version: z.string(),
  latency_ms: z.number(),
});
export type ScoreResponse = z.infer<typeof ScoreResponse>;

export const LatencyStats = z.object({
  count: z.number(),
  p50_ms: z.number(),
  p95_ms: z.number(),
  p99_ms: z.number(),
  max_ms: z.number(),
  tps_1m: z.number(),
});
export type LatencyStats = z.infer<typeof LatencyStats>;

export type ScoreRequest = {
  txn_id: string;
  account_id: string;
  payee_id: string;
  amount: number;
  type: "PAYMENT" | "TRANSFER" | "CASH_OUT" | "CASH_IN" | "DEBIT";
  ts: string;
  old_balance: number;
  channel?: string;
  update_history?: boolean;
};

async function call<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}, timeoutMs = 2000): Promise<T> {
  const { SCORER_URL, SCORER_API_KEY } = env();
  const res = await fetch(`${SCORER_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(SCORER_API_KEY ? { "x-api-key": SCORER_API_KEY } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`scorer ${path} returned ${res.status}`);
  return schema.parse(await res.json());
}

export const scorePayment = (req: ScoreRequest) =>
  call("/score", ScoreResponse, { method: "POST", body: JSON.stringify(req) });

export async function scorerStats(): Promise<LatencyStats | null> {
  try {
    return await call("/stats", LatencyStats, {}, 1000);
  } catch {
    return null;
  }
}
