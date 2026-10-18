# Results

All numbers come from this repo's artifacts (`ml/artifacts/*.json`, `tools/loadtest/results/*.json`)
on the synthetic PaySim-format dataset (`ml/src/make_synthetic.py`, seed 42). Re-run with
`python ml/src/pipeline.py` and `python tools/loadtest/loadtest.py`. **Rerun on real PaySim and on
LinuxONE before quoting them as final.**

## Detection (model `lgbm-20261018-2befd25c`)

Trained on the first ~60% of the timeline, early-stopped on the next 10%, tested on the last 30%
(202,933 payments, 252 scams). The test period comes strictly after the training data, never a random split.

| Metric | Value |
|---|---|
| **Recall at 1% false-positive rate** (verify threshold) | **69.0%** |
| Recall at 0.1% false-positive rate (hold threshold) | 50.8% |
| Scam *money* stopped (verify + hold) | **92.2%** |
| PR-AUC / ROC-AUC | 0.485 / 0.958 |

What happened to the held-out payments:

|  | Allow | Verify | Hold |
|---|---|---|---|
| Scams (252) | 78 | 46 | 128 |
| Genuine (202,681) | 200,673 | 1,827 (0.9%) | 181 (0.09%) |

Of the 78 missed scams, 45 go to a payee the victim had already paid (a compromised contact, or the
2nd/3rd transfer to the same mule after the first one went through) and 22 are under ₹1,000 ("test"
transfers). That's why the share of scam *money* stopped (92%) is far higher than the share of
scam *payments* (69%). A next step is an episode feature ("first paid this payee minutes ago").

## Speed (single scorer process, Windows laptop, AMD64)

| Load | In-service scoring p50 / p99 | Round trip p50 / p99 |
|---|---|---|
| 50 tx/s (open loop) | 1.33 / **2.98 ms** | 11.5 / 26.4 ms |
| 200 tx/s (open loop) | 1.48 / **2.98 ms** | 11.1 / 41.9 ms |
| Saturation (32 in flight) | 1.07 / 1.48 ms | 49 / 514 ms at **319 tx/s** |

- *In-service scoring* = features + LightGBM + TreeSHAP reasons + policy, measured inside the scorer.
  This is the decision latency.
- *Round trip* on Windows is inflated by the Python load generator (asyncio timers on Windows tick
  every ~15 ms, so requests leave in bursts). Measure it again from a Linux client.
- One process tops out around 320 tx/s because account history is in-process. To scale out, shard
  by account or move state to Redis (see architecture.md).
- **To do: the same table on the LinuxONE Community Cloud VM** (`--url http://<vm>:8000 --label linuxone`).

## Shortcut audit: right for the right reasons

12 shortcuts were planted (strong/medium/weak), plus 4 random decoys to set the noise floor.

| | Value |
|---|---|
| **Planted shortcuts recovered** | **11 / 12** (missed only `ip_octet_parity`, built to be barely informative: 60% vs 50%) |
| False alarms (decoys or approved features flagged) | **0** |
| Passes needed | 3 (pass 2 found 3 shortcuts that stronger ones had been hiding) |
| Recall @1% FPR, model using every column | 98.4% (looks great, and it's wrong) |
| Recall @1% FPR, retrained without flagged columns | 75.0% |
| Recall @1% FPR, approved fraud signals only | 69.0% |

The jump from 69% to 98% is almost entirely shortcut signal. Removing any *single* flagged column
barely moves recall (the others compensate), which is why the audit removes them iteratively and
together rather than trusting one-at-a-time importance.

## Reasons analysts see on caught scams

Transfer type 141 · New payee 63 · Amount far above usual 54 · Empties the account 49 ·
Payee collecting from many people 47 · Odd hour 44 · Large amount 33.

## Demo scenarios (`/pay`, live model)

| Payment | Decision | Reasons |
|---|---|---|
| Groceries ₹640, usual shop, 9:05 am | allow (0.00001) | none |
| ₹3,000 to Amma, 8:15 pm | allow (0.00004) | none |
| ₹15,000 advance to a new marketplace seller, 2:20 pm | **verify** (0.067) | amount far above usual, new payee |
| ₹48,500 to "KYC Verification Desk", 11:42 pm | **hold** (0.98) | amount far above usual, odd hour |

## Caveats

- Synthetic data. The generator was written by us, so the model is learning patterns we put
  there. Real PaySim is supported (`ml/data/raw/PS_*.csv`), but its senders almost never repeat, so
  per-customer reasons are weak there.
- The IEEE-CIS real-data audit is wired up (`pipeline.py --ieee`) but not run yet: it needs the Kaggle download.
