---
kind: configuration_system
name: Environment-Driven Configuration with Runtime Mode Resolution and CLI Config File
category: configuration_system
scope:
    - '**'
source_files:
    - src/config.ts
    - src/config/runtime-mode.ts
    - src/config/embedding-fastembed.ts
    - src/cli/config.ts
    - src/cli/config-file.ts
    - src/cli/config-file-internals.ts
    - src/cli/config-file-write.ts
    - src/cli/keyring.ts
---

## Approach

SquadRules uses a **pure environment-variable-driven configuration system** with two layers:

1. **Server-side runtime configuration** — all process-wide settings are read from `process.env` at module load time in `src/config.ts`, with helpers for typed parsing (`getEnvRequired`, `getEnvString`, `getEnvInt`, `getEnvFloat`, `getEnvBoolean`).
2. **CLI user configuration** — persisted credentials and API URL in an XDG-compliant JSON config file under `src/cli/config-file.ts`, optionally backed by the OS keyring.

There is no YAML/TOML/JSON application manifest consumed at boot; `.env` files are only referenced as a convention for setting env vars (see error messages like "Set it in .env or environment").

## Key Files

- `src/config.ts` — central registry of every server-side constant, parsed from env vars, with cross-var validation (Keycloak required fields, stdio mode guards).
- `src/config/runtime-mode.ts` — pure-function resolution of `TRANSPORT_TYPE`, `AUTH_ENABLED`, and `isQdrantConfigured`; designed to be unit-testable without touching `process.env`.
- `src/config/embedding-fastembed.ts` — fastembed model/cache defaults, re-exported from `config.ts` to keep the main file within line limits.
- `src/cli/config.ts` — resolves the CLI's API URL via the documented precedence chain.
- `src/cli/config-file.ts` — reads/writes the per-user config file, handles migration from legacy flat shape to multi-environment shape, and integrates with the OS keyring.
- `src/cli/config-file-internals.ts` / `src/cli/config-file-write.ts` — low-level parse/write helpers and XDG path resolution.
- `src/cli/keyring.ts` — OS keyring integration for bearer/refresh tokens.

## Architecture and Conventions

### Env var parsing helpers
All env access goes through five helpers in `src/config.ts`:
- `getEnvRequired(key, errorMessage?)` — throws if missing or empty.
- `getEnvString(key, default)` — returns string default when unset.
- `getEnvInt(key, default)` — parses base-10 int, falls back on NaN.
- `getEnvFloat(key, default)` — parses float, falls back on NaN.
- `getEnvBoolean(key, default)` — recognizes `true/false/1/0/yes/no/y/n` (case-insensitive), otherwise returns default.

### Two runtime modes
`src/config/runtime-mode.ts` defines two mutually exclusive modes:
- **simple** (`transport='stdio'`) — local single-user MCP server, embedded LanceDB only, no HTTP listener, auth off by default.
- **cluster** (`transport='http'`) — deployed posture with REST API, Streamable HTTP MCP, browser UI, metrics, OIDC auth on by default.

Transport selection order: explicit `TRANSPORT_TYPE` → `SQUADRULES_MCP_STDIO=1` or `SQUADRULES_CLI_SERVE=1` set by the `squadrules-mcp` bin / `squadrules serve` → default `http`. Auth follows the mode unless explicitly overridden; `assertStdioConfigConsistency()` throws at startup if `TRANSPORT_TYPE=stdio` has `AUTH_ENABLED=true` or `QDRANT_URL` set.

### Cross-var validation
After reading env vars, `src/config.ts` performs inter-variable checks:
- When `AUTH_ENABLED=true` (and explicitly set), requires non-empty `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`, `AUTH_CALLBACK_BASE_URL`, `SESSION_SECRET` — throws listing missing vars.
- Derives `AUTH_TRUSTED_ISSUERS` from `AUTH_TRUSTED_ISSUERS_STRING` or from `KEYCLOAK_URL`+`KEYCLOAK_REALM`, adding localhost↔127.0.0.1 loopback aliases.
- Derives `AUTH_ALLOWED_AUDIENCES` from `AUTH_ALLOWED_AUDIENCES_STRING` or defaults to `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLI_CLIENT_ID`, plus `account` when a Keycloak realm issuer is detected.
- Normalizes `QDRANT_SNAPSHOT_DIR` to absolute path.

### Feature toggles via env
Backend selection is purely env-driven:
- `KEY_VALUE_STORE_URL` or `REDIS_URL` set → Redis-backed key-value store; else in-memory.
- `QDRANT_URL` set → external Qdrant vector backend; else embedded LanceDB.
- `EMBEDDING_PROVIDER` = `'auto' | 'openai' | 'tei' | 'fastembed'` — auto prefers configured external provider, else local fastembed.

### CLI config file format
The CLI persists user state in a JSON file (XDG-compliant path). New shape:
```json
{
  "defaultUrl": "http://localhost:<SERVER_PORT>",
  "environments": {
    "http://localhost:<SERVER_PORT>": { "bearerToken": "...", "refreshToken": "..." }
  }
}
```
Legacy flat shape `{ "SQUADRULES_API_URL": "...", "bearerToken": "..." }` is migrated on first write. Tokens are stored in the OS keyring when available; the file holds only `__KEYCHAIN__` placeholders. The API URL resolution order is: `--url` flag > `SQUADRULES_API_URL` env > saved `defaultUrl` > local sentinel `LOCAL_TARGET`.

### Secrets handling
- Server secrets (Keycloak URLs, session secret, API keys) come exclusively from env vars.
- CLI bearer/refresh tokens go to the OS keyring when available; otherwise they fall back to the config file with a one-time warning.
- `KEYCHAIN_TOKEN_PLACEHOLDER` marks that a token lives in the keyring rather than inline.

## Conventions and Constraints

- All server configuration is read from `process.env` at import time in `src/config.ts`; there is no runtime mutation of these constants.
- Boolean env values accept `true/false/1/0/yes/no/y/n` (case-insensitive); unparseable values return the provided default, not an error.
- Required env vars use `getEnvRequired`, which throws immediately with a message naming the missing variable.
- `TRANSPORT_TYPE=stdio` with `AUTH_ENABLED=true` or `QDRANT_URL` set is rejected at startup via `assertStdioConfigConsistency()` throwing an error joining all violations.
- `AUTH_ENABLED=true` (explicitly set) requires `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`, `AUTH_CALLBACK_BASE_URL`, `SESSION_SECRET` — missing ones are listed in the thrown error.
- The CLI API URL precedence is enforced by `getCliApiUrlDefault()`: `--url` > `SQUADRULES_API_URL` > config file `defaultUrl` > `LOCAL_TARGET`.
- The CLI config file supports multiple environments keyed by normalized API URL; migration from the legacy flat shape happens automatically on first write.
- Token storage prefers the OS keyring; when unavailable, tokens are written to the config file and a one-time stderr warning is emitted.
- `src/config/runtime-mode.ts` exposes pure functions over an `env` record so transport/auth rules can be unit-tested without side effects on `process.env`.