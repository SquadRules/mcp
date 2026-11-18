#!/usr/bin/env python3
"""
Generate .env from fullstack template. Template uses __VAR_NAME__ placeholders
for secrets (env var or generated).

Source: scripts/env/.env.template (fullstack: infra + app + auth).

Usage:
  python scripts/deploy-generate-dev-secrets.py              # generate .env from template
  python scripts/deploy-generate-dev-secrets.py --verify      # only validate existing .env
  OPENAI_API_KEY=xxx python scripts/deploy-generate-dev-secrets.py
"""
from __future__ import annotations

import argparse
import os
import re
import secrets
import sys
from pathlib import Path


def root_dir() -> Path:
    return Path(__file__).resolve().parent.parent


REQUIRED_SECRET_KEYS = [
    "KEYCLOAK_ADMIN_PASSWORD",
    "KEYCLOAK_DB_PASSWORD",
    "REDIS_PASSWORD",
    "QDRANT_API_KEY",
    "SESSION_SECRET",
]
# The application defaults to embedded fastembed when no external provider is configured.
# Keep the optional key in substitution so a configured OpenAI deployment still works.
OPTIONAL_SECRET_KEYS = ["OPENAI_API_KEY"]
SECRET_KEYS = REQUIRED_SECRET_KEYS + OPTIONAL_SECRET_KEYS

KV_URL_KEYS = ("KEY_VALUE_STORE_URL", "REDIS_URL")

# Dev defaults applied when generating .env (merged after template; template can override).
DEV_DEFAULTS = {
    "MAX_CONCURRENT_MCP_REQUESTS": "10000",
}

PLACEHOLDER_RE = re.compile(r"^__([A-Za-z_][A-Za-z0-9_]*)__$")
PLACEHOLDER_INLINE_RE = re.compile(r"__([A-Za-z_][A-Za-z0-9_]*)__")


def is_placeholder(value: str) -> bool:
    return bool(value and PLACEHOLDER_RE.match(value.strip()))


def parse_env_file(path: Path) -> dict[str, str]:
    """Parse KEY=value lines; skip comments and empty. Returns dict key -> value."""
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line)
        if m:
            out[m.group(1)] = m.group(2)
    return out


def read_env_lines(path: Path) -> list[str]:
    """Read file as lines (preserve order and comments)."""
    if not path.exists():
        return []
    return path.read_text().splitlines()


def write_env_file(path: Path, data: dict[str, str], key_order: list[str] | None = None) -> None:
    """Write KEY=value file. If key_order given, output in that order; else sorted."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if key_order:
        items = [(k, data[k]) for k in key_order if k in data]
        for k in sorted(data):
            if k not in {x[0] for x in items}:
                items.append((k, data[k]))
    else:
        items = sorted(data.items())
    lines = [f"{k}={v}" for k, v in items]
    path.write_text("\n".join(lines) + "\n")


def resolve_secrets(keys: list[str], existing: dict[str, str], force: bool) -> dict[str, str]:
    """For each key, return env or existing or generated secret."""
    resolved: dict[str, str] = {}
    for key in keys:
        val = os.environ.get(key) or existing.get(key)
        if val and not force:
            resolved[key] = val
        else:
            if key == "REDIS_PASSWORD":
                resolved[key] = secrets.token_urlsafe(24)
            elif key in ("KEYCLOAK_ADMIN_PASSWORD", "KEYCLOAK_DB_PASSWORD"):
                resolved[key] = secrets.token_urlsafe(24)
            elif key == "QDRANT_API_KEY":
                resolved[key] = secrets.token_urlsafe(24)
            elif key == "SESSION_SECRET":
                resolved[key] = os.environ.get(key) or secrets.token_hex(32)
            elif key == "OPENAI_API_KEY":
                resolved[key] = os.environ.get(key) or ""
            else:
                resolved[key] = os.environ.get(key) or ""
    return resolved


def replace_placeholders(data: dict[str, str], secrets_map: dict[str, str]) -> dict[str, str]:
    """Replace any value __KEY__ with actual value from secrets or env."""
    out: dict[str, str] = {}
    for k, v in data.items():
        v = (v or "").strip()
        if is_placeholder(v):
            var_name = PLACEHOLDER_RE.match(v).group(1)
            out[k] = secrets_map.get(var_name) or os.environ.get(var_name) or ""
        else:
            out[k] = PLACEHOLDER_INLINE_RE.sub(
                lambda match: secrets_map.get(match.group(1)) or os.environ.get(match.group(1)) or "",
                v
            )
    return out


def missing_required(data: dict[str, str]) -> list[str]:
    """Validate infrastructure credentials; OpenAI is optional with auto/fastembed."""
    required = REQUIRED_SECRET_KEYS + ["QDRANT_URL", "QDRANT_COLLECTION"]
    missing = [k for k in required if not (data.get(k) or "").strip()]
    if not any((data.get(k) or "").strip() for k in KV_URL_KEYS):
        missing.append("KEY_VALUE_STORE_URL|REDIS_URL")
    if (data.get("EMBEDDING_PROVIDER") or "").strip().lower() == "openai":
        if not (data.get("OPENAI_API_KEY") or "").strip() and not (data.get("OPENAI_API_URL") or "").strip():
            missing.append("OPENAI_API_KEY|OPENAI_API_URL")
    return missing


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate .env from fullstack template.")
    ap.add_argument("--verify", action="store_true", help="Only validate existing .env")
    ap.add_argument("--force", action="store_true", help="Regenerate secrets even if present")
    args = ap.parse_args()

    root = root_dir()
    env_file = root / ".env"
    env_dir = root / "scripts" / "env"
    env_tpl = env_dir / ".env.template"

    if args.verify:
        if not env_file.exists():
            raise SystemExit(".env: file not found")
        data = parse_env_file(env_file)
        missing = missing_required(data)
        if missing:
            raise SystemExit(f".env: missing or empty: {', '.join(missing)}")
        print("Verify OK: .env has required keys.")
        return

    if not env_tpl.exists():
        raise SystemExit("Need scripts/env/.env.template (fullstack) to generate .env")

    existing = parse_env_file(env_file)
    secrets_map = resolve_secrets(SECRET_KEYS, existing, args.force)
    data = parse_env_file(env_tpl)
    data = replace_placeholders(data, secrets_map)
    for k, v in DEV_DEFAULTS.items():
        if k not in data or not (data.get(k) or "").strip():
            data[k] = v
    for k in SECRET_KEYS:
        if k not in data or not (data.get(k) or "").strip():
            data[k] = secrets_map.get(k, "")

    key_order = [line.strip().split("=")[0] for line in read_env_lines(env_tpl) if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", line.strip())]
    write_env_file(env_file, data, key_order=key_order if key_order else None)
    print("Wrote .env (fullstack: infra + app + auth).")

    data = parse_env_file(env_file)
    missing = missing_required(data)
    if missing:
        raise SystemExit(f".env: missing or empty after write: {', '.join(missing)}")

    print("Done. Use: docker compose --env-file .env --profile infra up -d")


if __name__ == "__main__":
    main()
    sys.exit(0)
