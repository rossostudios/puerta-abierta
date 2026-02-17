#!/usr/bin/env python3
"""
Bootstrap a new Casaora database in Supabase:
- Apply db/schema.sql
- Insert a starter user + organization + membership
- Print the IDs to use in apps/admin/.env.local and apps/backend-rs/.env

Requires a Supabase Personal Access Token (PAT). See execute_sql.py for token sources.

Usage:
  python3 scripts/supabase/bootstrap.py --project-ref thzhbiojhdeifjqhhzli --email you@example.com --full-name "Your Name"
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import uuid


def _read_access_token(cli_token: str | None) -> str | None:
    if cli_token:
        return cli_token.strip()

    env_token = os.environ.get("SUPABASE_ACCESS_TOKEN")
    if env_token:
        return env_token.strip()

    codex_config = pathlib.Path.home() / ".codex" / "config.toml"
    if codex_config.exists():
        match = re.search(
            r"SUPABASE_ACCESS_TOKEN\s*=\s*'([^']+)'",
            codex_config.read_text(encoding="utf-8", errors="replace"),
        )
        if match:
            return match.group(1).strip()

    return None


def _post_sql(*, api_url: str, project_ref: str, token: str, query: str) -> None:
    url = f"{api_url.rstrip('/')}/v1/projects/{project_ref}/database/query"
    payload = json.dumps({"query": query, "read_only": False}).encode("utf-8")

    proc = subprocess.run(
        [
            "curl",
            "-sS",
            "-X",
            "POST",
            url,
            "-H",
            f"Authorization: Bearer {token}",
            "-H",
            "Content-Type: application/json",
            "-H",
            "Accept: application/json",
            "--data-binary",
            "@-",
        ],
        input=payload,
        capture_output=True,
        check=False,
    )

    if proc.returncode != 0:
        stderr = proc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(stderr or f"curl failed (exit {proc.returncode})")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-ref", required=True)
    parser.add_argument("--access-token", default=None)
    parser.add_argument("--api-url", default=os.environ.get("SUPABASE_API_URL", "https://api.supabase.com"))
    parser.add_argument("--schema-file", default="db/schema.sql")
    parser.add_argument("--email", required=True)
    parser.add_argument("--full-name", required=True)
    parser.add_argument("--org-name", default="Casaora (Default)")
    args = parser.parse_args()

    token = _read_access_token(args.access_token)
    if not token:
        print(
            "Missing Supabase access token. Provide --access-token or env SUPABASE_ACCESS_TOKEN.",
            file=sys.stderr,
        )
        return 2

    schema_path = pathlib.Path(args.schema_file)
    if not schema_path.exists():
        print(f"Schema file not found: {schema_path}", file=sys.stderr)
        return 2

    schema_sql = schema_path.read_text(encoding="utf-8", errors="replace").strip()
    if not schema_sql:
        print(f"Schema file is empty: {schema_path}", file=sys.stderr)
        return 2

    user_id = uuid.uuid4()
    org_id = uuid.uuid4()

    seed_sql = f"""
    INSERT INTO app_users (id, email, full_name)
    VALUES ('{user_id}', {json.dumps(args.email)}, {json.dumps(args.full_name)})
    ON CONFLICT (email) DO UPDATE
      SET full_name = EXCLUDED.full_name,
          is_active = true,
          updated_at = now();

    INSERT INTO organizations (id, name, owner_user_id)
    VALUES ('{org_id}', {json.dumps(args.org_name)}, '{user_id}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO organization_members (organization_id, user_id, role, is_primary)
    VALUES ('{org_id}', '{user_id}', 'owner_admin', true)
    ON CONFLICT (organization_id, user_id) DO UPDATE
      SET role = EXCLUDED.role,
          is_primary = EXCLUDED.is_primary,
          updated_at = now();
    """.strip()

    try:
        _post_sql(api_url=args.api_url, project_ref=args.project_ref, token=token, query=schema_sql)
        _post_sql(api_url=args.api_url, project_ref=args.project_ref, token=token, query=seed_sql)
    except FileNotFoundError:
        print("Missing dependency: curl", file=sys.stderr)
        return 2
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 1

    print("Bootstrap complete.")
    print(f"DEFAULT_ORG_ID={org_id}")
    print(f"DEFAULT_USER_ID={user_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
