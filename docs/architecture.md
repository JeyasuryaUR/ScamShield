# Architecture

## The hot path

```
POST /score {txn_id, account_id, payee_id, amount, type, ts, old_balance}
  1. FeatureState.features(txn)     history *before* this payment (in-process dicts)
  2. LightGBM pred_contrib          one call → risk (sigmoid of the sum) + exact TreeSHAP values
  3. reasons.explain()              SHAP picks the top signals; a rule confirms each is literally true
  4. Policy.decide(risk)            allow < verify_threshold ≤ verify < hold_threshold ≤ hold
  5. FeatureState.update(txn)       the payment becomes history (skipped when update_history=false)
  6. return the decision            then enqueue it for Supabase (background task, batched)
```

Only the scorer sits between a payment and its decision. Next.js, Postgres and the LLM all run
*after* it, so the latency we report is the decision itself. Steps 1–5 take ~1 ms (p50) on a laptop.

- **No train/serve skew.** `services/scorer/scorer/features.py` is the one implementation. The ML
  pipeline replays every historical row through the same `FeatureState` in time order, and the scorer
  starts from a snapshot taken at the train/test cut.
- **No `shap` dependency.** LightGBM's `pred_contrib=True` returns exact TreeSHAP values. That's one
  less native package to build on s390x.
- **Reasons are truthful.** SHAP says *which* signals pushed the risk up; a plain rule then checks the
  statement holds (we never say "odd hour" at 2 pm). The scorer sends codes only (`NEW_PAYEE`), and
  the app turns them into English and Tamil.
- **Idempotent.** A retried `txn_id` returns the cached decision and doesn't count twice in history.
- **Thresholds are data.** `evaluate.py` sets verify at 1% of genuine payments and hold at 0.1%,
  then writes `policy.yaml`, versioned with the model.

## Data model (Supabase / Postgres)

| Table | Written by | Notes |
|---|---|---|
| `transactions` | `ingest_decisions()` | raw payment as scored |
| `decisions` | `ingest_decisions()`, `review_decision()`, `customer_respond()` | risk, action, status, reasons, features, model version, latency. Realtime-enabled |
| `reviews` | `review_decision()` | analyst verdict + note |
| `audit_log` | `private.append_audit()` only | append-only, hash-chained |
| `model_versions`, `shortcut_audits` | `ml/src/publish.py` | metrics and audit results shown on /model |
| `profiles` | trigger on `auth.users` | role: `analyst`, `compliance`, `admin` |

**Security model**
- Clients can only *read*, and RLS limits that to staff. Every write goes through a
  `SECURITY DEFINER` function that checks the caller's role, validates the state transition and writes
  the audit entry in the same transaction.
- `ingest_decisions` and `customer_respond` are executable only by `service_role` (scorer, server code).
- `audit_log` rejects UPDATE/DELETE/TRUNCATE via triggers. Each row stores
  `sha256(prev_hash | event | txn | payload | at)`, and `verify_audit_chain()` recomputes the chain, so
  even a superuser edit that bypasses the trigger shows up (covered by `supabase/tests`).
- Public sign-up is off; staff accounts are created by an admin.

**Status flow**: `allow → allowed` · `verify → awaiting_customer → customer_verified | customer_cancelled` ·
`hold → pending_review → released | blocked` (or `customer_cancelled`).

## Web app

Next.js 16 with Cache Components: each page prerenders a static shell, and the user-specific
data streams in behind `<Suspense>`. Auth uses `@supabase/ssr` cookies; `proxy.ts` refreshes the
session and redirects signed-out users.

| Route | Purpose |
|---|---|
| `/queue` | Live review queue (Supabase Realtime), live scorer p99 and throughput |
| `/tx/[id]` | Reasons, risk, model inputs, account history, Release / Keep hold, audit trail |
| `/audit` | Filterable audit log, hash-chain check, CSV export |
| `/model` | Recall at 1% FPR, actions on held-out data, reason mix, feature importance, shortcut audit |
| `/pay` | Public customer demo: payments go through the real scorer and show the EN/TA warning |

The LLM (Gemini, optional) only rewrites the customer warning. It gets reason codes and a rounded
amount, never names or IDs. Its output is validated, cached per reason combination and replaced by
templates on any failure or a 2.5 s timeout. It never affects the decision.

## Shortcut audit

1. `plant_shortcuts.py` adds 12 columns that leak the label for the wrong reasons (emulator flag, ID
   format, timestamp leak, …) at strong, medium and weak strengths, and records a manifest.
2. A model is trained on approved features plus the planted ones, plus random decoys added by the audit.
3. Each column is shuffled (3×) and masked. A column counts as *relied on* only if its PR-AUC drop
   beats the decoys' noise floor. Relied-on columns that aren't approved get flagged.
4. **Iterate.** Strong shortcuts hide weaker ones, so the flagged columns are removed, the model is
   retrained and audited again, until a pass flags nothing new (the second pass typically catches
   the medium-strength ones).
5. Each flagged column is retrained-out to measure the recall it was propping up. Then all flagged
   columns are removed together and compared with a model on approved features only: if the two
   match, little shortcut signal is left.
6. Only then is the manifest opened to score recovery. The same code runs on IEEE-CIS device and
   identity fields (`--dataset ieee`) where nothing is planted.

## Scaling and next steps

- **State**: in-process dicts, so one worker per process. To scale out, shard by `account_id` (consistent
  hashing at the load balancer) or move `FeatureState` to Redis. The interface is two methods.
- **History on settlement**: production should call `update` when money actually moves (the API
  supports `update_history=false` for scoring-only).
- **Accelerator**: on z16 / LinuxONE 4, evaluate IBM Snap ML for tree-ensemble inference on the
  on-chip AI accelerator, after confirming the Community Cloud exposes it.
- **Model governance**: every decision stores `model_version` and its features; `publish.py` uploads
  the model files to the private `models` Storage bucket under that version.
