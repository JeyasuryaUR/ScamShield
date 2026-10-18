"""Shortcut audit: is the model right for the right reasons?

For a model trained on *all* available columns, measure how much it actually relies
on each one, and flag every relied-on column that isn't a domain-approved fraud signal.

  1. Shuffle each column in the test set (permutation) -> drop in PR-AUC.
  2. Mask each column with its median/mode -> drop in PR-AUC.
  3. Noise floor: the audit adds its own random decoy columns. A column only counts as
     "relied on" if its drop beats the decoys (mean + 3 sd), so we don't flag noise.
  4. Repeat: strong shortcuts hide weaker ones, so flagged columns are removed, the model is
     retrained, and steps 1-3 run again until a pass flags nothing new.
  5. For each flagged column: retrain without it and report the accuracy drop.
  6. Retrain without *all* flagged columns and compare with an approved-features-only model:
     the closer they are, the less shortcut signal is left.

The planted manifest is only opened at the end, to score recovery.

Usage:
  python ml/src/shortcut_audit.py                 # planted-shortcut run on PaySim/synthetic
  python ml/src/shortcut_audit.py --dataset ieee  # real proxies in IEEE-CIS (after prep_ieee.py)
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import UTC, datetime

import numpy as np
import pandas as pd
from common import AUDIT_JSON, recall_at_fpr, time_split, write_json
from plant_shortcuts import CATEGORICAL_SHORTCUTS, MANIFEST_JSON, POISONED_PARQUET
from sklearn.metrics import average_precision_score
from train import fit

from scorer.features import CATEGORICAL, FEATURES

N_DECOYS = 4
N_REPEATS = 3
MAX_ROUNDS = 400  # audit models compare columns against each other; they don't need to be the best model
SAMPLE_NEGATIVES = 50_000  # shuffle tests use every fraud row + a fixed sample of legit rows


def _add_decoys(df: pd.DataFrame, rng) -> list[str]:
    n = len(df)
    decoys = {
        "_decoy_normal": rng.normal(size=n),
        "_decoy_uniform": rng.random(n),
        "_decoy_binary": (rng.random(n) < 0.3).astype(float),
        "_decoy_category": rng.integers(0, 12, n).astype(float),
    }
    for k, v in list(decoys.items())[:N_DECOYS]:
        df[k] = v
    return list(decoys)[:N_DECOYS]


def _mask_value(values: np.ndarray, categorical: bool) -> float:
    """Most common category / median value; NaN when the column is entirely missing."""
    present = values[~np.isnan(values)]
    if present.size == 0:
        return np.nan
    if categorical:
        uniq, counts = np.unique(present, return_counts=True)
        return float(uniq[np.argmax(counts)])
    return float(np.median(present))


def _evaluate(booster, test: pd.DataFrame, features: list[str]) -> tuple[float, float]:
    s = booster.predict(test[features])
    return float(average_precision_score(test.is_fraud, s)), recall_at_fpr(test.is_fraud, s, 0.01)[0]


def _reliance(booster, X: pd.DataFrame, y: np.ndarray, cats: list[str], decoys: list[str], rng):
    """Shuffle and mask each column; return per-column PR-AUC drops and the decoy noise floor."""
    X = X.copy()
    base = average_precision_score(y, booster.predict(X))
    rows = {}
    for f in X.columns:
        original = X[f].to_numpy().copy()
        drops = []
        for _ in range(N_REPEATS):
            X[f] = rng.permutation(original)
            drops.append(base - average_precision_score(y, booster.predict(X)))
        X[f] = _mask_value(original, categorical=f in cats)
        mask_drop = base - average_precision_score(y, booster.predict(X))
        X[f] = original
        rows[f] = {"perm_drop": float(np.mean(drops)), "perm_std": float(np.std(drops)), "mask_drop": float(mask_drop)}
    noise_floor = max(0.002, *(rows[d]["perm_drop"] + 3 * rows[d]["perm_std"] for d in decoys))
    noise_floor = max(noise_floor, *(rows[d]["mask_drop"] for d in decoys))
    for r in rows.values():
        r["relied_on"] = r["perm_drop"] > noise_floor or r["mask_drop"] > noise_floor
    return rows, noise_floor


def run_audit(
    df: pd.DataFrame,
    approved: list[str],
    candidates: list[str],
    categorical: list[str],
    seed: int = 0,
    max_passes: int = 4,
) -> dict:
    """Iterative: strong shortcuts mask weaker ones, so after each pass the flagged columns are
    removed, the model is retrained, and the audit runs again until nothing new is flagged."""
    rng = np.random.default_rng(seed)
    df = df.copy()
    decoys = _add_decoys(df, rng)
    train, valid, test = time_split(df)
    legit = test[test.is_fraud == 0]
    sample = pd.concat([test[test.is_fraud == 1], legit.sample(min(SAMPLE_NEGATIVES, len(legit)), random_state=seed)])
    y = sample.is_fraud.to_numpy()

    def cats_for(cols: list[str]) -> list[str]:
        return [c for c in categorical if c in cols] + ["_decoy_category"]

    t0 = time.time()
    features = approved + candidates + decoys
    booster = fit(train, valid, features, cats_for(features), MAX_ROUNDS)
    base_ap, base_recall = _evaluate(booster, test, features)
    print(f"  model on all {len(features)} columns: PR-AUC {base_ap:.3f}, recall@1%FPR {base_recall:.1%}")

    rows: dict[str, dict] = {}
    remaining, flagged, floors = list(candidates), [], []
    for pass_no in range(1, max_passes + 1):
        cols = approved + remaining + decoys
        if pass_no > 1:
            booster = fit(train, valid, cols, cats_for(cols), MAX_ROUNDS)
        found, floor = _reliance(booster, sample[cols], y, cats_for(cols), decoys, rng)
        floors.append(round(floor, 5))
        new = [f for f in remaining if found[f]["relied_on"]]
        for f, r in found.items():
            if f not in flagged:  # flagged columns keep the numbers from the pass that caught them
                rows[f] = {**r, "flagged": f in new, "pass": pass_no if f in new else None}
        print(f"  pass {pass_no}: noise floor {floor:.4f}, flagged {new or 'nothing new'} ({time.time() - t0:.0f}s)")
        if not new:
            break
        flagged += new
        remaining = [f for f in remaining if f not in new]

    for f in flagged:  # how much recall was each flagged column propping up?
        keep = [c for c in features if c != f]
        b = fit(train, valid, keep, cats_for(keep), MAX_ROUNDS)
        ap, rec = _evaluate(b, test, keep)
        rows[f]["retrain_ap_drop"] = round(base_ap - ap, 4)
        rows[f]["retrain_recall_drop"] = round(base_recall - rec, 4)

    def score(cols: list[str]) -> dict:
        b = fit(train, valid, cols, [c for c in categorical if c in cols], MAX_ROUNDS)
        ap, rec = _evaluate(b, test, cols)
        return {"pr_auc": round(ap, 4), "recall_at_1pct_fpr": round(rec, 4)}

    def kind(f: str) -> str:
        return "approved" if f in approved else "decoy" if f in decoys else "candidate"

    return {
        "noise_floor": floors[0],
        "noise_floors": floors,
        "passes": len(floors),
        "model_all_columns": {"pr_auc": round(base_ap, 4), "recall_at_1pct_fpr": round(base_recall, 4)},
        "model_without_flagged": score([c for c in approved + candidates if c not in flagged]),
        "clean_model": score(approved),
        "flagged": flagged,
        "decoys_flagged": [d for d in decoys if rows[d]["relied_on"]],
        "features": [
            {"name": f, "kind": kind(f), **{k: (round(v, 5) if isinstance(v, float) else v) for k, v in r.items()}}
            for f, r in sorted(rows.items(), key=lambda kv: -kv[1]["perm_drop"])
        ],
    }


def planted_run() -> dict:
    df = pd.read_parquet(POISONED_PARQUET)
    manifest = json.loads(MANIFEST_JSON.read_text())
    candidates = list(manifest)
    print(f"auditing model trained on {len(FEATURES)} approved + {len(candidates)} unreviewed columns")
    result = run_audit(df, FEATURES, candidates, CATEGORICAL + CATEGORICAL_SHORTCUTS)

    recovered = [f for f in result["flagged"] if f in manifest]
    for row in result["features"]:
        if row["name"] in manifest:
            row["kind"] = "planted"
            row["strength"] = manifest[row["name"]]["strength"]
            row["description"] = manifest[row["name"]]["description"]
    result.update(
        {
            "mode": "planted",
            "planted": len(manifest),
            "recovered": len(recovered),
            "recovery_rate": round(len(recovered) / len(manifest), 4),
            "missed": [f for f in manifest if f not in recovered],
            "false_alarms": [f for f in result["flagged"] if f not in manifest] + result["decoys_flagged"],
        }
    )
    return result


def ieee_run() -> dict:
    from prep_ieee import APPROVED, CANDIDATES, CATEGORICAL_IEEE, IEEE_PARQUET

    df = pd.read_parquet(IEEE_PARQUET)
    print(f"auditing IEEE-CIS: {len(APPROVED)} approved vs {len(CANDIDATES)} device/identity columns")
    result = run_audit(df, APPROVED, CANDIDATES, CATEGORICAL_IEEE)
    result["mode"] = "ieee"
    return result


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--dataset", choices=["planted", "ieee"], default="planted")
    a = p.parse_args()

    result = planted_run() if a.dataset == "planted" else ieee_run()
    result["ran_at"] = datetime.now(UTC).isoformat()
    out = AUDIT_JSON if a.dataset == "planted" else AUDIT_JSON.with_name("shortcut_audit_ieee.json")
    write_json(out, result)

    if a.dataset == "planted":
        print(
            f"\nrecovered {result['recovered']} / {result['planted']} planted shortcuts "
            f"({result['recovery_rate']:.0%}); missed: {result['missed'] or 'none'}; "
            f"false alarms: {result['false_alarms'] or 'none'}"
        )
        print(
            f"recall@1%FPR  all columns {result['model_all_columns']['recall_at_1pct_fpr']:.1%} -> "
            f"without flagged {result['model_without_flagged']['recall_at_1pct_fpr']:.1%} "
            f"(approved features only {result['clean_model']['recall_at_1pct_fpr']:.1%})"
        )
    print(f"-> {out}")


if __name__ == "__main__":
    main()
