#!/usr/bin/env python3
# squadrules-compat-surface: uses persisted Qdrant collection names (kairos / kairos_memories / kairos_ci / kairos_simple_ci); renaming would orphan existing vectors
"""
Idempotent Keycloak realm setup: apply config from scripts/keycloak/import via Admin API.

Configures sub-realms only (e.g. kairos-dev, kairos-prod). Uses master realm only to obtain
an admin token; does not modify master.
Single source of truth for realm config. Use when Keycloak is already running. Do not use
Keycloak startup --import-realm (would conflict with existing realms). Reads realm JSONs
from scripts/keycloak/import relative to repo root (works regardless of CWD).

1. Realms: create minimal if missing, then always merge and PUT config from import/*.json (idempotent).
   **kairos-mcp** `redirectUris` / `webOrigins` are then pushed again via **PUT …/clients/{id}**
   because realm-level PUT does not reliably update existing clients (redirect list would stay stale).
   **Groups:** realm PUT does not reliably create/re-parent groups. The script enforces
   top-level groups from import JSON, plus **shared** → **ci-test** (JWT path `/shared/ci-test`).
   If the import lists **kairos-shares**, it also nests **kairos-operator** under it via Admin API.
   Top-level groups present in Keycloak but not in the import are **removed** (prune) so the dump
   matches the JSON.
2. Trusted hosts: set env-specific IPs (dev: Docker gateway; prod: app-prod).
3. OIDC scope `openid` for dynamic registration: ensure a realm Client Scope named `openid`
   exists and is a **default** (not optional) client scope. Without `openid` in every token,
   Keycloak's Userinfo endpoint returns 403 "Missing openid scope", which breaks the
   Bearer-auth groups fallback in SQUADRULES (bearer-validate.ts → fetchGroupsFromOidcUserinfo).
   The scope is also linked to **kairos-mcp** and **kairos-cli** for backwards compatibility
   (named clients created before `openid` became a realm default don't inherit it automatically).
4. Allowed client scopes (policies): whitelist client-scope templates for anonymous/authenticated
   registration (includes `openid` and kairos-cli default templates).
4b. OIDC **Group Membership** protocol mapper on a shared **client scope** so JWTs include a
   `groups` claim (access + ID + userinfo + introspection). The scope is attached as a **default**
   client scope so new OAuth clients (including dynamically registered MCP hosts) inherit it, and
   it is linked to **kairos-mcp** and **kairos-cli** for backwards compatibility. Mapper
   **`full.path` is always enabled** (full Keycloak paths, e.g. `/kairos-auditor`,
   `/shared/team-platform`) — not configurable here so running systems stay consistent with SQUADRULES
   allowlists and space ids.
5. Test user: ensure TEST_USERNAME/TEST_PASSWORD exists in **kairos-dev** with profile fields and
   no required actions so **direct access grants** (password) do not return `invalid_grant` /
   **Account is not fully set up** (Keycloak 24+ expects first/last name; see keycloak#36108).
6. Verify realm dump matches import JSON.
7. Add test users to groups last; **GET** user groups to confirm (so Admin UI matches):
   **kairos-tester** → **kairos-auditor** and **ci-test**; if the import includes **kairos-shares**,
   also **kairos-operator**; optional **KAIROS_CI_TEST_USERNAME** (default **kairos-ci-tester**)
   → **ci-test** only.

Identity providers (e.g. Google) are not in realm JSON; configure via deploy-configure-keycloak-google-idp.py.

Env: KEYCLOAK_URL (default http://localhost:8080), KEYCLOAK_ADMIN_PASSWORD,
TEST_USERNAME (default kairos-tester), TEST_PASSWORD (default kairos-tester-secret),
KAIROS_CI_TEST_USERNAME / KAIROS_CI_TEST_PASSWORD (optional second dev user for `/shared/ci-test` only).
SQUADRULES app: set OIDC_GROUPS_ALLOWLIST (comma-separated; use a trailing `/` on an entry for path-prefix match)
to intersect JWT groups with what SQUADRULES stores.
If unset or empty, SQUADRULES keeps all JWT groups (no allowlist filtering).
(Keycloak's mapper still lists all memberships the user has in the realm).
AUTH_CALLBACK_BASE_URL (optional) — for **kairos-dev** **kairos-mcp**, adds that origin/callback
if not already covered by the port range (Keycloak has no native port-range wildcard).

KAIROS_DEV_APP_PORT_MIN / KAIROS_DEV_APP_PORT_MAX (optional, defaults 3300 / 3301) — inclusive range;
the script expands **kairos-mcp** `redirectUris` and `webOrigins` for `localhost` and `127.0.0.1`
per port (max span 256 ports). Import JSON lists 3300–3301 as documentation; applied config
comes from these env vars when you run this script.

Loaded from .env.

Usage:
  python scripts/deploy-configure-keycloak-realms.py
  KEYCLOAK_URL=http://keycloak:8080 python scripts/deploy-configure-keycloak-realms.py
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CLIENT_REGISTRATION_POLICY_TYPE = "org.keycloak.services.clientregistration.policy.ClientRegistrationPolicy"
TRUSTED_HOSTS_PROVIDER_ID = "trusted-hosts"
# UI label "Allowed Client Scopes"; providerId is allowed-client-templates (Keycloak Admin API).
ALLOWED_CLIENT_TEMPLATES_PROVIDER_ID = "allowed-client-templates"
# Realm client-scope names permitted for OIDC dynamic registration. `openid` must be a real
# Client Scope in the realm (ensure_openid_client_scope); OAuth scope "openid" maps to that name.
# Other entries align with default scopes on kairos-cli.
DYNAMIC_REGISTRATION_ALLOWED_CLIENT_SCOPES = [
    "openid",
    "basic",
    "acr",
    "web-origins",
    "profile",
    "roles",
    "email",
    "kairos-groups",
    "offline_access",
    "address",
    "phone",
    "service_account",
]
REALM_FILES = [
    ("kairos-dev", "kairos-dev-realm.json"),
    ("kairos-prod", "kairos-prod-realm.json"),
]

KAIROS_OIDC_GROUP_MAPPER_NAME = "kairos-oidc-groups"
KAIROS_OIDC_GROUP_MAPPER_PROVIDER = "oidc-group-membership-mapper"
KAIROS_GROUPS_CLIENT_SCOPE_NAME = "kairos-groups"
CLIENT_IDS_FOR_GROUP_MAPPER = frozenset({"kairos-mcp", "kairos-cli"})
# Scopes that named clients must be able to request but are not always included.
# Mirrors optionalClientScopes in helm/kairos-mcp/files/kairos-realm.json.
CLIENT_OPTIONAL_SCOPES = ("profile", "email", "offline_access")

# Keycloak has no redirect_uri port-range syntax; we emit one URI per port. Cap list growth.
_DEV_APP_PORT_RANGE_MAX_SPAN = 256


def _parse_port_env(env: dict, key: str, default: int) -> int:
    raw = (env.get(key) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw, 10)
    except ValueError:
        sys.exit(f"{key} must be an integer, got {raw!r}")
    if not 1 <= value <= 65535:
        sys.exit(f"{key} must be between 1 and 65535, got {value}")
    return value


def dev_app_port_bounds(env: dict) -> tuple[int, int]:
    """Inclusive bounds for dev app HTTP ports (localhost + 127.0.0.1)."""
    lo = _parse_port_env(env, "KAIROS_DEV_APP_PORT_MIN", 3300)
    hi = _parse_port_env(env, "KAIROS_DEV_APP_PORT_MAX", 3301)
    if lo > hi:
        lo, hi = hi, lo
    if hi - lo > _DEV_APP_PORT_RANGE_MAX_SPAN:
        sys.exit(
            f"KAIROS_DEV_APP_PORT span too large ({hi - lo} > {_DEV_APP_PORT_RANGE_MAX_SPAN}); "
            "narrow MIN/MAX or edit kairos-mcp in Keycloak Admin UI."
        )
    return lo, hi


def build_kairos_mcp_dev_redirect_lists(env: dict) -> tuple[list[str], list[str], str]:
    """
    Build redirectUris and webOrigins for kairos-mcp (dev) from port range + optional callback base.
    Also returns post.logout.redirect.uris (##-separated) for OIDC RP-initiated logout → continue-signin.
    """
    lo, hi = dev_app_port_bounds(env)
    redirect_uris: list[str] = []
    web_origins: list[str] = []
    post_logout: list[str] = []
    for port in range(lo, hi + 1):
        redirect_uris.extend(
            (
                f"http://localhost:{port}/auth/callback",
                f"http://127.0.0.1:{port}/auth/callback",
                f"http://localhost:{port}/auth/continue-signin",
                f"http://127.0.0.1:{port}/auth/continue-signin",
            )
        )
        post_logout.extend(
            (
                f"http://localhost:{port}/auth/continue-signin",
                f"http://127.0.0.1:{port}/auth/continue-signin",
            )
        )
        web_origins.extend((f"http://localhost:{port}", f"http://127.0.0.1:{port}"))

    base = (env.get("AUTH_CALLBACK_BASE_URL") or "").strip().rstrip("/")
    if base.startswith(("http://", "https://")):
        callback = f"{base}/auth/callback"
        if callback not in redirect_uris:
            redirect_uris.append(callback)
        resume = f"{base}/auth/continue-signin"
        if resume not in redirect_uris:
            redirect_uris.append(resume)
        if resume not in post_logout:
            post_logout.append(resume)
        if base not in web_origins:
            web_origins.append(base)

    post_logout_uris = "##".join(post_logout)
    return redirect_uris, web_origins, post_logout_uris


def apply_kairos_mcp_dev_client_urls(desired: dict, env: dict, realm_name: str) -> None:
    """
    Replace kairos-mcp redirectUris/webOrigins for kairos-dev with range-expanded lists.
    Verification uses the same helper so dump matches expected after apply.
    """
    if realm_name != "kairos-dev":
        return
    redirect_uris, web_origins, post_logout_uris = build_kairos_mcp_dev_redirect_lists(env)
    for client in desired.get("clients") or []:
        if client.get("clientId") != "kairos-mcp":
            continue
        client["redirectUris"] = redirect_uris
        client["webOrigins"] = web_origins
        attrs = dict(client.get("attributes") or {})
        attrs["post.logout.redirect.uris"] = post_logout_uris
        attrs["logout.confirmation.enabled"] = "false"
        client["attributes"] = attrs
        break


def load_desired_realm(path: Path, env: dict, realm_name: str) -> dict:
    desired = json.loads(path.read_text())
    apply_kairos_mcp_dev_client_urls(desired, env, realm_name)
    return desired


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
    for name in (".env",):
        env.update(load_env_file(root / name))
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


def list_realms(base_url: str, token: str) -> list[str]:
    url = f"{base_url.rstrip('/')}/admin/realms"
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            realms = json.loads(resp.read().decode())
            return [r["realm"] for r in realms]
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"List realms failed: {e.code} {body}")


def create_realm_minimal(base_url: str, token: str, realm_name: str) -> bool:
    """Create realm with Keycloak defaults so we can then apply our config via update (idempotent)."""
    url = f"{base_url.rstrip('/')}/admin/realms"
    payload = json.dumps({"realm": realm_name, "enabled": True}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    try:
        urllib.request.urlopen(req, timeout=15)
        return True
    except urllib.error.HTTPError as e:
        if e.code == 409:
            return False
        body = e.read().decode() if e.fp else ""
        sys.exit(f"Create realm {realm_name} failed: {e.code} {body}")
    return False


def get_realm_full(base_url: str, realm_name: str, token: str) -> dict:
    """GET full realm representation (for merge before PUT)."""
    url = f"{base_url.rstrip('/')}/admin/realms/{realm_name}"
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"GET realm {realm_name} failed: {e.code} {body}")


def update_realm(base_url: str, realm_name: str, realm_json: dict, token: str) -> None:
    """PUT realm to apply merged configuration (idempotent update)."""
    url = f"{base_url.rstrip('/')}/admin/realms/{realm_name}"
    payload = json.dumps(realm_json).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="PUT")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    try:
        urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"Update realm {realm_name} failed: {e.code} {body}")


def list_realm_client_ids(base_url: str, realm_name: str, token: str) -> set[str]:
    """GET realm clients and return set of clientId."""
    clients = get_realm_clients(base_url, realm_name, token)
    return {c.get("clientId") for c in clients if c.get("clientId")}


def get_realm_clients(base_url: str, realm_name: str, token: str) -> list[dict]:
    """GET full list of client representations (for dump/compare)."""
    url = f"{base_url.rstrip('/')}/admin/realms/{realm_name}/clients"
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"List clients {realm_name} failed: {e.code} {body}")


def push_kairos_mcp_redirect_config(
    base_url: str, realm_name: str, desired: dict, token: str
) -> None:
    """
    Apply kairos-mcp redirectUris and webOrigins from desired realm JSON via Clients Admin API.
    Keycloak often ignores client redirect list updates embedded in PUT /admin/realms/{realm}.
    """
    mcp_desired = next(
        (c for c in desired.get("clients") or [] if c.get("clientId") == "kairos-mcp"),
        None,
    )
    if not mcp_desired:
        return
    ru = mcp_desired.get("redirectUris")
    wo = mcp_desired.get("webOrigins")
    if ru is None and wo is None:
        return

    clients = get_realm_clients(base_url, realm_name, token)
    existing = next((c for c in clients if c.get("clientId") == "kairos-mcp"), None)
    if not existing or not existing.get("id"):
        print(f"  WARNING: kairos-mcp not found in {realm_name}; skip redirect push.", file=sys.stderr)
        return

    internal_id = existing["id"]
    patch = dict(existing)
    if ru is not None:
        patch["redirectUris"] = list(ru)
    if wo is not None:
        patch["webOrigins"] = list(wo)
    att = mcp_desired.get("attributes")
    if isinstance(att, dict) and att:
        merged = dict(patch.get("attributes") or {})
        merged.update(att)
        patch["attributes"] = merged

    url = f"{base_url.rstrip('/')}/admin/realms/{realm_name}/clients/{internal_id}"
    payload = json.dumps(patch).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="PUT")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    try:
        urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"PUT kairos-mcp client in {realm_name} failed: {e.code} {body}")

    n = len(patch.get("redirectUris") or [])
    print(f"  kairos-mcp redirect URIs set via Clients API ({realm_name}, {n} URIs).")


def create_realm_client(base_url: str, realm_name: str, client_payload: dict, token: str) -> None:
    """POST a client into the realm (Keycloak realm PUT does not create new clients)."""
    url = f"{base_url.rstrip('/')}/admin/realms/{realm_name}/clients"
    payload = json.dumps(client_payload).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    try:
        urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"Create client {client_payload.get('clientId', '?')} in {realm_name} failed: {e.code} {body}")


def get_client_internal_id_by_client_id(
    base_url: str, realm_name: str, client_id: str, token: str
) -> str | None:
    for c in get_realm_clients(base_url, realm_name, token):
        if c.get("clientId") == client_id:
            internal = c.get("id")
            if isinstance(internal, str) and internal:
                return internal
    return None


def list_client_protocol_mappers(
    base_url: str, realm_name: str, client_uuid: str, token: str
) -> list[dict]:
    url = (
        f"{base_url.rstrip('/')}/admin/realms/{realm_name}/clients/"
        f"{client_uuid}/protocol-mappers/models"
    )
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = json.loads(resp.read().decode())
            return raw if isinstance(raw, list) else []
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"List protocol mappers {realm_name} client={client_uuid} failed: {e.code} {body}")


def _oidc_group_membership_mapper_config(full_path: bool) -> dict[str, str]:
    return {
        "claim.name": "groups",
        "full.path": "true" if full_path else "false",
        "access.token.claim": "true",
        "id.token.claim": "true",
        "userinfo.token.claim": "true",
        "introspection.token.claim": "true",
    }


def _mapper_config_matches(existing: dict[str, str], desired: dict[str, str]) -> bool:
    for k, v in desired.items():
        if str(existing.get(k, "")).lower() != str(v).lower():
            return False
    return True


def ensure_kairos_oidc_group_mapper_for_client(
    base_url: str,
    realm_name: str,
    client_uuid: str,
    client_label: str,
    token: str,
    full_path: bool,
) -> None:
    """Idempotent: Group Membership mapper -> JWT claim `groups` for kairos-mcp / kairos-cli."""
    desired_cfg = _oidc_group_membership_mapper_config(full_path)
    mappers = list_client_protocol_mappers(base_url, realm_name, client_uuid, token)
    existing = next((m for m in mappers if m.get("name") == KAIROS_OIDC_GROUP_MAPPER_NAME), None)
    if existing:
        if existing.get("protocolMapper") != KAIROS_OIDC_GROUP_MAPPER_PROVIDER:
            sys.exit(
                f"{realm_name} client {client_label}: mapper {KAIROS_OIDC_GROUP_MAPPER_NAME!r} exists "
                f"with provider {existing.get('protocolMapper')!r}; remove or rename in Keycloak Admin UI."
            )
        cur = {k: str(v) for k, v in (existing.get("config") or {}).items()}
        if _mapper_config_matches(cur, desired_cfg):
            return
        mapper_id = existing.get("id")
        if not isinstance(mapper_id, str) or not mapper_id:
            sys.exit(f"{realm_name} client {client_label}: mapper {KAIROS_OIDC_GROUP_MAPPER_NAME!r} has no id")
        merged_cfg = {**cur, **desired_cfg}
        body = {
            "id": mapper_id,
            "name": KAIROS_OIDC_GROUP_MAPPER_NAME,
            "protocol": "openid-connect",
            "protocolMapper": KAIROS_OIDC_GROUP_MAPPER_PROVIDER,
            "config": merged_cfg,
        }
        url = (
            f"{base_url.rstrip('/')}/admin/realms/{realm_name}/clients/"
            f"{client_uuid}/protocol-mappers/models/{mapper_id}"
        )
        payload = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(url, data=payload, method="PUT")
        req.add_header("Authorization", f"Bearer {token}")
        req.add_header("Content-Type", "application/json")
        try:
            urllib.request.urlopen(req, timeout=15)
        except urllib.error.HTTPError as e:
            err_body = e.read().decode() if e.fp else ""
            sys.exit(f"PUT group mapper {realm_name} {client_label} failed: {e.code} {err_body}")
        print(f"  Updated OIDC group mapper ({realm_name}, {client_label})")
        return

    create_body = {
        "name": KAIROS_OIDC_GROUP_MAPPER_NAME,
        "protocol": "openid-connect",
        "protocolMapper": KAIROS_OIDC_GROUP_MAPPER_PROVIDER,
        "config": desired_cfg,
    }
    url = (
        f"{base_url.rstrip('/')}/admin/realms/{realm_name}/clients/"
        f"{client_uuid}/protocol-mappers/models"
    )
    payload = json.dumps(create_body).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    try:
        urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode() if e.fp else ""
        sys.exit(f"POST group mapper {realm_name} {client_label} failed: {e.code} {err_body}")
    print(f"  Added OIDC group mapper ({realm_name}, {client_label})")


def list_client_scope_protocol_mappers(
    base_url: str, realm_name: str, scope_id: str, token: str
) -> list[dict]:
    url = (
        f"{base_url.rstrip('/')}/admin/realms/{realm_name}/client-scopes/"
        f"{scope_id}/protocol-mappers/models"
    )
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = json.loads(resp.read().decode())
            return raw if isinstance(raw, list) else []
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"List scope protocol mappers {realm_name} scope={scope_id} failed: {e.code} {body}")


def ensure_kairos_oidc_group_mapper_for_client_scope(
    base_url: str,
    realm_name: str,
    scope_id: str,
    scope_label: str,
    token: str,
    full_path: bool,
) -> None:
    desired_cfg = _oidc_group_membership_mapper_config(full_path)
    mappers = list_client_scope_protocol_mappers(base_url, realm_name, scope_id, token)
    existing = next((m for m in mappers if m.get("name") == KAIROS_OIDC_GROUP_MAPPER_NAME), None)
    if existing:
        if existing.get("protocolMapper") != KAIROS_OIDC_GROUP_MAPPER_PROVIDER:
            sys.exit(
                f"{realm_name} scope {scope_label}: mapper {KAIROS_OIDC_GROUP_MAPPER_NAME!r} exists "
                f"with provider {existing.get('protocolMapper')!r}; remove or rename in Keycloak Admin UI."
            )
        cur = {k: str(v) for k, v in (existing.get("config") or {}).items()}
        if _mapper_config_matches(cur, desired_cfg):
            return
        mapper_id = existing.get("id")
        if not isinstance(mapper_id, str) or not mapper_id:
            sys.exit(f"{realm_name} scope {scope_label}: mapper {KAIROS_OIDC_GROUP_MAPPER_NAME!r} has no id")
        merged_cfg = {**cur, **desired_cfg}
        body = {
            "id": mapper_id,
            "name": KAIROS_OIDC_GROUP_MAPPER_NAME,
            "protocol": "openid-connect",
            "protocolMapper": KAIROS_OIDC_GROUP_MAPPER_PROVIDER,
            "config": merged_cfg,
        }
        url = (
            f"{base_url.rstrip('/')}/admin/realms/{realm_name}/client-scopes/"
            f"{scope_id}/protocol-mappers/models/{mapper_id}"
        )
        payload = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(url, data=payload, method="PUT")
        req.add_header("Authorization", f"Bearer {token}")
        req.add_header("Content-Type", "application/json")
        try:
            urllib.request.urlopen(req, timeout=15)
        except urllib.error.HTTPError as e:
            err_body = e.read().decode() if e.fp else ""
            sys.exit(f"PUT scope group mapper {realm_name} {scope_label} failed: {e.code} {err_body}")
        print(f"  Updated OIDC group mapper (scope {realm_name}, {scope_label})")
        return

    create_body = {
        "name": KAIROS_OIDC_GROUP_MAPPER_NAME,
        "protocol": "openid-connect",
        "protocolMapper": KAIROS_OIDC_GROUP_MAPPER_PROVIDER,
        "config": desired_cfg,
    }
    url = (
        f"{base_url.rstrip('/')}/admin/realms/{realm_name}/client-scopes/"
        f"{scope_id}/protocol-mappers/models"
    )
    payload = json.dumps(create_body).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    try:
        urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode() if e.fp else ""
        sys.exit(f"POST scope group mapper {realm_name} {scope_label} failed: {e.code} {err_body}")
    print(f"  Added OIDC group mapper (scope {realm_name}, {scope_label})")


def ensure_kairos_groups_client_scope(base_url: str, realm_name: str, token: str) -> str:
    scopes = list_realm_client_scopes(base_url, realm_name, token)
    scope_row = next((s for s in scopes if s.get("name") == KAIROS_GROUPS_CLIENT_SCOPE_NAME), None)
    if not scope_row:
        url = f"{base_url.rstrip('/')}/admin/realms/{realm_name}/client-scopes"
        payload = json.dumps({
            "name": KAIROS_GROUPS_CLIENT_SCOPE_NAME,
            "protocol": "openid-connect",
            "attributes": {
                "include.in.token.scope": "true",
                "display.on.consent.screen": "false",
            },
        }).encode("utf-8")
        req = urllib.request.Request(url, data=payload, method="POST")
        req.add_header("Authorization", f"Bearer {token}")
        req.add_header("Content-Type", "application/json")
        try:
            urllib.request.urlopen(req, timeout=15)
        except urllib.error.HTTPError as e:
            if e.code != 409:
                body = e.read().decode() if e.fp else ""
                sys.exit(f"Create client scope {KAIROS_GROUPS_CLIENT_SCOPE_NAME} in {realm_name} failed: {e.code} {body}")
        scopes = list_realm_client_scopes(base_url, realm_name, token)
        scope_row = next((s for s in scopes if s.get("name") == KAIROS_GROUPS_CLIENT_SCOPE_NAME), None)
        if not scope_row:
            sys.exit(f"Client scope {KAIROS_GROUPS_CLIENT_SCOPE_NAME} missing in {realm_name} after create attempt")
        print(f"  Created client scope '{KAIROS_GROUPS_CLIENT_SCOPE_NAME}' in {realm_name}")
    else:
        print(f"  Client scope '{KAIROS_GROUPS_CLIENT_SCOPE_NAME}' already present in {realm_name}")

    scope_id = scope_row.get("id")
    if not isinstance(scope_id, str) or not scope_id:
        sys.exit(f"Client scope {KAIROS_GROUPS_CLIENT_SCOPE_NAME} missing id in {realm_name}")
    ensure_kairos_oidc_group_mapper_for_client_scope(
        base_url, realm_name, scope_id, KAIROS_GROUPS_CLIENT_SCOPE_NAME, token, full_path=True
    )
    return scope_id


def list_default_client_scopes(base_url: str, realm_name: str, token: str) -> list[dict]:
    url = f"{base_url.rstrip('/')}/admin/realms/{realm_name}/default-default-client-scopes"
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"GET default client scopes {realm_name} failed: {e.code} {body}")


def ensure_default_client_scope(
    base_url: str,
    realm_name: str,
    token: str,
    scope_id: str,
    scope_name: str,
) -> None:
    defaults = list_default_client_scopes(base_url, realm_name, token)
    if any(s.get("name") == scope_name for s in defaults):
        print(f"  '{scope_name}' already in default client scopes ({realm_name})")
        return
    add_url = f"{base_url.rstrip('/')}/admin/realms/{realm_name}/default-default-client-scopes/{scope_id}"
    put_req = urllib.request.Request(add_url, data=b"", method="PUT")
    put_req.add_header("Authorization", f"Bearer {token}")
    try:
        urllib.request.urlopen(put_req, timeout=15)
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"Add {scope_name} to default client scopes {realm_name} failed: {e.code} {body}")
    print(f"  Linked '{scope_name}' to default client scopes ({realm_name})")


def list_client_default_scopes(
    base_url: str, realm_name: str, client_uuid: str, token: str
) -> list[dict]:
    url = f"{base_url.rstrip('/')}/admin/realms/{realm_name}/clients/{client_uuid}/default-client-scopes"
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"GET client default scopes {realm_name} client={client_uuid} failed: {e.code} {body}")


def ensure_client_default_scope(
    base_url: str,
    realm_name: str,
    token: str,
    client_uuid: str,
    scope_id: str,
    scope_name: str,
) -> None:
    defaults = list_client_default_scopes(base_url, realm_name, client_uuid, token)
    if any(s.get("name") == scope_name for s in defaults):
        return
    add_url = (
        f"{base_url.rstrip('/')}/admin/realms/{realm_name}/clients/"
        f"{client_uuid}/default-client-scopes/{scope_id}"
    )
    put_req = urllib.request.Request(add_url, data=b"", method="PUT")
    put_req.add_header("Authorization", f"Bearer {token}")
    try:
        urllib.request.urlopen(put_req, timeout=15)
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"Add {scope_name} to client default scopes {realm_name} client={client_uuid} failed: {e.code} {body}")


def list_client_optional_scopes(
    base_url: str, realm_name: str, client_uuid: str, token: str
) -> list[dict]:
    url = f"{base_url.rstrip('/')}/admin/realms/{realm_name}/clients/{client_uuid}/optional-client-scopes"
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"GET client optional scopes {realm_name} client={client_uuid} failed: {e.code} {body}")


def ensure_client_optional_scope(
    base_url: str,
    realm_name: str,
    token: str,
    client_uuid: str,
    scope_id: str,
    scope_name: str,
) -> None:
    optionals = list_client_optional_scopes(base_url, realm_name, client_uuid, token)
    if any(s.get("name") == scope_name for s in optionals):
        return
    add_url = (
        f"{base_url.rstrip('/')}/admin/realms/{realm_name}/clients/"
        f"{client_uuid}/optional-client-scopes/{scope_id}"
    )
    put_req = urllib.request.Request(add_url, data=b"", method="PUT")
    put_req.add_header("Authorization", f"Bearer {token}")
    try:
        urllib.request.urlopen(put_req, timeout=15)
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"Add {scope_name} to client optional scopes {realm_name} client={client_uuid} failed: {e.code} {body}")


def remove_kairos_oidc_group_mapper_from_client(
    base_url: str,
    realm_name: str,
    client_uuid: str,
    client_label: str,
    token: str,
) -> None:
    mappers = list_client_protocol_mappers(base_url, realm_name, client_uuid, token)
    existing = next((m for m in mappers if m.get("name") == KAIROS_OIDC_GROUP_MAPPER_NAME), None)
    if not existing:
        return
    mapper_id = existing.get("id")
    if not isinstance(mapper_id, str) or not mapper_id:
        sys.exit(f"{realm_name} client {client_label}: mapper {KAIROS_OIDC_GROUP_MAPPER_NAME!r} has no id")
    url = (
        f"{base_url.rstrip('/')}/admin/realms/{realm_name}/clients/"
        f"{client_uuid}/protocol-mappers/models/{mapper_id}"
    )
    req = urllib.request.Request(url, method="DELETE")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode() if e.fp else ""
        sys.exit(f"DELETE group mapper {realm_name} {client_label} failed: {e.code} {err_body}")
    print(f"  Removed legacy OIDC group mapper ({realm_name}, {client_label})")


def list_realm_client_scopes(base_url: str, realm_name: str, token: str) -> list[dict]:
    """GET realm-defined client scopes (templates)."""
    url = f"{base_url.rstrip('/')}/admin/realms/{realm_name}/client-scopes"
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"List client scopes {realm_name} failed: {e.code} {body}")


def ensure_openid_client_scope(base_url: str, realm_name: str, token: str) -> str:
    """
    Keycloak maps OAuth scope 'openid' in DCR to a Client Scope named 'openid'. If that
    template does not exist, the Allowed Client Scopes registration policy rejects the request
    (mcp-remote, RFC 9728 metadata with scopes_supported containing openid).

    The scope is added as a **default** (not optional) client scope so every token — including
    those issued to dynamically registered MCP clients — carries the `openid` scope. Without it,
    the OIDC Userinfo endpoint returns 403 "Missing openid scope", which breaks the Bearer-auth
    groups fallback path in SQUADRULES (bearer-validate.ts → fetchGroupsFromOidcUserinfo).

    Returns the scope id so callers can link it to named clients.
    """
    scopes = list_realm_client_scopes(base_url, realm_name, token)
    openid_row = next((s for s in scopes if s.get("name") == "openid"), None)
    if not openid_row:
        url = f"{base_url.rstrip('/')}/admin/realms/{realm_name}/client-scopes"
        payload = json.dumps({
            "name": "openid",
            "protocol": "openid-connect",
            "attributes": {
                "include.in.token.scope": "true",
                "display.on.consent.screen": "false",
            },
        }).encode("utf-8")
        req = urllib.request.Request(url, data=payload, method="POST")
        req.add_header("Authorization", f"Bearer {token}")
        req.add_header("Content-Type", "application/json")
        try:
            urllib.request.urlopen(req, timeout=15)
        except urllib.error.HTTPError as e:
            if e.code != 409:
                body = e.read().decode() if e.fp else ""
                sys.exit(f"Create client scope openid in {realm_name} failed: {e.code} {body}")
        scopes = list_realm_client_scopes(base_url, realm_name, token)
        openid_row = next((s for s in scopes if s.get("name") == "openid"), None)
        if not openid_row:
            sys.exit(f"Client scope openid missing in {realm_name} after create attempt")
        print(f"  Created client scope 'openid' in {realm_name}")
    else:
        print(f"  Client scope 'openid' already present in {realm_name}")

    scope_id = openid_row["id"]

    # Remove from optional defaults if present (legacy from earlier config).
    opt_url = f"{base_url.rstrip('/')}/admin/realms/{realm_name}/default-optional-client-scopes/{scope_id}"
    del_req = urllib.request.Request(opt_url, method="DELETE")
    del_req.add_header("Authorization", f"Bearer {token}")
    try:
        urllib.request.urlopen(del_req, timeout=15)
        print(f"  Removed 'openid' from optional client scopes ({realm_name})")
    except urllib.error.HTTPError:
        pass  # Not in optional — fine.

    # Add to default client scopes (idempotent).
    ensure_default_client_scope(base_url, realm_name, token, scope_id, "openid")
    return scope_id


def _merge_realm(current: dict, desired: dict) -> dict:
    """
    Merge desired realm JSON into current (from GET). Preserves Keycloak-assigned ids
    for clients and flows so PUT updates instead of duplicating.
    """
    merged = dict(current)

    # Top-level realm attributes: desired overwrites (keep current id)
    merged["id"] = current.get("id") or desired.get("id") or current.get("realm")
    for key in (
        "realm", "enabled", "registrationAllowed", "loginWithEmailAllowed", "duplicateEmailsAllowed",
        "ssoSessionIdleTimeout", "ssoSessionMaxLifespan", "accessTokenLifespan",
        "accessCodeLifespan", "accessCodeLifespanUserAction", "accessCodeLifespanLogin", "groups",
    ):
        if key in desired:
            merged[key] = desired[key]

    # Clients: by clientId, overlay desired onto existing so Keycloak-managed fields (e.g. defaultClientScopes, protocol) are preserved for local/direct grant login
    desired_client_ids = {c.get("clientId") for c in desired.get("clients") or [] if c.get("clientId")}
    current_clients = list(current.get("clients") or [])
    merged_clients = [c for c in current_clients if c.get("clientId") not in desired_client_ids]
    for d_client in desired.get("clients") or []:
        cid = d_client.get("clientId")
        if not cid:
            continue
        existing = next((c for c in current_clients if c.get("clientId") == cid), None)
        if existing:
            new_client = dict(existing)
            for k, v in d_client.items():
                new_client[k] = v
            if existing.get("id") is not None:
                new_client["id"] = existing["id"]
        else:
            new_client = dict(d_client)
        merged_clients.append(new_client)
    merged["clients"] = merged_clients

    # Authentication flows: by alias, replace with desired and keep current id
    desired_flow_aliases = {f.get("alias") for f in desired.get("authenticationFlows") or [] if f.get("alias")}
    current_flows = list(current.get("authenticationFlows") or [])
    merged_flows = [f for f in current_flows if f.get("alias") not in desired_flow_aliases]
    for d_flow in desired.get("authenticationFlows") or []:
        alias = d_flow.get("alias")
        if not alias:
            continue
        existing = next((f for f in current_flows if f.get("alias") == alias), None)
        new_flow = dict(d_flow)
        if existing and existing.get("id") is not None:
            new_flow["id"] = existing["id"]
        merged_flows.append(new_flow)
    merged["authenticationFlows"] = merged_flows

    # Identity providers: GET /admin/realms/{realm} does not return them; preserve by not sending
    # (IdPs are managed separately via deploy-configure-keycloak-google-idp.py). Do not set merged["identityProviders"]
    # so Keycloak PUT does not overwrite/clear them (realm PUT can replace IdP list if we send it).

    return merged


def _run_docker(*args: str, timeout: int = 10) -> str | None:
    try:
        out = subprocess.run(
            ["docker", *args],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if out.returncode != 0:
            return None
        return (out.stdout or "").strip() or None
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None


DOCKER_BRIDGE_GATEWAYS = [f"172.{octet}.0.1" for octet in range(16, 32)]


def _docker_container_ip_on_network(service_name: str) -> str | None:
    """Find a container's IP by searching all kairos-related Docker networks."""
    IP_RE = re.compile(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$")
    out = _run_docker("network", "ls", "--format", "{{.Name}}")
    if not out:
        return None
    for net_name in out.splitlines():
        if "kairos" not in net_name:
            continue
        cdata = _run_docker("network", "inspect", net_name, "--format", "{{json .Containers}}")
        if not cdata:
            continue
        try:
            containers = json.loads(cdata)
        except json.JSONDecodeError:
            continue
        for _cid, info in containers.items():
            name = info.get("Name") or ""
            if service_name in name:
                addr = (info.get("IPv4Address") or "").split("/")[0]
                if addr and IP_RE.match(addr):
                    return addr
    return None


def get_trusted_hosts_for_env(env: str) -> list[str]:
    """Trusted hosts: localhost + all Docker /16 bridge gateways (172.16–31.0.1) +
    env-specific container IPs and hostnames."""
    base = ["127.0.0.1", "localhost"] + DOCKER_BRIDGE_GATEWAYS
    if env == "dev":
        base.extend(["keycloak", "app-dev", "host.docker.internal", "github.com"])
        ip = _docker_container_ip_on_network("app-dev")
        if ip:
            base.append(ip)
    elif env == "prod":
        ip = _docker_container_ip_on_network("app-prod")
        if ip:
            base.append(ip)
        base.append("app-prod")
    return base


def get_realm_id(base_url: str, realm: str, token: str) -> str:
    url = f"{base_url.rstrip('/')}/admin/realms/{realm}"
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"GET realm failed: {e.code} {body}")
    return data.get("id") or realm


def get_components(base_url: str, realm: str, token: str, parent_id: str, typ: str) -> list[dict]:
    q = urllib.parse.urlencode({"parent": parent_id, "type": typ})
    url = f"{base_url.rstrip('/')}/admin/realms/{realm}/components?{q}"
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"GET components failed: {e.code} {body}")


def update_component(
    base_url: str, realm: str, component_id: str, payload: dict, token: str
) -> None:
    url = f"{base_url.rstrip('/')}/admin/realms/{realm}/components/{component_id}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="PUT")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    try:
        urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"PUT component failed: {e.code} {body}")


def ensure_trusted_hosts(
    base_url: str, realm: str, env: str, token: str
) -> None:
    parent_id = get_realm_id(base_url, realm, token)
    components = get_components(
        base_url, realm, token, parent_id, CLIENT_REGISTRATION_POLICY_TYPE
    )
    targets = [
        c
        for c in components
        if c.get("providerId") == TRUSTED_HOSTS_PROVIDER_ID
        and c.get("subType") in ("anonymous", "authenticated")
        and c.get("id")
    ]
    if not targets:
        print(f"WARNING: No Trusted Hosts component in {realm}; skip.", file=sys.stderr)
        return
    trusted_hosts = get_trusted_hosts_for_env(env)
    for comp in targets:
        config = dict(comp.get("config") or {})
        config["host-sending-registration-request-must-match"] = ["false" if env == "dev" else "true"]
        config["trusted-hosts"] = trusted_hosts
        config["client-uris-must-match"] = ["true" if env == "dev" else "false"]
        update_component(base_url, realm, comp["id"], {**comp, "config": config}, token)
        sub = comp.get("subType") or "?"
        print(f"  Trusted hosts ({sub}) {realm}: {trusted_hosts}")


def ensure_allowed_client_templates(
    base_url: str, realm: str, token: str
) -> None:
    """
    Allow named realm client scopes for dynamic OIDC client registration.

    Requires a Client Scope named `openid` (see ensure_openid_client_scope) so mcp-remote
    and similar clients can register with OAuth scope `openid`.
    """
    parent_id = get_realm_id(base_url, realm, token)
    components = get_components(
        base_url, realm, token, parent_id, CLIENT_REGISTRATION_POLICY_TYPE
    )
    targets = [
        c
        for c in components
        if c.get("providerId") == ALLOWED_CLIENT_TEMPLATES_PROVIDER_ID
        and c.get("subType") in ("anonymous", "authenticated")
    ]
    if not targets:
        print(
            f"WARNING: No Allowed Client Scopes (allowed-client-templates) in {realm}; skip.",
            file=sys.stderr,
        )
        return
    allowed = list(DYNAMIC_REGISTRATION_ALLOWED_CLIENT_SCOPES)
    for comp in targets:
        config = dict(comp.get("config") or {})
        config["allow-default-scopes"] = ["true"]
        config["allowed-client-scopes"] = allowed
        update_component(base_url, realm, comp["id"], {**comp, "config": config}, token)
        sub = comp.get("subType") or "?"
        print(f"  Allowed client templates ({sub}) {realm}: {allowed}")


def get_user_id(base_url: str, realm: str, username: str, token: str) -> str | None:
    q = urllib.parse.urlencode({"username": username})
    url = f"{base_url.rstrip('/')}/admin/realms/{realm}/users?{q}"
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            users = json.loads(resp.read().decode())
            if users:
                return users[0].get("id")
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"Get user failed: {e.code} {body}")
    return None


def create_user(base_url: str, realm: str, username: str, token: str) -> str | None:
    url = f"{base_url.rstrip('/')}/admin/realms/{realm}/users"
    email = username if "@" in username else f"{username}@localhost"
    payload = json.dumps(
        {
            "username": username,
            "enabled": True,
            "firstName": "Squadrules",
            "lastName": "Tester",
            "email": email,
            "emailVerified": True,
            "requiredActions": [],
        }
    ).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            location = resp.headers.get("Location")
            if location:
                return location.rstrip("/").split("/")[-1]
            return None
    except urllib.error.HTTPError as e:
        if e.code == 409:
            return None
        body = e.read().decode() if e.fp else ""
        sys.exit(f"Create user failed: {e.code} {body}")


def set_password(
    base_url: str, realm: str, user_id: str, password: str, token: str
) -> None:
    url = f"{base_url.rstrip('/')}/admin/realms/{realm}/users/{user_id}/reset-password"
    payload = json.dumps({
        "type": "password",
        "value": password,
        "temporary": False,
    }).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="PUT")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    try:
        urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"Set password failed: {e.code} {body}")


def finalize_test_user_for_direct_grant(
    base_url: str, realm: str, user_id: str, username: str, token: str
) -> None:
    """
    Password grant (e2e / Jest) fails with invalid_grant / Account is not fully set up if the user
    lacks first/last name, verified email, or has required actions (Update password, Verify email,
    etc.). Aligns test users with Keycloak 24+ expectations (see keycloak/keycloak#36108).
    """
    url = f"{base_url.rstrip('/')}/admin/realms/{realm}/users/{user_id}"
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            user = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"Get user {user_id} failed: {e.code} {body}")
    rest = {k: v for k, v in user.items() if k != "credentials"}
    fn = (rest.get("firstName") or "").strip()
    ln = (rest.get("lastName") or "").strip()
    rest["firstName"] = fn or "Squadrules"
    rest["lastName"] = ln or "Tester"
    if not (rest.get("email") or "").strip():
        rest["email"] = username if "@" in username else f"{username}@localhost"
    rest["emailVerified"] = True
    rest["enabled"] = True
    rest["requiredActions"] = []
    payload = json.dumps(rest).encode("utf-8")
    put_req = urllib.request.Request(url, data=payload, method="PUT")
    put_req.add_header("Authorization", f"Bearer {token}")
    put_req.add_header("Content-Type", "application/json")
    try:
        urllib.request.urlopen(put_req, timeout=15)
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"Finalize test user {username!r} failed: {e.code} {body}")


_KAIROS_SHARES_GROUP = "kairos-shares"
_KAIROS_OPERATOR_GROUP = "kairos-operator"
_SHARED_GROUP = "shared"
_CI_TEST_SUBGROUP = "ci-test"


def _find_group_id_by_name(groups: list[dict], name: str) -> str | None:
    for g in groups:
        if g.get("name") == name:
            gid = g.get("id")
            if isinstance(gid, str) and gid:
                return gid
        sub = g.get("subGroups")
        if isinstance(sub, list):
            found = _find_group_id_by_name(sub, name)
            if found:
                return found
    return None


def list_direct_group_children(
    base_url: str, realm: str, parent_group_id: str, token: str
) -> list[dict]:
    q = urllib.parse.urlencode({"max": "500", "briefRepresentation": "false"})
    url = (
        f"{base_url.rstrip('/')}/admin/realms/{realm}/groups/"
        f"{parent_group_id}/children?{q}"
    )
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = json.loads(resp.read().decode())
            return raw if isinstance(raw, list) else []
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"GET group children {realm} parent={parent_group_id} failed: {e.code} {body}")


def get_realm_group_id_by_name(
    base_url: str, realm: str, group_name: str, token: str
) -> str | None:
    # Top-level GET often omits subGroups unless search/q is used; recurse when present,
    # and resolve nested kairos-operator under kairos-shares via /children.
    q = urllib.parse.urlencode({"briefRepresentation": "false", "max": "1000"})
    url = f"{base_url.rstrip('/')}/admin/realms/{realm}/groups?{q}"
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = json.loads(resp.read().decode())
            if not isinstance(raw, list):
                return None
            found = _find_group_id_by_name(raw, group_name)
            if found:
                return found
            if group_name == _KAIROS_OPERATOR_GROUP:
                shares_id = _find_group_id_by_name(raw, _KAIROS_SHARES_GROUP)
                if shares_id:
                    for ch in list_direct_group_children(
                        base_url, realm, shares_id, token
                    ):
                        if ch.get("name") == _KAIROS_OPERATOR_GROUP:
                            cid = ch.get("id")
                            if isinstance(cid, str) and cid:
                                return cid
            if group_name == _CI_TEST_SUBGROUP:
                shared_id = _find_group_id_by_name(raw, _SHARED_GROUP)
                if shared_id:
                    for ch in list_direct_group_children(
                        base_url, realm, shared_id, token
                    ):
                        if ch.get("name") == _CI_TEST_SUBGROUP:
                            cid = ch.get("id")
                            if isinstance(cid, str) and cid:
                                return cid
            return None
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"GET groups {realm} failed: {e.code} {body}")


def fetch_realm_groups_tree(base_url: str, realm: str, token: str) -> list[dict]:
    """Full top-level group tree (includes subGroups) for Admin API moves."""
    q = urllib.parse.urlencode({"briefRepresentation": "false", "max": "1000"})
    url = f"{base_url.rstrip('/')}/admin/realms/{realm}/groups?{q}"
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = json.loads(resp.read().decode())
            return raw if isinstance(raw, list) else []
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"GET groups tree {realm} failed: {e.code} {body}")


def _operator_is_child_of_shares(
    base_url: str, realm: str, token: str
) -> bool:
    shares_id = get_realm_group_id_by_name(
        base_url, realm, _KAIROS_SHARES_GROUP, token
    )
    if not shares_id:
        return False
    for ch in list_direct_group_children(base_url, realm, shares_id, token):
        if ch.get("name") == _KAIROS_OPERATOR_GROUP:
            return True
    return False


def create_top_level_group_if_missing(
    base_url: str, realm: str, name: str, token: str
) -> str:
    """Return group id; POST top-level group if absent (Keycloak realm PUT does not create hierarchy)."""
    existing = get_realm_group_id_by_name(base_url, realm, name, token)
    if existing:
        return existing
    url = f"{base_url.rstrip('/')}/admin/realms/{realm}/groups"
    payload = json.dumps({"name": name}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            loc = resp.headers.get("Location")
            if loc:
                return loc.rstrip("/").split("/")[-1]
            body = resp.read().decode()
            if body.strip():
                data = json.loads(body)
                gid = data.get("id")
                if isinstance(gid, str) and gid:
                    return gid
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        if e.code == 409:
            gid = get_realm_group_id_by_name(base_url, realm, name, token)
            if gid:
                return gid
        sys.exit(f"POST top-level group {name!r} {realm} failed: {e.code} {body}")
    sys.exit(f"POST top-level group {name!r} {realm}: no id in response")


def post_group_child(
    base_url: str,
    realm: str,
    parent_id: str,
    child_name: str,
    existing_child_id: str | None,
    token: str,
) -> None:
    """
    Create child under parent, or attach existing group (sets parent). Keycloak:
    POST /admin/realms/{realm}/groups/{parent_id}/children
    """
    url = f"{base_url.rstrip('/')}/admin/realms/{realm}/groups/{parent_id}/children"
    body: dict[str, str] = {"name": child_name}
    if existing_child_id:
        body["id"] = existing_child_id
    payload = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    try:
        urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode() if e.fp else ""
        sys.exit(
            f"POST group child {child_name!r} under parent {parent_id!r} {realm} failed: "
            f"{e.code} {err_body}"
        )


def ensure_kairos_shares_operator_hierarchy(base_url: str, realm: str, token: str) -> None:
    """Nest kairos-operator under kairos-shares (idempotent). Realm JSON alone is insufficient."""
    if _operator_is_child_of_shares(base_url, realm, token):
        print(
            f"  Groups {realm}: {_KAIROS_OPERATOR_GROUP!r} already under {_KAIROS_SHARES_GROUP!r}"
        )
        return
    shares_id = create_top_level_group_if_missing(
        base_url, realm, _KAIROS_SHARES_GROUP, token
    )
    tree = fetch_realm_groups_tree(base_url, realm, token)
    operator_id = _find_group_id_by_name(tree, _KAIROS_OPERATOR_GROUP)
    post_group_child(
        base_url, realm, shares_id, _KAIROS_OPERATOR_GROUP, operator_id, token
    )
    if not _operator_is_child_of_shares(base_url, realm, token):
        sys.exit(
            f"{realm}: expected {_KAIROS_OPERATOR_GROUP!r} under {_KAIROS_SHARES_GROUP!r} "
            "after Admin API child POST; re-check Keycloak state."
        )
    print(
        f"  Groups {realm}: nested {_KAIROS_OPERATOR_GROUP!r} under {_KAIROS_SHARES_GROUP!r}"
    )


def _ci_test_is_child_of_shared(base_url: str, realm: str, token: str) -> bool:
    shared_id = get_realm_group_id_by_name(base_url, realm, _SHARED_GROUP, token)
    if not shared_id:
        return False
    for ch in list_direct_group_children(base_url, realm, shared_id, token):
        if ch.get("name") == _CI_TEST_SUBGROUP:
            return True
    return False


def ensure_shared_ci_test_hierarchy(base_url: str, realm: str, token: str) -> None:
    """
    Nest ci-test under shared (idempotent). JWT group path /shared/ci-test (full.path mapper).
    """
    if _ci_test_is_child_of_shared(base_url, realm, token):
        print(f"  Groups {realm}: '/shared/{_CI_TEST_SUBGROUP}' already present")
        return
    shared_id = create_top_level_group_if_missing(base_url, realm, _SHARED_GROUP, token)
    tree = fetch_realm_groups_tree(base_url, realm, token)
    ci_id = _find_group_id_by_name(tree, _CI_TEST_SUBGROUP)
    post_group_child(base_url, realm, shared_id, _CI_TEST_SUBGROUP, ci_id, token)
    if not _ci_test_is_child_of_shared(base_url, realm, token):
        sys.exit(
            f"{realm}: expected {_CI_TEST_SUBGROUP!r} under {_SHARED_GROUP!r} "
            "after Admin API child POST; re-check Keycloak state."
        )
    print(f"  Groups {realm}: nested {_CI_TEST_SUBGROUP!r} under {_SHARED_GROUP!r}")


def ensure_top_level_groups_from_import(
    base_url: str, realm: str, desired_realm: dict, token: str
) -> None:
    """
    Ensure top-level groups declared in import JSON exist in Keycloak.
    Realm PUT may skip group creation on fresh realms.
    """
    wanted: list[str] = []
    for entry in desired_realm.get("groups") or []:
        if not isinstance(entry, dict):
            continue
        name = entry.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        wanted.append(name)
        create_top_level_group_if_missing(base_url, realm, name, token)
    if wanted:
        print(f"  Groups {realm}: ensured top-level {sorted(set(wanted))}")


def ensure_shared_group(base_url: str, realm: str, token: str) -> None:
    """
    Ensure top-level /shared exists in every managed realm (idempotent).
    This is the canonical allowlist prefix for app-side OIDC group filtering.
    """
    create_top_level_group_if_missing(base_url, realm, _SHARED_GROUP, token)
    print(f"  Groups {realm}: ensured '/{_SHARED_GROUP}'")


def import_includes_top_level_group(desired_realm: dict, name: str) -> bool:
    for entry in desired_realm.get("groups") or []:
        if isinstance(entry, dict) and entry.get("name") == name:
            return True
    return False


def delete_realm_group_by_id(
    base_url: str, realm: str, group_id: str, token: str
) -> None:
    url = f"{base_url.rstrip('/')}/admin/realms/{realm}/groups/{group_id}"
    req = urllib.request.Request(url, method="DELETE")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"DELETE group id={group_id!r} {realm} failed: {e.code} {body}")


def prune_top_level_groups_not_in_import(
    base_url: str, realm: str, desired_realm: dict, token: str
) -> None:
    """Remove top-level realm groups whose names are not listed in import JSON (idempotent)."""
    wanted: set[str] = set()
    for entry in desired_realm.get("groups") or []:
        if isinstance(entry, dict) and isinstance(entry.get("name"), str):
            wanted.add(entry["name"])
    if not wanted:
        return
    tree = fetch_realm_groups_tree(base_url, realm, token)
    for g in tree:
        name = g.get("name")
        gid = g.get("id")
        if not isinstance(name, str) or not isinstance(gid, str):
            continue
        if name not in wanted:
            delete_realm_group_by_id(base_url, realm, gid, token)
            print(f"  Groups {realm}: removed top-level group not in import ({name!r})")


def list_user_groups(base_url: str, realm: str, user_id: str, token: str) -> list[dict]:
    url = f"{base_url.rstrip('/')}/admin/realms/{realm}/users/{user_id}/groups"
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = json.loads(resp.read().decode())
            return raw if isinstance(raw, list) else []
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"GET user groups {realm} user={user_id} failed: {e.code} {body}")


def user_is_in_named_group(groups: list[dict], group_name: str) -> bool:
    for g in groups:
        if g.get("name") == group_name:
            return True
        sub = g.get("subGroups")
        if isinstance(sub, list) and user_is_in_named_group(sub, group_name):
            return True
    return False


def ensure_user_in_group(
    base_url: str, realm: str, user_id: str, group_id: str, token: str
) -> None:
    """Idempotent: PUT membership (Keycloak accepts repeat)."""
    url = f"{base_url.rstrip('/')}/admin/realms/{realm}/users/{user_id}/groups/{group_id}"
    req = urllib.request.Request(url, method="PUT")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"Add user to group failed: {e.code} {body}")


def ensure_test_user_in_group(
    base_url: str, realm: str, username: str, group_name: str, token: str
) -> None:
    """
    Add test user to a realm group and verify via Admin API (GET user groups).
    Fails the script if membership cannot be applied — do not print success without proof.
    """
    user_id = get_user_id(base_url, realm, username, token)
    if not user_id:
        sys.exit(
            f"Test user {username!r} missing in {realm}; cannot assign group {group_name!r}."
        )
    group_id = get_realm_group_id_by_name(base_url, realm, group_name, token)
    if not group_id:
        sys.exit(
            f"Group {group_name!r} missing in {realm}; import realm JSON or create the group first."
        )
    ensure_user_in_group(base_url, realm, user_id, group_id, token)
    assigned = list_user_groups(base_url, realm, user_id, token)
    if not user_is_in_named_group(assigned, group_name):
        sys.exit(
            f"Keycloak Admin API did not report {username!r} in {group_name!r} after PUT "
            f"(user groups: {[g.get('name') for g in assigned]!r})."
        )
    print(f"  Test user {realm}: {username} -> group {group_name} (verified)")


def ensure_test_user(
    base_url: str, realm: str, username: str, password: str, token: str
) -> None:
    user_id = get_user_id(base_url, realm, username, token)
    if not user_id:
        user_id = create_user(base_url, realm, username, token)
    if not user_id:
        print(f"WARNING: Could not create/find user {username} in {realm}.", file=sys.stderr)
        return
    set_password(base_url, realm, user_id, password, token)
    finalize_test_user_for_direct_grant(base_url, realm, user_id, username, token)
    print(f"  Test user {realm}: {username}")


# Realm keys we set from import (must match _merge_realm and import JSON)
_REALM_COMPARE_KEYS = (
    "realm", "enabled", "registrationAllowed", "loginWithEmailAllowed", "duplicateEmailsAllowed",
    "ssoSessionIdleTimeout", "ssoSessionMaxLifespan", "accessTokenLifespan",
    "accessCodeLifespan", "accessCodeLifespanUserAction", "accessCodeLifespanLogin", "groups",
)
# Client keys we set from import (subset of ClientRepresentation)
_CLIENT_COMPARE_KEYS = (
    "clientId", "name", "enabled", "publicClient", "standardFlowEnabled", "directAccessGrantsEnabled",
    "redirectUris", "webOrigins", "attributes",
)
# Only verify these clients (kairos-cli is used by CLI login; kairos-mcp is server's client, often env-specific)
_VERIFY_CLIENT_IDS = frozenset({"kairos-cli"})


def get_realm_groups(base_url: str, realm_name: str, token: str) -> list[dict]:
    """GET realm groups (names only for compare). Keycloak realm GET may not include groups."""
    url = f"{base_url.rstrip('/')}/admin/realms/{realm_name}/groups?briefRepresentation=true"
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            groups = json.loads(resp.read().decode())
            return [{"name": g.get("name", "")} for g in groups]
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        sys.exit(f"GET groups {realm_name} failed: {e.code} {body}")


def _dump_realm_for_compare(base_url: str, realm_name: str, token: str) -> dict:
    """Dump current Keycloak realm state into same shape as import JSON (for compare)."""
    realm = get_realm_full(base_url, realm_name, token)
    clients_raw = get_realm_clients(base_url, realm_name, token)
    out = {"id": realm.get("id"), "realm": realm.get("realm")}
    for k in _REALM_COMPARE_KEYS:
        if k in realm:
            out[k] = realm[k]
    if out.get("groups") is None:
        out["groups"] = get_realm_groups(base_url, realm_name, token)
    out["clients"] = []
    for c in clients_raw:
        cid = c.get("clientId")
        if not cid:
            continue
        client_subset = {}
        for k in _CLIENT_COMPARE_KEYS:
            if k not in c:
                continue
            v = c[k]
            if k == "attributes" and isinstance(v, dict):
                # only compare attributes we set in import (e.g. pkce)
                v = {kk: vv for kk, vv in v.items() if kk.startswith("pkce.")}
            if v is not None:
                client_subset[k] = v
        out["clients"].append(client_subset)
    return out


def _normalize_for_compare(obj: dict | list) -> dict | list:
    """Sort list values that are unordered (redirectUris, webOrigins) for stable diff."""
    if isinstance(obj, dict):
        return {k: _normalize_for_compare(v) for k, v in obj.items()}
    if isinstance(obj, list):
        if not obj:
            return obj
        if isinstance(obj[0], str):
            return sorted(obj)
        if isinstance(obj[0], dict) and "name" in obj[0]:
            # groups: compare by sorted names only
            return sorted(d.get("name", "") for d in obj)
    return obj


def _compare_expected_actual(realm_name: str, expected: dict, actual_dump: dict) -> list[str]:
    """Compare expected (from import JSON) with actual (dump). Return list of diff messages.
    Only compares keys present in expected. Ignores realm id (Keycloak-assigned).
    """
    diffs: list[str] = []
    # Realm: only keys that exist in expected (exclude id)
    realm_keys_to_compare = [k for k in _REALM_COMPARE_KEYS if k in expected]
    for k in realm_keys_to_compare:
        exp_v = _normalize_for_compare(expected[k])
        act_v = _normalize_for_compare(actual_dump.get(k))
        if k == "groups" and (act_v == [] or act_v is None):
            # Keycloak realm PUT does not create groups; skip when none exist yet (e.g. fresh CI)
            continue
        if exp_v != act_v:
            diffs.append(f"{realm_name} realm.{k}: expected {exp_v!r}, got {act_v!r}")

    exp_clients = {c["clientId"]: c for c in expected.get("clients") or [] if c.get("clientId")}
    act_clients = {c["clientId"]: c for c in actual_dump.get("clients") or [] if c.get("clientId")}

    for cid in _VERIFY_CLIENT_IDS:
        exp_c = exp_clients.get(cid)
        if not exp_c:
            continue
        act_c = act_clients.get(cid)
        if not act_c:
            diffs.append(f"{realm_name} client {cid!r}: missing in Keycloak")
            continue
        for k in exp_c:
            if k not in _CLIENT_COMPARE_KEYS:
                continue
            ev = _normalize_for_compare(exp_c[k])
            av = _normalize_for_compare(act_c.get(k))
            if k == "attributes" and ev in (None, {}) and av in (None, {}):
                continue
            if ev != av:
                diffs.append(f"{realm_name} client {cid!r}.{k}: expected {ev!r}, got {av!r}")

    return diffs


def verify_realms_after_update(base_url: str, token: str, import_dir: Path, env: dict) -> list[str]:
    """
    Dump each realm from Keycloak after update and compare with import JSON.
    Returns list of diff messages; empty means dump matches expected.
    """
    all_diffs: list[str] = []
    for realm_name, filename in REALM_FILES:
        path = import_dir / filename
        if not path.is_file():
            continue
        expected = load_desired_realm(path, env, realm_name)
        actual_dump = _dump_realm_for_compare(base_url, realm_name, token)
        all_diffs.extend(_compare_expected_actual(realm_name, expected, actual_dump))
    return all_diffs


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    env = get_env(root)
    base_url = env.get("KEYCLOAK_URL", "http://localhost:8080")
    admin_password = env.get("KEYCLOAK_ADMIN_PASSWORD")
    if not admin_password:
        sys.exit("KEYCLOAK_ADMIN_PASSWORD not set. Set in .env or export.")

    test_username = env.get("TEST_USERNAME", "kairos-tester")
    test_password = env.get("TEST_PASSWORD", "kairos-tester-secret")
    ci_test_only_username = env.get("KAIROS_CI_TEST_USERNAME", "kairos-ci-tester")
    ci_test_only_password = env.get("KAIROS_CI_TEST_PASSWORD", "kairos-ci-tester-secret")

    token = get_admin_token(base_url, admin_password)
    import_dir = root / "scripts" / "keycloak" / "import"
    desired_by_realm: dict[str, dict] = {}

    # 1. Ensure realm exists (minimal create), then always apply config from file (idempotent)
    existing = list_realms(base_url, token)
    for realm_name, filename in REALM_FILES:
        path = import_dir / filename
        if not path.is_file():
            print(f"Realm file not found: {path}, skip.", file=sys.stderr)
            continue
        if realm_name not in existing:
            create_realm_minimal(base_url, token, realm_name)
            print(f"Created realm {realm_name} (defaults).")
        current = get_realm_full(base_url, realm_name, token)
        desired = load_desired_realm(path, env, realm_name)
        desired_by_realm[realm_name] = desired
        merged = _merge_realm(current, desired)
        update_realm(base_url, realm_name, merged, token)
        print(f"Updated realm {realm_name}.")
        # Keycloak realm PUT does not create new clients; create any missing via POST
        existing_ids = list_realm_client_ids(base_url, realm_name, token)
        for d_client in desired.get("clients") or []:
            cid = d_client.get("clientId")
            if not cid or cid in existing_ids:
                continue
            create_realm_client(base_url, realm_name, d_client, token)
            print(f"  Created client {cid} in {realm_name}.")
            existing_ids.add(cid)

        push_kairos_mcp_redirect_config(base_url, realm_name, desired, token)

    # 1b. Realm PUT does not reliably create/move groups; enforce import top-level groups
    # and then /shared plus optional shares/operator hierarchy via Admin API.
    for realm_name, _ in REALM_FILES:
        desired = desired_by_realm.get(realm_name, {})
        ensure_top_level_groups_from_import(base_url, realm_name, desired, token)
        ensure_shared_group(base_url, realm_name, token)
        ensure_shared_ci_test_hierarchy(base_url, realm_name, token)
        if import_includes_top_level_group(desired, _KAIROS_SHARES_GROUP):
            ensure_kairos_shares_operator_hierarchy(base_url, realm_name, token)
        prune_top_level_groups_not_in_import(base_url, realm_name, desired, token)

    # 2. Set trusted hosts per realm (dev / prod)
    for realm_name, _ in REALM_FILES:
        env_key = realm_name.replace("kairos-", "")
        ensure_trusted_hosts(base_url, realm_name, env_key, token)

    # 3. Client Scope `openid` as realm **default** (not optional) so Userinfo works for
    #    Bearer tokens. Without `openid` in scope, Keycloak returns 403 "Missing openid scope"
    #    on the Userinfo endpoint, breaking the groups-fallback in bearer-validate.ts.
    openid_scope_ids: dict[str, str] = {}
    for realm_name, _ in REALM_FILES:
        openid_scope_ids[realm_name] = ensure_openid_client_scope(base_url, realm_name, token)

    # 3b. Shared groups client scope (default for all clients, including dynamic registration).
    group_scope_ids: dict[str, str] = {}
    for realm_name, _ in REALM_FILES:
        group_scope_ids[realm_name] = ensure_kairos_groups_client_scope(base_url, realm_name, token)

    # 4. Dynamic client registration: allowed client-scope templates
    for realm_name, _ in REALM_FILES:
        ensure_allowed_client_templates(base_url, realm_name, token)

    # 4b. Attach groups + openid scopes to realm defaults + named clients (kairos-mcp / kairos-cli).
    #     Realm defaults apply to newly registered DCR clients automatically. Named clients
    #     need explicit linking because they were created before the scopes became defaults.
    for realm_name, _ in REALM_FILES:
        scope_id = group_scope_ids.get(realm_name)
        if not scope_id:
            sys.exit(f"Missing {KAIROS_GROUPS_CLIENT_SCOPE_NAME} scope id for {realm_name}")
        openid_id = openid_scope_ids.get(realm_name)
        ensure_default_client_scope(
            base_url, realm_name, token, scope_id, KAIROS_GROUPS_CLIENT_SCOPE_NAME
        )
        for cid in sorted(CLIENT_IDS_FOR_GROUP_MAPPER):
            c_uuid = get_client_internal_id_by_client_id(base_url, realm_name, cid, token)
            if not c_uuid:
                print(
                    f"WARNING: client {cid!r} missing in {realm_name}; skip scope links.",
                    file=sys.stderr,
                )
                continue
            ensure_client_default_scope(
                base_url, realm_name, token, c_uuid, scope_id, KAIROS_GROUPS_CLIENT_SCOPE_NAME
            )
            if openid_id:
                ensure_client_default_scope(
                    base_url, realm_name, token, c_uuid, openid_id, "openid"
                )
            remove_kairos_oidc_group_mapper_from_client(base_url, realm_name, c_uuid, cid, token)
            # Optional scopes (profile, email, offline_access) — available when requested.
            realm_scopes = list_realm_client_scopes(base_url, realm_name, token)
            for opt_name in CLIENT_OPTIONAL_SCOPES:
                opt_row = next((s for s in realm_scopes if s.get("name") == opt_name), None)
                if not opt_row:
                    print(f"  WARNING: realm scope {opt_name!r} missing in {realm_name}; skip.", file=sys.stderr)
                    continue
                ensure_client_optional_scope(
                    base_url, realm_name, token, c_uuid, opt_row["id"], opt_name
                )

    # 5. Test users in dev only (password); group membership runs after verify (step 7)
    for realm_name in ("kairos-dev",):
        ensure_test_user(base_url, realm_name, test_username, test_password, token)
        ensure_test_user(base_url, realm_name, ci_test_only_username, ci_test_only_password, token)

    # 6. Verify: dump from Keycloak and compare with import
    verify_errors = verify_realms_after_update(base_url, token, import_dir, env)
    if verify_errors:
        print("Verification failed (dump vs import):", file=sys.stderr)
        for msg in verify_errors:
            print(f"  - {msg}", file=sys.stderr)
        sys.exit(1)
    print("Verified: dump matches import.")

    # 7. Test user groups last (realm/clients verified); GET confirms membership for Admin UI / tokens
    for realm_name in ("kairos-dev",):
        desired = desired_by_realm.get(realm_name, {})
        ensure_test_user_in_group(base_url, realm_name, test_username, "kairos-auditor", token)
        if import_includes_top_level_group(desired, _KAIROS_SHARES_GROUP):
            ensure_test_user_in_group(
                base_url, realm_name, test_username, "kairos-operator", token
            )
        ensure_test_user_in_group(base_url, realm_name, test_username, "ci-test", token)
        ensure_test_user_in_group(base_url, realm_name, ci_test_only_username, "ci-test", token)

    print("Keycloak realms configured.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
