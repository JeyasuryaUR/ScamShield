from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

_REPO_ARTIFACTS = Path(__file__).resolve().parents[3] / "ml" / "artifacts"


@dataclass(frozen=True)
class Settings:
    artifact_dir: Path
    api_key: str | None
    supabase_url: str | None
    supabase_service_key: str | None
    sink_mode: str  # all | flagged | off
    demo_seed: bool

    @staticmethod
    def from_env() -> Settings:
        url = os.getenv("SUPABASE_URL") or None
        return Settings(
            artifact_dir=Path(os.getenv("ARTIFACT_DIR", str(_REPO_ARTIFACTS))),
            api_key=os.getenv("SCORER_API_KEY") or None,
            supabase_url=url,
            supabase_service_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY") or None,
            sink_mode=os.getenv("SINK_MODE", "all" if url else "off"),
            demo_seed=os.getenv("DEMO_SEED", "1") == "1",
        )
