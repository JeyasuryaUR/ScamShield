"""Run the whole offline pipeline: data -> features -> train -> evaluate -> shortcut audit.

Usage:
  python ml/src/pipeline.py                     # real PaySim if present in ml/data/raw, else synthetic
  python ml/src/pipeline.py --source synthetic
  python ml/src/pipeline.py --skip-audit        # faster iteration on the model
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

from common import RAW

SRC = Path(__file__).resolve().parent


def run(script: str, *args: str) -> None:
    print(f"\n=== {script} {' '.join(args)}", flush=True)
    t = time.time()
    subprocess.run([sys.executable, str(SRC / script), *args], check=True)
    print(f"=== {script} done in {time.time() - t:.0f}s", flush=True)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--source", choices=["auto", "paysim", "synthetic"], default="auto")
    p.add_argument("--max-rows", type=int, default=None)
    p.add_argument("--skip-audit", action="store_true")
    p.add_argument("--ieee", action="store_true", help="also run the IEEE-CIS audit (needs Kaggle files)")
    a = p.parse_args()

    has_paysim = any(RAW.glob("PS_*.csv")) or any(RAW.glob("paysim*.csv"))
    if a.source == "synthetic" or (a.source == "auto" and not has_paysim):
        if not (RAW / "synthetic_paysim.csv").exists():
            run("make_synthetic.py")
    prep_args = ["--source", a.source] + (["--max-rows", str(a.max_rows)] if a.max_rows else [])
    run("prep_paysim.py", *prep_args)
    run("train.py")
    run("evaluate.py")
    if not a.skip_audit:
        run("plant_shortcuts.py")
        run("shortcut_audit.py")
    if a.ieee:
        run("prep_ieee.py")
        run("shortcut_audit.py", "--dataset", "ieee")
    print("\nDone. Next: python ml/src/publish.py  (uploads metrics + audit to Supabase)")


if __name__ == "__main__":
    main()
