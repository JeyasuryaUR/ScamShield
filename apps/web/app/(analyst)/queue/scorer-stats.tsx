"use client";

import { useEffect, useState } from "react";

type Stats = { p50_ms: number; p99_ms: number; tps_1m: number; count: number } | null;

/** Live scorer latency, straight from the scorer's /stats endpoint (via our API route). */
export function ScorerStats() {
  const [stats, setStats] = useState<Stats | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/scorer/stats", { cache: "no-store" });
        if (alive) setStats(res.ok ? await res.json() : null);
      } catch {
        if (alive) setStats(null);
      }
    };
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (stats === undefined) return <div className="h-14 w-72 animate-pulse rounded-2xl bg-sand/60" />;
  if (stats === null)
    return <p className="rounded-2xl bg-clay-soft px-4 py-2 text-sm">Scorer offline. Check SCORER_URL.</p>;

  const items = [
    ["p99 latency", `${stats.p99_ms.toFixed(2)} ms`],
    ["p50", `${stats.p50_ms.toFixed(2)} ms`],
    ["Throughput", `${stats.tps_1m.toFixed(1)} tx/s`],
  ];
  return (
    <dl className="flex gap-6 rounded-2xl bg-forest px-5 py-3 text-cream">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs opacity-70">{k}</dt>
          <dd className="text-lg font-bold tabular">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
