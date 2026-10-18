"""Async, batched writes of decisions to Supabase.

Runs off the hot path: /score returns first, records are queued, and a background
task flushes them through the `ingest_decisions` Postgres function. If Supabase is
slow or down, payments keep getting scored; the queue is bounded and drops are counted.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

log = logging.getLogger("scorer.sink")

BATCH_SIZE = 200
FLUSH_INTERVAL_S = 0.5
QUEUE_MAX = 20_000


class SupabaseSink:
    def __init__(self, url: str | None, service_key: str | None, mode: str) -> None:
        self.mode = mode if (url and service_key) else "off"
        self._endpoint = f"{url.rstrip('/')}/rest/v1/rpc/ingest_decisions" if url else ""
        self._headers = {
            "apikey": service_key or "",
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        }
        self._queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=QUEUE_MAX)
        self._task: asyncio.Task | None = None
        self._client: httpx.AsyncClient | None = None
        self.written = 0
        self.dropped = 0
        self.failed_batches = 0

    def enqueue(self, record: dict) -> None:
        if self.mode == "off":
            return
        if self.mode == "flagged" and record["decision"]["action"] == "allow":
            return
        try:
            self._queue.put_nowait(record)
        except asyncio.QueueFull:
            self.dropped += 1

    async def start(self) -> None:
        if self.mode == "off":
            log.info("sink disabled (no SUPABASE_URL / key, or SINK_MODE=off)")
            return
        self._client = httpx.AsyncClient(timeout=10)
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            await self._flush(self._drain(QUEUE_MAX))
        if self._client:
            await self._client.aclose()

    def stats(self) -> dict:
        return {
            "mode": self.mode,
            "queued": self._queue.qsize(),
            "written": self.written,
            "dropped": self.dropped,
            "failed_batches": self.failed_batches,
        }

    def _drain(self, limit: int) -> list[dict]:
        batch = []
        while len(batch) < limit and not self._queue.empty():
            batch.append(self._queue.get_nowait())
        return batch

    async def _run(self) -> None:
        while True:
            first = await self._queue.get()
            await asyncio.sleep(FLUSH_INTERVAL_S)  # let a batch build up
            await self._flush([first, *self._drain(BATCH_SIZE - 1)])

    async def _flush(self, batch: list[dict]) -> None:
        if not batch or not self._client:
            return
        for attempt in range(3):
            try:
                r = await self._client.post(self._endpoint, headers=self._headers, json={"payload": batch})
                r.raise_for_status()
                self.written += len(batch)
                return
            except httpx.HTTPError as e:
                log.warning("sink flush failed (attempt %d): %s", attempt + 1, e)
                await asyncio.sleep(0.5 * 2**attempt)
        self.failed_batches += 1
        self.dropped += len(batch)
