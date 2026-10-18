"""Create (or re-role) a staff account. Public sign-up stays off; staff are added here or
invited from the Supabase dashboard.

Usage:
  python tools/admin/create_user.py --email ana@inat.dev --password '...' --name "Ana" --role analyst
Roles: analyst (reviews holds), compliance (read-only + audit log), admin.
Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or repo-root .env).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import httpx

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
    p = argparse.ArgumentParser()
    p.add_argument("--email", required=True)
    p.add_argument("--password", required=True)
    p.add_argument("--name", default=None)
    p.add_argument("--role", choices=["analyst", "compliance", "admin"], default="analyst")
    a = p.parse_args()

    url, key = load_env()
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    with httpx.Client(timeout=20, headers=headers) as c:
        r = c.post(
            f"{url}/auth/v1/admin/users",
            json={
                "email": a.email,
                "password": a.password,
                "email_confirm": True,
                "user_metadata": {"full_name": a.name or a.email.split("@")[0]},
            },
        )
        if r.status_code == 422 and "already" in r.text:
            users = c.get(f"{url}/auth/v1/admin/users", params={"per_page": 1000}).json()["users"]
            user_id = next(u["id"] for u in users if u["email"] == a.email.lower())
            print(f"{a.email} exists; updating role")
        else:
            r.raise_for_status()
            user_id = r.json()["id"]
            print(f"created {a.email}")

        r = c.patch(f"{url}/rest/v1/profiles", params={"id": f"eq.{user_id}"}, json={"role": a.role})
        r.raise_for_status()
        print(f"role = {a.role}")


if __name__ == "__main__":
    main()
