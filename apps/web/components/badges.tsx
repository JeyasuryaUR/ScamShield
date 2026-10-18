import type { Enums } from "@/lib/database.types";

const ACTION_STYLE: Record<Enums<"txn_action">, string> = {
  hold: "bg-clay text-forest border-clay",
  verify: "bg-transparent text-forest border-forest",
  allow: "bg-transparent text-muted border-sand",
};

export function ActionBadge({ action }: { action: Enums<"txn_action"> }) {
  return (
    <span className={`inline-flex rounded-full border px-3 py-0.5 text-sm font-semibold capitalize ${ACTION_STYLE[action]}`}>
      {action}
    </span>
  );
}

const STATUS: Record<Enums<"decision_status">, { label: string; style: string }> = {
  allowed: { label: "Allowed", style: "bg-moss-soft text-moss" },
  awaiting_customer: { label: "Awaiting customer", style: "bg-amber-soft text-amber" },
  pending_review: { label: "Needs review", style: "bg-clay-soft text-clay" },
  released: { label: "Released", style: "bg-moss-soft text-moss" },
  blocked: { label: "Blocked", style: "bg-forest text-cream" },
  customer_verified: { label: "Customer verified", style: "bg-moss-soft text-moss" },
  customer_cancelled: { label: "Customer cancelled", style: "bg-sand text-forest" },
};

export function StatusBadge({ status }: { status: Enums<"decision_status"> }) {
  const s = STATUS[status];
  return <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${s.style}`}>{s.label}</span>;
}
