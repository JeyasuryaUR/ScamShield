import type { Metadata } from "next";
import { Suspense } from "react";
import { BarList } from "@/components/bar-list";
import { FEATURE_LABELS } from "@/lib/features";
import { formatDateTime, formatPct } from "@/lib/format";
import { latestModelReport, type Audit, type Metrics } from "@/lib/model-report";
import { reasonCopy } from "@/lib/reasons";
import { scorerStats } from "@/lib/scorer";

export const metadata: Metadata = { title: "Model & audit" };

export default function ModelPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Model &amp; shortcut audit</h1>
        <p className="mt-1 max-w-2xl text-muted">
          How well the live model catches scams on payments it never saw, how fast it answers, and whether it is
          right for the right reasons.
        </p>
      </div>
      <Suspense fallback={<div className="h-128 animate-pulse rounded-3xl bg-sand/60" />}>
        <Report />
      </Suspense>
    </div>
  );
}

async function Report() {
  const [report, live] = await Promise.all([latestModelReport(), scorerStats()]);
  if (!report?.metrics) {
    return (
      <p className="rounded-3xl bg-paper p-8 ring-1 ring-sand">
        No model published yet. Run <code>python ml/src/pipeline.py</code> then <code>python ml/src/publish.py</code>.
      </p>
    );
  }
  const m = report.metrics;
  return (
    <>
      <section className="grid gap-4 lg:grid-cols-[1.2fr_2fr]">
        <div className="rounded-3xl bg-forest p-6 text-cream">
          <p className="text-sm opacity-80">Scams caught at a 1% false-positive rate</p>
          <p className="mt-2 text-6xl font-bold">{formatPct(m.recall_at_1pct_fpr)}</p>
          <p className="mt-3 text-sm opacity-80">
            {m.test_fraud.toLocaleString("en-IN")} scam payments among {m.test_rows.toLocaleString("en-IN")} held-out
            payments ({m.dataset}). Trained on earlier weeks, tested on later ones.
          </p>
          <p className="mt-4 font-mono text-xs opacity-60">
            {m.model_version} · {formatDateTime(m.trained_at)}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Tile label="Caught at 0.1% false positives" value={formatPct(m.recall_at_0_1pct_fpr)} />
          <Tile label="Scam money stopped (verify + hold)" value={formatPct(m.fraud_amount_intercepted_pct)} />
          <Tile label="PR-AUC" value={m.pr_auc.toFixed(3)} />
          <Tile label="Live p99 latency" value={live ? `${live.p99_ms.toFixed(2)} ms` : "offline"} />
          <Tile label="Live throughput" value={live ? `${live.tps_1m.toFixed(1)} tx/s` : "offline"} />
          <Tile label="Payments scored (live)" value={live ? live.count.toLocaleString("en-IN") : "offline"} />
        </dl>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <ActionsTable m={m} />
        <Card title="Reasons shown on caught scams">
          <BarList
            label="Reason codes on flagged scam payments"
            items={Object.entries(m.reason_codes_on_flagged_fraud).map(([code, n]) => ({
              key: code,
              label: reasonCopy(code).title,
              value: n,
            }))}
          />
        </Card>
        <Card title="What the model relies on (gain)">
          <BarList
            label="Feature importance by gain"
            format={(v) => `${Math.round(v / 1000).toLocaleString("en-IN")}k`}
            items={Object.entries(m.feature_importance_gain).map(([f, g]) => ({
              key: f,
              label: FEATURE_LABELS[f]?.label ?? f,
              value: g,
            }))}
          />
        </Card>
      </section>

      {report.audit ? <ShortcutAudit audit={report.audit} /> : <p className="text-muted">No shortcut audit published.</p>}
      {report.ieeeAudit && <IeeeAudit audit={report.ieeeAudit} />}
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-paper p-4 ring-1 ring-sand">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold">{value}</dd>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl bg-paper p-6 ring-1 ring-sand">
      <h2 className="mb-4 font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function ActionsTable({ m }: { m: Metrics }) {
  const cols = ["allow", "verify", "hold"] as const;
  return (
    <Card title="What happened to held-out payments">
      <table className="w-full text-sm">
        <thead className="text-muted">
          <tr>
            <th className="pb-2 text-left font-medium" />
            {cols.map((c) => (
              <th key={c} className="pb-2 text-right font-medium capitalize">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular">
          {(["fraud", "legit"] as const).map((row) => (
            <tr key={row} className="border-t border-sand">
              <th className="py-2 text-left font-medium">{row === "fraud" ? "Scams" : "Genuine"}</th>
              {cols.map((c) => (
                <td key={c} className="py-2 text-right">
                  {m.actions[row][c].toLocaleString("en-IN")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-sm text-muted">
        Verify at risk ≥ {m.verify_threshold.toFixed(4)} (1% of genuine payments), hold at ≥{" "}
        {m.hold_threshold.toFixed(4)} (0.1%).
      </p>
    </Card>
  );
}

function ShortcutAudit({ audit }: { audit: Audit }) {
  const rows = audit.features.filter((f) => f.kind !== "approved");
  return (
    <section className="rounded-3xl bg-forest p-6 text-cream">
      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <div>
          <h2 className="text-2xl font-bold">Right for the right reasons</h2>
          <p className="mt-6 text-6xl font-bold text-clay">
            {audit.recovered}/{audit.planted}
          </p>
          <p className="mt-1 opacity-90">planted shortcuts recovered by the audit</p>
          <p className="mt-4 text-sm opacity-80">
            {audit.false_alarms?.length ? `${audit.false_alarms.length} false alarm(s)` : "No false alarms"}.{" "}
            {audit.passes} passes: strong shortcuts hide weaker ones, so each pass removes what it found and
            retrains. Random decoy columns set the noise floor.
          </p>
          <dl className="mt-6 space-y-2 text-sm">
            <Score label="Model using every column" v={audit.model_all_columns.recall_at_1pct_fpr} />
            <Score label="Retrained without flagged columns" v={audit.model_without_flagged.recall_at_1pct_fpr} />
            <Score label="Approved fraud signals only" v={audit.clean_model?.recall_at_1pct_fpr ?? null} />
          </dl>
          <p className="mt-3 text-xs opacity-70">
            Recall at 1% false positives. The jump with every column comes from the shortcuts. Once the flagged
            columns are removed, recall lands next to the approved-only model, so little shortcut signal is left.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-140 text-left text-sm">
            <thead className="opacity-70">
              <tr className="border-b border-white/15">
                <th className="py-2 pr-3 font-medium">Column</th>
                <th className="py-2 pr-3 font-medium">Truth</th>
                <th className="py-2 pr-3 text-right font-medium">Shuffle drop</th>
                <th className="py-2 pr-3 text-right font-medium">Mask drop</th>
                <th className="py-2 pr-3 font-medium">Audit verdict</th>
                <th className="py-2 text-right font-medium">Recall lost if removed</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {rows.map((f) => (
                <tr key={f.name} className="border-b border-white/10" title={f.description}>
                  <td className="py-1.5 pr-3 font-mono text-xs">{f.name}</td>
                  <td className="py-1.5 pr-3">
                    {f.kind === "planted" ? `planted (${f.strength})` : f.kind}
                  </td>
                  <td className="py-1.5 pr-3 text-right">{f.perm_drop.toFixed(4)}</td>
                  <td className="py-1.5 pr-3 text-right">{f.mask_drop.toFixed(4)}</td>
                  <td className="py-1.5 pr-3">
                    {f.flagged ? (
                      <span className="rounded bg-clay px-1.5 py-0.5 text-xs font-semibold text-forest">
                        ⚑ flagged{f.pass ? `, pass ${f.pass}` : ""}
                      </span>
                    ) : (
                      <span className="text-xs opacity-70">not relied on</span>
                    )}
                  </td>
                  <td className="py-1.5 text-right">
                    {f.retrain_recall_drop != null ? formatPct(f.retrain_recall_drop) : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Score({ label, v }: { label: string; v: number | null }) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/10 pb-1">
      <dt className="opacity-80">{label}</dt>
      <dd className="font-semibold tabular">{formatPct(v)}</dd>
    </div>
  );
}

function IeeeAudit({ audit }: { audit: Audit }) {
  const relied = audit.features.filter((f) => f.kind === "candidate" && f.relied_on);
  return (
    <section className="rounded-3xl bg-paper p-6 ring-1 ring-sand">
      <h2 className="font-semibold">Real-data check: IEEE-CIS device and identity fields</h2>
      <p className="mt-1 text-sm text-muted">
        A model given device, browser and email-domain columns leans on {relied.length} of them. These would need
        a human review before going live.
      </p>
      <BarList
        label="Unreviewed IEEE-CIS columns the model relies on"
        format={(v) => v.toFixed(4)}
        items={relied.map((f) => ({ key: f.name, label: f.name, value: f.perm_drop }))}
      />
    </section>
  );
}
