"""Scam Shield scorer: the only service on the payment's hot path.

POST /score -> features -> LightGBM (+ TreeSHAP) -> reason codes -> policy -> response.
Persistence happens afterwards in the background (see sink.py).
"""

from __future__ import annotations

import logging
import math
import time
from collections import OrderedDict, deque
from contextlib import asynccontextmanager

import numpy as np
from fastapi import Depends, FastAPI, Header, HTTPException, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest

from . import demo_seed
from .config import Settings
from .features import FeatureState, Txn
from .model import RiskModel
from .policy import Policy
from .reasons import explain
from .schemas import Health, LatencyStats, ScoreRequest, ScoreResponse
from .sink import SupabaseSink

log = logging.getLogger("scorer")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

SCORE_LATENCY = Histogram(
    "scorer_latency_seconds",
    "Time to score one payment (features + model + reasons + policy)",
    buckets=(0.0005, 0.001, 0.002, 0.003, 0.005, 0.0075, 0.01, 0.02, 0.05, 0.1),
)
DECISIONS = Counter("scorer_decisions_total", "Decisions by action", ["action"])

IDEMPOTENCY_CACHE = 50_000


class Engine:
    def __init__(self, settings: Settings) -> None:
        d = settings.artifact_dir
        self.model = RiskModel.load(d / "model.txt")
        self.policy = Policy.load(d / "policy.yaml")
        snapshot = d / "state_snapshot.pkl.gz"
        self.state = FeatureState.load(snapshot) if snapshot.exists() else FeatureState()
        if settings.demo_seed:
            demo_seed.seed(self.state)
        self.sink = SupabaseSink(settings.supabase_url, settings.supabase_service_key, settings.sink_mode)
        self.recent: OrderedDict[str, ScoreResponse] = OrderedDict()
        self.latencies: deque[float] = deque(maxlen=20_000)
        self.timestamps: deque[float] = deque(maxlen=200_000)

    def score(self, req: ScoreRequest) -> ScoreResponse:
        # Retries of the same payment must not double-count it in the account history.
        if (cached := self.recent.get(req.txn_id)) is not None:
            return cached

        t0 = time.perf_counter()
        txn = Txn(req.account_id, req.payee_id, req.amount, req.type, req.ts.timestamp(), req.old_balance)
        feats = self.state.features(txn)
        risk, contribs = self.model.score(self.state.vector(feats))
        action = self.policy.decide(risk)
        reasons = explain(feats, contribs)
        if req.update_history:
            self.state.update(txn)
        latency_ms = (time.perf_counter() - t0) * 1000

        resp = ScoreResponse(
            txn_id=req.txn_id,
            risk=round(risk, 5),
            action=action,
            reasons=reasons,
            model_version=self.policy.model_version,
            latency_ms=round(latency_ms, 3),
        )
        self._remember(resp, latency_ms)
        self.sink.enqueue(
            {
                "txn": req.model_dump(mode="json", exclude={"update_history"}),
                "decision": resp.model_dump(mode="json"),
                "features": {k: (None if math.isnan(v) else v) for k, v in feats.items()},
            }
        )
        return resp

    def _remember(self, resp: ScoreResponse, latency_ms: float) -> None:
        self.recent[resp.txn_id] = resp
        if len(self.recent) > IDEMPOTENCY_CACHE:
            self.recent.popitem(last=False)
        self.latencies.append(latency_ms)
        self.timestamps.append(time.time())
        SCORE_LATENCY.observe(latency_ms / 1000)
        DECISIONS.labels(resp.action).inc()

    def latency_stats(self) -> LatencyStats:
        if not self.latencies:
            return LatencyStats(count=0, p50_ms=0, p95_ms=0, p99_ms=0, max_ms=0, tps_1m=0)
        arr = np.fromiter(self.latencies, dtype=np.float64)
        p50, p95, p99 = np.percentile(arr, [50, 95, 99])
        cutoff = time.time() - 60
        last_minute = sum(1 for t in reversed(self.timestamps) if t >= cutoff)
        return LatencyStats(
            count=len(arr),
            p50_ms=round(float(p50), 3),
            p95_ms=round(float(p95), 3),
            p99_ms=round(float(p99), 3),
            max_ms=round(float(arr.max()), 3),
            tps_1m=round(last_minute / 60, 2),
        )


settings = Settings.from_env()
engine: Engine | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global engine
    engine = Engine(settings)
    log.info("loaded model %s, state %s", engine.policy.model_version, engine.state.stats())
    await engine.sink.start()
    yield
    await engine.sink.stop()


app = FastAPI(title="Scam Shield Scorer", version="1.0.0", lifespan=lifespan)


def get_engine() -> Engine:
    if engine is None:
        raise HTTPException(503, "model not loaded")
    return engine


def require_key(x_api_key: str | None = Header(default=None)) -> None:
    if settings.api_key and x_api_key != settings.api_key:
        raise HTTPException(401, "invalid API key")


@app.post("/score", response_model=ScoreResponse, dependencies=[Depends(require_key)])
async def score(req: ScoreRequest, eng: Engine = Depends(get_engine)) -> ScoreResponse:
    # async on purpose: scoring is ~1ms of CPU and running it on the event loop
    # keeps FeatureState updates strictly ordered without locks.
    return eng.score(req)


@app.get("/health", response_model=Health)
async def health(eng: Engine = Depends(get_engine)) -> Health:
    return Health(
        status="ok",
        model_version=eng.policy.model_version,
        verify_threshold=eng.policy.verify_threshold,
        hold_threshold=eng.policy.hold_threshold,
        **eng.state.stats(),
        sink=eng.sink.stats(),
    )


@app.get("/stats", response_model=LatencyStats)
async def stats(eng: Engine = Depends(get_engine)) -> LatencyStats:
    return eng.latency_stats()


@app.get("/metrics")
async def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
