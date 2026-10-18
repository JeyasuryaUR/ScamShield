import type { NextRequest } from "next/server";
import { parseAuditFilters, queryAudit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";

const MAX_ROWS = 10_000;
const PAGE = 1000;

function csvCell(value: unknown) {
  const s = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  // Quote everything, and defuse spreadsheet formula injection.
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replaceAll('"', '""')}"`;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return new Response("unauthorized", { status: 401 });

  const filters = parseAuditFilters(Object.fromEntries(request.nextUrl.searchParams));
  // PostgREST caps each response (1000 rows by default), so page through. RLS limits rows to staff.
  const rows = [];
  for (let page = 1; rows.length < MAX_ROWS; page++) {
    const batch = (await queryAudit({ ...filters, page }, PAGE)).rows;
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  const header = ["id", "at", "event", "actor", "txn_id", "decision_id", "payload", "prev_hash", "hash"];
  const lines = [
    header.join(","),
    ...rows.map((r) => header.map((h) => csvCell(r[h as keyof typeof r])).join(",")),
  ];
  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="scamshield-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
