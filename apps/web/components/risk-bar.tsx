export function RiskBar({ risk, label }: { risk: number; label?: string }) {
  const pct = Math.round(Math.min(Math.max(risk, 0), 1) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-lg font-bold tabular">Risk {risk.toFixed(2)}</span>
        {label && <span className="text-sm opacity-80">{label}</span>}
      </div>
      <div
        className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-white/20"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Risk score"
      >
        <div className="h-full rounded-full bg-clay" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
