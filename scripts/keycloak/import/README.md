# Keycloak realm import

Realm JSONs in this directory are applied **idempotently** by **scripts/deploy-configure-keycloak-realms.py** via the Admin API. No Docker import mount; do not use Keycloak `--import-realm` (would conflict with existing realms).

**Sub-realms only.** All realm configuration in this repo (import JSON +
`deploy-configure-keycloak-realms.py`) targets **sub-realms** (for example,
`squadrules-dev`, `squadrules-prod`). The **master** realm is used only for admin
authentication (obtaining a token); no script modifies master.

## Files

These files define the realm baselines that the Admin API merge step applies.

- **squadrules-dev-realm.json** – Dev realm: `squadrules-dev`, clients `squadrules-mcp`
  (server browser login) and `squadrules-cli` (CLI or MCP host PKCE). Browser SSO
  is kept. We recommend MCP clients send `prompt=login` when building the auth
  URL (see `authorization_request_parameters` in
  `/.well-known/oauth-protected-resource`).
- **squadrules-prod-realm.json** – Prod realm: `squadrules-prod`, clients `squadrules-mcp`
  (server browser login) and `squadrules-cli` (CLI or MCP host PKCE).

## Idempotent configuration: `deploy-configure-keycloak-realms.py`

Run when Keycloak is up (safe to re-run; merge/update, no duplicate realms):

```bash
npm run infra:up
# Or: python3 scripts/deploy-configure-keycloak-realms.py
# Optional: KEYCLOAK_URL=http://keycloak:8080
```

The script:

1. **Realms:** creates minimal realm if missing, then merges and PUTs config from `scripts/keycloak/import/*.json` (idempotent; preserves existing clients/flows by id).
2. **Trusted hosts:** set per realm (dev: 127.0.0.1 + Docker gateway; prod: app-prod).
3. **Client Scope `openid`:** creates a realm Client Scope named `openid` (if missing), adds it to **default optional client scopes**, and allowlists it on **Allowed Client Scopes** registration policies. MCP clients such as `mcp-remote` register with OAuth `scope: openid` (from protected-resource metadata); without this named scope, Keycloak rejects dynamic client registration with *Not permitted to use specified clientScope*.
4. **Allowed client templates:** sets anonymous/authenticated registration policy allow lists (includes `openid` plus templates aligned with `squadrules-cli` defaults).
5. **Test users** (dev only): `TEST_USERNAME` / `TEST_PASSWORD` (default `squadrules-tester` / `squadrules-tester-secret`), optional `SQUADRULES_CI_TEST_USERNAME` / `SQUADRULES_CI_TEST_PASSWORD` (default `squadrules-ci-tester` / `squadrules-ci-tester-secret`). The script ensures **`/shared/ci-test`** exists under the top-level **`shared`** group and assigns both users to **`ci-test`** (plus **`squadrules-auditor`** for `squadrules-tester`; **`squadrules-operator`** only if the import lists top-level **`squadrules-shares`**). Extra top-level groups not present in the import JSON are **deleted** from the realm so verification matches. After setting the password, each test user is **finalized** for **direct access grants** (non-temporary password, non-empty first/last name, verified email, empty **required actions**) so password grant does not return **Account is not fully set up** (Keycloak 24+).
6. **JWT `groups` mapper** client scope: creates a shared client scope named
   `squadrules-groups` with the **Group Membership** mapper for OIDC tokens (claim
   `groups`, access + ID + userinfo + introspection). The script attaches the
   scope as a **default client scope** so new OAuth clients inherit it, then
   links it to `squadrules-mcp` and `squadrules-cli`. **`full.path` is always on** (full
   paths such as `/squadrules-auditor`, `/squadrules-shares/squadrules-operator`); the
   script does not toggle it via env.

Requires `KEYCLOAK_ADMIN_PASSWORD` in `.env` or environment. Optional: `KEYCLOAK_URL` (default `http://localhost:8080`), `TEST_USERNAME`, `TEST_PASSWORD`.

## Claims used by SQUADRULES account and spaces

SQUADRULES expects explicit token claims (not inferred fallbacks):

- `identity_provider` (string) for account labeling (for example `google` -> `Google (SSO)` in `/ui/account`)
- `groups` (array of strings) for group-derived spaces and account group display

### Identity provider claim (Keycloak 26.5.x)

For brokered login (Google/Okta/etc.), configure a **User Session Note** mapper on the identity provider:

- session note: `identity_provider`
- token claim name: `identity_provider`
- include in access token and/or ID token

Without this mapper, SQUADRULES treats users as local account type because the claim is absent.

### Groups claim (explicit memberships only)

SQUADRULES reads only the JWT `groups` claim. It does **not** fallback to `realm_access.roles`.

`deploy-configure-keycloak-realms.py` creates a shared client scope named
`squadrules-groups` and attaches the **Group Membership** mapper named
`squadrules-oidc-groups`. The scope is a **default client scope** so new OAuth
clients inherit the claim, and the script links it to `squadrules-mcp` and
`squadrules-cli`. Keycloak’s mapper lists **every** realm group the user belongs to
(you cannot whitelist individual groups in that mapper on current Keycloak).

To **choose which groups SQUADRULES uses** (spaces, `/api/me`, session cookie) after
the token is issued, set **`OIDC_GROUPS_ALLOWLIST`** in the app `.env` to a
comma-separated list of full group **paths** or **path prefixes** ending with
`/`. For example, `/shared/` matches `/shared/team-platform`.

Leave the allowlist empty or unset to deny all group paths (default deny). Use
`/` or a more specific prefix to accept group paths and then tighten the list
as needed.

SQUADRULES builds deterministic space ids at request time using the issuer and
token claims:

- Personal space: `user:<realmSlug>:<uuidv5(iss + "\\nuser\\n" + sub)>`
- Group space: `group:<realmSlug>:<uuidv5(iss + "\\ngroup\\n" + fullPath)>`

If you manage Keycloak manually, add the same style of **Group Membership**
mapper yourself. Keep the claim name `groups` so SQUADRULES can read it.

## Adding other users

For ad-hoc users (for example, `demo`) with auto-generated password:

```bash
python3 scripts/deploy-add-keycloak-user --realm squadrules-dev --user demo
# Or: scripts/deploy-add-keycloak-demo-user.sh
```

## MCP OAuth and multi-browser (already_logged_in)

The server exposes `authorization_request_parameters: { "prompt": "login" }` in
`/.well-known/oauth-protected-resource`. MCP clients (for example, Cursor) that
support it can add these parameters to the authorization request when
redirecting to Keycloak, so users get a fresh login for MCP without disabling
SSO for normal browser use. If your MCP client does not yet support this, you
may see `already_logged_in` when already logged in elsewhere. Use a private
window or a second browser with the same Keycloak base URL.

## Naming

Use the naming patterns below to keep realm files consistent.

- Realm config: `<realm>-realm.json`.
- User files (if you add exported users): `<realm>-users-<n>.json` (see
  [Keycloak import/export](https://www.keycloak.org/server/importExport)).
