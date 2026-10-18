import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { scorerStats } from "@/lib/scorer";

export async function GET() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const stats = await scorerStats();
  return stats ? NextResponse.json(stats) : NextResponse.json({ error: "scorer unavailable" }, { status: 503 });
}
