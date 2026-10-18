import { reasonCopy, type Reason } from "@/lib/reasons";

export function ReasonList({ reasons, detailed = false }: { reasons: Reason[]; detailed?: boolean }) {
  if (reasons.length === 0) return <p className="text-sm opacity-70">No strong risk signals.</p>;
  const max = Math.max(...reasons.map((r) => r.weight));
  return (
    <ul className="space-y-3">
      {reasons.map((r) => {
        const en = reasonCopy(r.code, "en");
        return (
          <li key={r.code} className="flex gap-3">
            <span className="mt-2 size-2 shrink-0 rounded-full bg-clay" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{en.title}</span>
                {detailed && <span className="text-xs tabular opacity-70">+{r.weight.toFixed(2)} log-odds</span>}
              </div>
              {detailed && (
                <>
                  <p className="text-sm opacity-80">{en.detail}</p>
                  <p className="font-tamil text-sm opacity-80" lang="ta">
                    {reasonCopy(r.code, "ta").title}
                  </p>
                  <div className="mt-1 h-1 rounded-full bg-white/15">
                    <div className="h-full rounded-full bg-clay/80" style={{ width: `${(r.weight / max) * 100}%` }} />
                  </div>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
