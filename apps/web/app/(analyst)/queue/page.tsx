import type { Metadata } from "next";
import { Suspense } from "react";
import { flaggedDecisions, queueCounts } from "@/lib/queries";
import { QueueLive } from "./queue-live";
import { ScorerStats } from "./scorer-stats";

export const metadata: Metadata = { title: "Review queue" };

export default function QueuePage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Review queue</h1>
          <p className="mt-1 text-muted">Payments the model paused. Newest first, updates live.</p>
        </div>
        <ScorerStats />
      </div>
      <Suspense fallback={<QueueSkeleton />}>
        <Queue />
      </Suspense>
    </div>
  );
}

async function Queue() {
  const [rows, counts] = await Promise.all([flaggedDecisions(), queueCounts()]);
  return <QueueLive initialRows={rows} counts={counts} />;
}

function QueueSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-2xl bg-sand/60" />
      ))}
    </div>
  );
}
