import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

// Only demo transactions created by /api/pay can be answered from this public endpoint.
const Body = z.object({
  txnId: z.string().regex(/^APP-[0-9a-f-]{36}$/),
  outcome: z.enum(["verified", "cancelled"]),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });

  const supabase = createAdminClient();
  // The scorer writes decisions in small batches, so the row can lag the response by ~1s.
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, error } = await supabase.rpc("customer_respond", {
      p_txn_id: parsed.data.txnId,
      p_outcome: parsed.data.outcome,
    });
    if (!error) return NextResponse.json({ status: data });
    if (error.code !== "P0002") return NextResponse.json({ error: error.message }, { status: 409 });
    await new Promise((r) => setTimeout(r, 400));
  }
  return NextResponse.json({ error: "Decision not recorded yet. Is the scorer's Supabase sink on?" }, { status: 404 });
}
