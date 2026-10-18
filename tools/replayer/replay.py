"""Replay the held-out PaySim period into the scorer as a live payment stream.

Rows are sent in time order at a fixed rate, so the scorer's account history evolves
exactly as it did in evaluation. Labels are never sent; they're only used here to
print how many scams were caught.

Usage:
  python tools/replayer/replay.py                      # 25 tx/s against localhost
  python tools/replayer/replay.py --tps 200 --limit 20000 --url http://<linuxone-ip>:8000
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import os
import time
from collections import Counter
from pathlib import Path

import httpx

REPLAY_CSV = Path(__file__).resolve().parents[2] / "ml" / "data" / "processed" / "replay.csv"


def rows(path: Path, start: int, limit: int | None):
    with path.open() as f:
        for i, r in enumerate(csv.DictReader(f)):
            if i < start:
                continue
            if limit is not None and i >= start + limit:
                return
            yield r


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--url", default=os.getenv("SCORER_URL", "http://127.0.0.1:8000"))
    p.add_argument("--tps", type=float, default=25)
    p.add_argument("--start", type=int, default=0, help="skip the first N rows")
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--csv", type=Path, default=REPLAY_CSV)
    a = p.parse_args()

    if not a.csv.exists():
        raise SystemExit(f"{a.csv} not found: run the ml pipeline first (python ml/src/pipeline.py)")

    headers = {"x-api-key": k} if (k := os.getenv("SCORER_API_KEY")) else {}
    actions: Counter[str] = Counter()
    caught = missed = errors = 0
    sem = asyncio.Semaphore(32)
    t0 = time.perf_counter()

    async with httpx.AsyncClient(base_url=a.url, headers=headers, timeout=5) as client:
        await client.get("/health")

        async def send(r: dict) -> None:
            nonlocal caught, missed, errors
            body = {k: r[k] for k in ("txn_id", "account_id", "payee_id", "type", "ts")}
            body |= {"amount": float(r["amount"]), "old_balance": float(r["old_balance"])}
            async with sem:
                try:
                    res = await client.post("/score", json=body)
                    res.raise_for_status()
                except httpx.HTTPError:
                    errors += 1
                    return
            action = res.json()["action"]
            actions[action] += 1
            if r["is_fraud"] == "1":
                if action == "allow":
                    missed += 1
                else:
                    caught += 1

        tasks = []
        for i, r in enumerate(rows(a.csv, a.start, a.limit)):
            # pace by schedule, not by sleep-per-row, so the rate stays accurate
            delay = t0 + i / a.tps - time.perf_counter()
            if delay > 0:
                await asyncio.sleep(delay)
            tasks.append(asyncio.create_task(send(r)))
            if i and i % max(1, int(a.tps * 5)) == 0:
                elapsed = time.perf_counter() - t0
                print(
                    f"{i:>8,} sent  {i / elapsed:6.1f} tx/s  {dict(actions)}  scams caught {caught}, missed {missed}"
                    f"{f', errors {errors}' if errors else ''}",
                    flush=True,
                )
            if len(tasks) > 1000:
                tasks = [t for t in tasks if not t.done()]
        await asyncio.gather(*tasks)

    print(
        f"done: {sum(actions.values()):,} scored, {dict(actions)}, scams caught {caught}, missed {missed}, "
        f"errors {errors}"
    )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
