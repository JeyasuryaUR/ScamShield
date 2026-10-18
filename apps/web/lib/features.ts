// Human labels for the model inputs (services/scorer/scorer/features.py FEATURES).
const TYPES = ["PAYMENT", "TRANSFER", "CASH_OUT", "CASH_IN", "DEBIT"];

const yesNo = (v: number) => (v >= 1 ? "Yes" : "No");
const num = (d = 0) => (v: number) => v.toFixed(d);

export const FEATURE_LABELS: Record<string, { label: string; fmt: (v: number) => string }> = {
  is_new_payee: { label: "New payee for this customer", fmt: yesNo },
  amount_vs_sender_mean: { label: "Amount vs customer's average", fmt: (v) => `${v.toFixed(1)}×` },
  log_amount: { label: "Amount", fmt: (v) => `₹${Math.round(Math.expm1(v)).toLocaleString("en-IN")}` },
  balance_drain_ratio: { label: "Share of balance sent", fmt: (v) => `${Math.round(v * 100)}%` },
  drains_account: { label: "Empties the account (≥90%)", fmt: yesNo },
  hour_of_day: { label: "Local hour", fmt: (v) => `${v}:00` },
  is_odd_hour: { label: "Odd hour (11pm–6am)", fmt: yesNo },
  sender_txn_count: { label: "Customer's past payments", fmt: num() },
  sender_txns_1h: { label: "Payments in last hour", fmt: num() },
  payee_first_seen: { label: "Payee never received money before", fmt: yesNo },
  payee_inbound_senders_24h: { label: "Different senders to payee (24h)", fmt: num() },
  type_code: { label: "Payment type", fmt: (v) => TYPES[v] ?? "Unknown" },
};

export function featureRows(features: unknown) {
  if (!features || typeof features !== "object") return [];
  return Object.entries(FEATURE_LABELS).map(([key, { label, fmt }]) => {
    const raw = (features as Record<string, unknown>)[key];
    return { key, label, value: typeof raw === "number" ? fmt(raw) : "n/a" };
  });
}
