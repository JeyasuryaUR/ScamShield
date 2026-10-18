const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const time = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Kolkata",
});
const dateTime = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
  timeZone: "Asia/Kolkata",
});

export const formatINR = (amount: number) => inr.format(amount);
export const formatTime = (iso: string) => time.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatPct = (x: number | null | undefined, digits = 1) =>
  x == null ? "–" : `${(x * 100).toFixed(digits)}%`;

export function riskLevel(risk: number, verifyAt = 0.3, holdAt = 0.8) {
  if (risk >= holdAt) return "High";
  if (risk >= verifyAt) return "Medium";
  return "Low";
}
