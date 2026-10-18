from datetime import UTC, datetime


def payload(txn_id="t1", **over):
    body = {
        "txn_id": txn_id,
        "account_id": "C-TEST",
        "payee_id": "C-NEW",
        "amount": 48_500,
        "type": "TRANSFER",
        "ts": datetime(2026, 10, 20, 18, 12, tzinfo=UTC).isoformat(),
        "old_balance": 52_000,
    }
    body.update(over)
    return body


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["model_version"] == "test"


def test_score_returns_decision_with_reasons(client):
    r = client.post("/score", json=payload())
    assert r.status_code == 200
    body = r.json()
    assert 0 <= body["risk"] <= 1
    assert body["action"] in {"allow", "verify", "hold"}
    assert body["latency_ms"] > 0
    assert all({"code", "weight"} <= set(x) for x in body["reasons"])


def test_score_is_idempotent_per_txn_id(client):
    first = client.post("/score", json=payload("dup")).json()
    again = client.post("/score", json=payload("dup")).json()
    assert first == again


def test_preview_scoring_leaves_history_untouched(client):
    body = payload("p1", account_id="C-PREVIEW", update_history=False)
    first = client.post("/score", json=body).json()
    again = client.post("/score", json={**body, "txn_id": "p2"}).json()
    assert first["risk"] == again["risk"] and first["reasons"] == again["reasons"]


def test_validation_rejects_bad_input(client):
    assert client.post("/score", json=payload(amount=-5)).status_code == 422
    assert client.post("/score", json=payload(type="BITCOIN")).status_code == 422


def test_stats_and_metrics(client):
    client.post("/score", json=payload("s1"))
    stats = client.get("/stats").json()
    assert stats["count"] >= 1 and stats["p99_ms"] >= stats["p50_ms"]
    assert "scorer_latency_seconds" in client.get("/metrics").text
