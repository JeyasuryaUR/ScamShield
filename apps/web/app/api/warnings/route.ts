import { NextResponse } from "next/server";
import { z } from "zod";
import { REASON_COPY } from "@/lib/reasons";
import { llmWarnings } from "@/lib/warnings";

// Public, so inputs are tightly bounded: known codes only, which also bounds the LLM cache size.
const Body = z.object({
  kind: z.enum(["verify", "hold"]),
  codes: z.array(z.string().refine((c) => c in REASON_COPY)).max(3),
  amount: z.number().positive().max(1e9),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const { kind, codes, amount } = parsed.data;
  return NextResponse.json(await llmWarnings(kind, codes, amount));
}
