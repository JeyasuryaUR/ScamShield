import { NextResponse } from "next/server";
import { z } from "zod";
import { DEMO_ACCOUNT, DEMO_BALANCE, SCENARIOS } from "@/lib/demo";
import { scorePayment } from "@/lib/scorer";
import { templateWarnings } from "@/lib/warnings";

const Body = z.object({ scenarioId: z.enum(SCENARIOS.map((s) => s.id) as [string, ...string[]]) });

/** Today's date at the scenario's local (IST) time, as an ISO string. */
function todayAtIST(hour: number, minute: number) {
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  const utcMs = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), hour, minute) - 5.5 * 3600_000;
  return new Date(utcMs).toISOString();
}

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "unknown scenario" }, { status: 400 });
  const s = SCENARIOS.find((x) => x.id === parsed.data.scenarioId)!;

  try {
    const decision = await scorePayment({
      txn_id: `APP-${crypto.randomUUID()}`,
      account_id: DEMO_ACCOUNT,
      payee_id: s.payee,
      amount: s.amount,
      type: s.type,
      ts: todayAtIST(s.hour, s.minute),
      old_balance: DEMO_BALANCE,
      channel: "app",
      update_history: false, // keep the demo repeatable
    });
    const codes = decision.reasons.map((r) => r.code);
    return NextResponse.json({
      decision,
      // Instant template wording; the client can ask /api/warnings for friendlier LLM text.
      warnings: decision.action === "allow" ? null : templateWarnings(decision.action, codes),
    });
  } catch (e) {
    console.error("scoring failed", e);
    return NextResponse.json({ error: "Scoring service unavailable" }, { status: 503 });
  }
}
