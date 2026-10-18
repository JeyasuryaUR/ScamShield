"""Load test the scorer: p50/p95/p99 latency and sustained throughput.

Reports two latencies:
  - client round trip (network + HTTP + scoring), measured here
  - in-service scoring time (features + model + reasons + policy), from the scorer's /stats

Usage:
  python tools/loadtest/loadtest.py --rate 200                      # p99 at 200 tx/s offered load
  python tools/loadtest/loadtest.py --concurrency 32                 # max throughput
  python tools/loadtest/loadtest.py --url http://<linuxone-ip>:8000 --label linuxone --rate 200
Results are saved to tools/loadtest/results/<label>-<timestamp>.json
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import os
import platform
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

import httpx
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
REPLAY_CSV = ROOT / "ml" / "data" / "processed" / "replay.csv"
RESULTS = Path(__file__).resolve().parent / "results"


def load_bodies(n: int) -> list[dict]:
    bodies = []
    with REPLAY_CSV.open() as f:
        for r in csv.DictReader(f):
            bodies.append(
                {
                    "account_id": r["account_id"],
                    "payee_id": r["payee_id"],
                    "type": r["type"],
                    "ts": r["ts"],
                    "amount": float(r["amount"]),
                    "old_balance": float(r["old_balance"]),
                    # don't let the load test rewrite account history the replayer relies on
                    "update_history": False,
                }
            )
            if len(bodies) >= n:
                break
    return bodies


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--url", default=os.getenv("SCORER_URL", "http://127.0.0.1:8000"))
    p.add_argument("--requests", type=int, default=20_000)
    p.add_argument("--concurrency", type=int, default=32)
    p.add_argument("--warmup", type=int, default=500)
    p.add_argument("--rate", type=float, default=None, help="open-loop: offered load in tx/s")
    p.add_argument("--label", default=platform.node() or "local")
    a = p.parse_args()

    bodies = load_bodies(a.requests)
    headers = {"x-api-key": k} if (k := os.getenv("SCORER_API_KEY")) else {}
    limits = httpx.Limits(max_connections=a.concurrency, max_keepalive_connections=a.concurrency)
    latencies: list[float] = []
    errors = 0
    run = uuid.uuid4().hex[:8]

    async with httpx.AsyncClient(base_url=a.url, headers=headers, timeout=10, limits=limits) as client:
        health = (await client.get("/health")).json()

        async def worker(items: list[tuple[int, dict]], record: bool) -> None:
            nonlocal errors
            for i, body in items:
                t = time.perf_counter()
                try:
                    r = await client.post("/score", json={**body, "txn_id": f"LT-{run}-{i}"})
                    r.raise_for_status()
                except httpx.HTTPError:
                    errors += 1
                    continue
                if record:
                    latencies.append((time.perf_counter() - t) * 1000)

        warm = list(enumerate(bodies[: a.warmup]))
        await asyncio.gather(*(worker(warm[w :: a.concurrency], False) for w in range(a.concurrency)))

        items = [(i + a.warmup, b) for i, b in enumerate(bodies)]
        t0 = time.perf_counter()
        if a.rate:
            # Open loop: requests arrive on a fixed schedule like real traffic, so the
            # latency shown is what a payment sees at that load (not queueing we created).
            async def one(item: tuple[int, dict]) -> None:
                await worker([item], True)

            tasks = []
            for n, item in enumerate(items):
                delay = t0 + n / a.rate - time.perf_counter()
                if delay > 0:
                    await asyncio.sleep(delay)
                tasks.append(asyncio.create_task(one(item)))
            await asyncio.gather(*tasks)
        else:
            # Closed loop: N workers back to back, which finds the maximum throughput.
            await asyncio.gather(*(worker(items[w :: a.concurrency], True) for w in range(a.concurrency)))
        elapsed = time.perf_counter() - t0
        server = (await client.get("/stats")).json()

    lat = np.array(latencies)
    result = {
        "label": a.label,
        "url": a.url,
        "at": datetime.now(UTC).isoformat(),
        "machine": f"{platform.system()} {platform.machine()}",
        "model_version": health["model_version"],
        "requests": len(lat),
        "errors": errors,
        "mode": f"open loop at {a.rate} tx/s" if a.rate else f"closed loop, concurrency {a.concurrency}",
        "throughput_tps": round(len(lat) / elapsed, 1),
        "client_ms": {k: round(float(np.percentile(lat, q)), 3) for k, q in (("p50", 50), ("p95", 95), ("p99", 99))},
        "server_scoring_ms": {k: server[f"{k}_ms"] for k in ("p50", "p95", "p99")},
    }
    RESULTS.mkdir(exist_ok=True)
    out = RESULTS / f"{a.label}-{datetime.now():%Y%m%d-%H%M%S}.json"
    out.write_text(json.dumps(result, indent=2))

    print(f"\n{result['requests']:,} requests, {errors} errors, {result['mode']}, on {result['machine']}")
    print(f"throughput      {result['throughput_tps']:,} tx/s")
    print(
        f"round trip      p50 {result['client_ms']['p50']} ms   p95 {result['client_ms']['p95']} ms   "
        f"p99 {result['client_ms']['p99']} ms"
    )
    print(f"scoring only    p50 {server['p50_ms']} ms   p95 {server['p95_ms']} ms   p99 {server['p99_ms']} ms")
    print(f"-> {out}")


if __name__ == "__main__":
    asyncio.run(main())
