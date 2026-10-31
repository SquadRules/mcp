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
    - src/cli/config-file.ts
    - src/cli/config-file-internals.ts
    - src/cli/config-file-write.ts
    - src/cli/config.ts
    - src/index.ts
    - src/bootstrap.ts
---

## Overview

SQUADRULES uses a **process.env-driven configuration system** with no external config file format (no YAML/TOML/JSON for runtime settings). All runtime behavior is controlled by environment variables, parsed once at module load in `src/config.ts`, with a small subset of CLI-only credentials persisted to an XDG-compliant JSON config file under the user's home directory.

## Key Files and Packages

- `src/config.ts` — Central env parser; exports all runtime constants (`SERVER_PORT`, `LOG_LEVEL`, `EMBEDDING_PROVIDER`, OIDC/Keycloak vars, Qdrant/LanceDB selection, rate limits, search thresholds, etc.).
- `src/config/runtime-mode.ts` — Pure-function resolution of `TRANSPORT_TYPE` (`stdio` vs `http`), `AUTH_ENABLED`, and stdio-mode violation checks.
- `src/config/embedding-fastembed.ts` — Local fastembed model/cache defaults (re-exported from `config.ts`).
- `src/cli/config-file.ts` + `src/cli/config-file-internals.ts` + `src/cli/config-file-write.ts` — XDG-compliant CLI config file storage for API URL and bearer/refresh tokens, with OS keyring fallback.
- `src/cli/config.ts` — CLI-side default API URL resolution: `--url` > `SQUADRULES_API_URL` > saved config `defaultUrl` > local sentinel.
- `src/index.ts` — Bootstraps transport selection based on resolved `TRANSPORT_TYPE` and starts either HTTP or stdio server.
- `src/bootstrap.ts` — Early error-handler installation before any app code loads.

## Architecture and Conventions

### Env parsing helpers
`src/config.ts` defines four typed helpers used throughout:
- `getEnvRequired(key, errorMessage?)` — throws if missing/empty.
- `getEnvString(key, defaultValue)` — returns trimmed string or default.
- `getEnvInt(key, defaultValue)` — parseInt with NaN → default.
- `getEnvFloat(key, defaultValue)` — parseFloat with NaN → default.
- `getEnvBoolean(key, defaultValue)` — recognizes `false/0/no/n/true/1/yes/y` (case-insensitive).

These are the only way env values enter the system; there is no `.env` loader library — consumers read `process.env` directly through these helpers.

### Runtime mode resolution
`src/config/runtime-mode.ts` isolates the two-mode decision logic as pure functions over an `env` record so it can be unit-tested without re-evaluating module-level constants:

- `resolveTransportType(env)` — explicit `TRANSPORT_TYPE` wins; otherwise `stdio` when launched via `squadrules-mcp` bin or `squadrules serve` (detected via `SQUADRULES_MCP_STDIO=1` or `SQUADRULES_CLI_SERVE=1`); default is `http`.
- `resolveAuthEnabled(env, transport)` — explicit `AUTH_ENABLED` wins; otherwise `true` for `http`, `false` for `stdio`.
- `getStdioConfigViolations(env, transport, authEnabled)` — returns human-readable messages when stdio mode has `AUTH_ENABLED=true` or `QDRANT_URL` set; `assertStdioConfigConsistency()` throws them at startup.

The two modes are documented as non-interchangeable:
- **simple** (`transport=stdio`) — local single-user MCP server, embedded LanceDB only, no HTTP listener, no per-client space context.
- **cluster** (`transport=http`) — REST API, Streamable HTTP MCP, browser UI, metrics, OIDC auth on by default.

### Configuration layering
There are two distinct layers:

1. **Runtime configuration** (server process): entirely env-driven. No runtime config files are loaded. The bootstrap installs uncaught exception handlers before importing `index.js`, which then calls `runSquadrulesServer()`, which boots shared services, selects the vector store (Qdrant vs embedded LanceDB based on `QDRANT_URL`), probes embeddings, and starts the selected transport.

2. **CLI configuration** (user-facing tool): persists `defaultUrl`, `bearerToken`, and `refreshToken` in an XDG-compliant JSON file (`~/.config/squadrules/config.json` or equivalent). Tokens are stored in the OS keyring when available; the file holds only a `__KEYCHAIN__` placeholder. The new multi-environment shape is `{ defaultUrl, environments: { [apiUrl]: { bearerToken, refreshToken } } }`; old flat shapes are migrated on first write.

### Derived / computed configuration
Several exported constants are not raw env values but derived:
- `REDIS_URL` = normalized `KEY_VALUE_STORE_URL` (fallback `REDIS_URL`), using `normalizeRedisUrl`.
- `isRedisConfigured` / `isQdrantConfigured` — boolean flags driving backend selection.
- `OIDC_SCOPES_SUPPORTED` — parsed comma-separated list from `SQUADRULES_OIDC_SCOPES_SUPPORTED`.
- `OIDC_GROUPS_ALLOWLIST` — frozen array from `OIDC_GROUPS_ALLOWLIST`.
- `GROUP_SPACE_PATH_EXAMPLE` — computed from allowlist prefix entries or defaults to `/shared/{suffix}`.
- `AUTH_TRUSTED_ISSUERS` — expands `AUTH_TRUSTED_ISSUERS_STRING` or derives from `KEYCLOAK_URL/REALM`, adding localhost↔127.0.0.1 aliases.
- `AUTH_ALLOWED_AUDIENCES` — merges `AUTH_ALLOWED_AUDIENCES_STRING` with client IDs and adds `account` when Keycloak realm is detected.

### Validation and failure semantics
- Missing required env (via `getEnvRequired`) throws immediately at import time.
- Explicit `AUTH_ENABLED=true` with incomplete Keycloak env throws a startup error listing missing keys.
- Stdio mode with `AUTH_ENABLED=true` or `QDRANT_URL` set throws via `assertStdioConfigConsistency`.
- Unset `QDRANT_URL` falls back to embedded LanceDB; `QDRANT_URL` is required when calling `getQdrantUrl()`.

### Secrets handling
- Server secrets (Keycloak URLs, session secret, Qdrant API key) come exclusively from env.
- CLI secrets (bearer/refresh tokens) prefer the OS keyring; fall back to inline file storage with a one-time warning when keyring is unavailable.
- A `KEYCHAIN_TOKEN_PLACEHOLDER` sentinel marks keychain-backed tokens in the file.

### Conventions observed
- All env variable names are UPPER_SNAKE_CASE and documented in JSDoc comments next to their export.
- Boolean env values accept multiple truthy/falsy spellings (`true/false/1/0/yes/no/y/n`).
- String env values are trimmed before use.
- Comma-separated lists are split and filtered for empties.
- Defaults are always provided; unset env values never cause undefined behavior except where explicitly required.
- The `src/config/` subdirectory holds only small, focused modules that are re-exported from the central `src/config.ts` to keep the main config file within the project's max-lines budget.
- Runtime-mode resolution is kept side-effect-free and testable against a mock `NodeJS.ProcessEnv`.

### Rules enforced by the implementation
- `TRANSPORT_TYPE=stdio` cannot coexist with `AUTH_ENABLED=true` — enforced by `assertStdioConfigConsistency` throwing at startup.
- `TRANSPORT_TYPE=stdio` cannot coexist with `QDRANT_URL` set — enforced by the same check, because stdio mode assumes in-process single-user isolation.
- When `AUTH_ENABLED=true`, `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`, `AUTH_CALLBACK_BASE_URL`, and `SESSION_SECRET` must all be non-empty — enforced by the validation block in `src/config.ts`.
- `QDRANT_URL` is required whenever `getQdrantUrl()` is called — enforced by `getEnvRequired`.
- CLI API URL resolution order is fixed: `--url` flag > `SQUADRULES_API_URL` env > saved `defaultUrl` in config file > local sentinel — enforced by `getCliApiUrlDefault`.