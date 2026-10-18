"""Publish the trained model's metrics, policy and audit results to Supabase,
and upload the model files to the private `models` Storage bucket.

Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (or a .env file at the repo root).

Usage: python ml/src/publish.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx
import yaml
from common import ARTIFACTS, AUDIT_JSON, METRICS_JSON, MODEL_TXT, POLICY_YAML, STATE_SNAPSHOT

ROOT = Path(__file__).resolve().parents[2]


def load_env() -> tuple[str, str]:
    env_file = ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())
    url, key = os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or repo-root .env)")
    return url.rstrip("/"), key


def main() -> None:
    url, key = load_env()
    auth = {"apikey": key, "Authorization": f"Bearer {key}"}
    metrics = json.loads(METRICS_JSON.read_text())
    policy = yaml.safe_load(POLICY_YAML.read_text())
    version = metrics["model_version"]

    with httpx.Client(timeout=60, headers=auth) as c:
        r = c.post(
            f"{url}/rest/v1/model_versions",
            headers={"Prefer": "resolution=merge-duplicates"},
            json={"version": version, "metrics": metrics, "policy": policy},
        )
        r.raise_for_status()
        print(f"model_versions <- {version}")

        for mode, path in (("planted", AUDIT_JSON), ("ieee", AUDIT_JSON.with_name("shortcut_audit_ieee.json"))):
            if path.exists():
                r = c.post(
                    f"{url}/rest/v1/shortcut_audits",
                    json={"model_version": version, "mode": mode, "result": json.loads(path.read_text())},
                )
                r.raise_for_status()
                print(f"shortcut_audits <- {mode}")

        r = c.post(f"{url}/storage/v1/bucket", json={"id": "models", "name": "models", "public": False})
        if r.status_code not in (200, 400, 409):  # 400/409: bucket already exists
            r.raise_for_status()
        for f in (MODEL_TXT, POLICY_YAML, METRICS_JSON, STATE_SNAPSHOT):
            if f.exists():
                r = c.post(
                    f"{url}/storage/v1/object/models/{version}/{f.name}",
                    headers={"x-upsert": "true", "content-type": "application/octet-stream"},
                    content=f.read_bytes(),
                )
                r.raise_for_status()
                print(f"storage models/{version}/{f.name}")

    print(f"published {version} from {ARTIFACTS}")


if __name__ == "__main__":
    main()
