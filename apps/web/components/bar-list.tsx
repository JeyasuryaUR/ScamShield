/** Single-series horizontal bars: thin, rounded at the value end, value at the tip in ink. */
export function BarList({
  items,
  format = (v) => v.toLocaleString("en-IN"),
  label,
}: {
  items: { key: string; label: string; value: number }[];
  format?: (v: number) => string;
  label: string;
}) {
  const max = Math.max(...items.map((i) => i.value), 0) || 1;
  return (
    <ul className="space-y-2.5" aria-label={label}>
      {items.map((i) => (
        <li key={i.key} className="grid grid-cols-[minmax(0,11rem)_1fr] items-center gap-3 text-sm" title={`${i.label}: ${format(i.value)}`}>
          <span className="truncate text-muted">{i.label}</span>
          <span className="flex items-center gap-2">
            <span
              className="h-2.5 rounded-r-[4px] bg-clay"
              style={{ width: `${Math.max((i.value / max) * 85, 0.5)}%` }}
              aria-hidden="true"
            />
            <span className="tabular text-forest">{format(i.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
