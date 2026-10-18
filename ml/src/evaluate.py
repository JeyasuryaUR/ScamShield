"""Evaluate on the held-out future and set the action thresholds.

  verify threshold = score where 1% of legit payments would get a step-up check
  hold threshold   = score where 0.1% of legit payments would wait for an analyst

Writes artifacts/policy.yaml (read by the scorer) and artifacts/metrics.json (shown in the app).

Usage: python ml/src/evaluate.py
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from datetime import UTC, datetime

import lightgbm as lgb
import numpy as np
import pandas as pd
import yaml
from common import (
    FEATURES_PARQUET,
    META_JSON,
    METRICS_JSON,
    MODEL_TXT,
    POLICY_YAML,
    recall_at_fpr,
    time_split,
    write_json,
)
from sklearn.metrics import average_precision_score, roc_auc_score

from scorer.features import FEATURES
from scorer.policy import Policy
from scorer.reasons import explain

VERIFY_FPR = 0.01
HOLD_FPR = 0.001


def main() -> None:
    df = pd.read_parquet(FEATURES_PARQUET)
    _, _, test = time_split(df)
    booster = lgb.Booster(model_file=str(MODEL_TXT))
    y = test.is_fraud.to_numpy()
    scores = booster.predict(test[FEATURES])

    recall_1, verify_t = recall_at_fpr(y, scores, VERIFY_FPR)
    recall_01, hold_t = recall_at_fpr(y, scores, HOLD_FPR)
    hold_t = max(hold_t, verify_t)

    digest = hashlib.sha256(MODEL_TXT.read_bytes()).hexdigest()[:8]
    version = f"lgbm-{datetime.now(UTC):%Y%m%d}-{digest}"
    policy = Policy(version, round(verify_t, 6), round(hold_t, 6))
    POLICY_YAML.write_text(
        yaml.safe_dump(
            {
                "model_version": version,
                "verify_threshold": policy.verify_threshold,
                "hold_threshold": policy.hold_threshold,
            },
            sort_keys=False,
        )
    )

    actions = np.array([policy.decide(s) for s in scores])
    by_action = {
        label: {a: int(((actions == a) & (y == v)).sum()) for a in ("allow", "verify", "hold")}
        for label, v in (("fraud", 1), ("legit", 0))
    }
    fraud_amount = test.amount[y == 1].sum()
    stopped_amount = test.amount[(y == 1) & (actions != "allow")].sum()

    # What reasons do analysts actually see on flagged scams?
    flagged = test[(actions != "allow") & (y == 1)]
    contribs = booster.predict(flagged[FEATURES], pred_contrib=True)[:, :-1] if len(flagged) else []
    reason_counts: Counter[str] = Counter()
    for row, c in zip(flagged[FEATURES].to_dict("records"), contribs, strict=True):
        reason_counts.update(r["code"] for r in explain(row, c))

    gain = booster.feature_importance("gain")
    metrics = {
        "model_version": version,
        "trained_at": datetime.now(UTC).isoformat(),
        "dataset": json.loads(META_JSON.read_text())["source"],
        "test_rows": int(len(test)),
        "test_fraud": int(y.sum()),
        "pr_auc": round(float(average_precision_score(y, scores)), 4),
        "roc_auc": round(float(roc_auc_score(y, scores)), 4),
        "recall_at_1pct_fpr": round(recall_1, 4),
        "recall_at_0_1pct_fpr": round(recall_01, 4),
        "verify_threshold": policy.verify_threshold,
        "hold_threshold": policy.hold_threshold,
        "actions": by_action,
        "fraud_amount_intercepted_pct": round(float(stopped_amount / fraud_amount), 4) if fraud_amount else 0.0,
        "reason_codes_on_flagged_fraud": dict(reason_counts.most_common()),
        "feature_importance_gain": {
            f: round(float(g), 1) for f, g in sorted(zip(FEATURES, gain, strict=True), key=lambda x: -x[1])
        },
    }
    write_json(METRICS_JSON, metrics)

    print(f"model {version}")
    print(f"  PR-AUC {metrics['pr_auc']}  ROC-AUC {metrics['roc_auc']}")
    print(f"  recall @ 1% FPR   {recall_1:.1%}  (verify >= {policy.verify_threshold:.4f})")
    print(f"  recall @ 0.1% FPR {recall_01:.1%}  (hold   >= {policy.hold_threshold:.4f})")
    print(f"  scam money intercepted (verify+hold): {metrics['fraud_amount_intercepted_pct']:.1%}")
    print(f"  actions: {by_action}")


if __name__ == "__main__":
    main()
