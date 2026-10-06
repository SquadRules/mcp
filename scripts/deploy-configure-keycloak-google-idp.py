#!/usr/bin/env python3
"""
Create or update the Google Identity Provider in a Keycloak realm (e.g. squadrules).

Reads KEYCLOAK_URL, KEYCLOAK_ADMIN_PASSWORD, KEYCLOAK_REALM, GOOGLE_CLIENT_ID,
GOOGLE_CLIENT_SECRET from .env (same pattern as deploy-configure-keycloak-realms.py).
Keycloak must be running. Idempotent: if the Google IdP already exists, it is updated.

Usage:
  python3 scripts/deploy-configure-keycloak-google-idp.py
  KEYCLOAK_URL=http://keycloak:8080 python3 scripts/deploy-configure-keycloak-google-idp.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

GOOGLE_IDP_ALIAS = "google"
GOOGLE_PROVIDER_ID = "google"


def load_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            k, _, v = line.partition("=")
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def get_env(root: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    env.update(load_env_file(root / ".env"))
    for k, v in os.environ.items():
        if v is not None:
            env[k] = v
    return env


def get_admin_token(base_url: str, admin_password: str) -> str:
    url = f"{base_url.rstrip('/')}/realms/master/protocol/openid-connect/token"
    data = urllib.parse.urlencode({
        "grant_type": "password",
        "client_id": "admin-cli",
        "username": "admin",
        "password": admin_password,
    }).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"Admin token failed: {e.code} {body}")
    token = body.get("access_token")
    if not token:
        sys.exit("No access_token in token response")
    return token


def list_identity_providers(base_url: str, realm: str, token: str) -> list[dict]:
    url = f"{base_url.rstrip('/')}/admin/realms/{realm}/identity-provider/instances"
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"List identity providers failed: {e.code} {body}")


def create_identity_provider(
    base_url: str, realm: str, payload: dict, token: str
) -> None:
    url = f"{base_url.rstrip('/')}/admin/realms/{realm}/identity-provider/instances"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    try:
        urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"Create identity provider failed: {e.code} {body}")


def update_identity_provider(
    base_url: str, realm: str, alias: str, payload: dict, token: str
) -> None:
    url = f"{base_url.rstrip('/')}/admin/realms/{realm}/identity-provider/instances/{alias}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="PUT")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    try:
        urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"Update identity provider failed: {e.code} {body}")


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    env = get_env(root)

    base_url = env.get("KEYCLOAK_URL", "http://localhost:8080").strip()
    admin_password = env.get("KEYCLOAK_ADMIN_PASSWORD", "").strip()
    realm = env.get("KEYCLOAK_REALM", "squadrules-dev").strip()
    client_id = env.get("GOOGLE_CLIENT_ID", "").strip()
    client_secret = env.get("GOOGLE_CLIENT_SECRET", "").strip()

    if not admin_password:
        sys.exit("KEYCLOAK_ADMIN_PASSWORD is required. Set it in .env.")
    if not client_id or not client_secret:
        sys.exit(
            "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required for this script. "
            "Set them in .env. See docs/keycloak/google-auth-dev.md."
        )

    token = get_admin_token(base_url, admin_password)
    idps = list_identity_providers(base_url, realm, token)
    existing = next((i for i in idps if (i.get("alias") or "").lower() == GOOGLE_IDP_ALIAS), None)

    # IdentityProviderRepresentation: alias, providerId, enabled, config (clientId, clientSecret)
    payload = {
        "alias": GOOGLE_IDP_ALIAS,
        "providerId": GOOGLE_PROVIDER_ID,
        "enabled": True,
        "config": {
            "clientId": client_id,
            "clientSecret": client_secret,
        },
    }

    if existing:
        # PUT requires the same structure; preserve internalId if we have it
        if existing.get("internalId"):
            payload["internalId"] = existing["internalId"]
        update_identity_provider(base_url, realm, GOOGLE_IDP_ALIAS, payload, token)
        print(f"Updated Google Identity Provider in realm {realm}.")
    else:
        create_identity_provider(base_url, realm, payload, token)
        print(f"Created Google Identity Provider in realm {realm}.")


if __name__ == "__main__":
    main()
