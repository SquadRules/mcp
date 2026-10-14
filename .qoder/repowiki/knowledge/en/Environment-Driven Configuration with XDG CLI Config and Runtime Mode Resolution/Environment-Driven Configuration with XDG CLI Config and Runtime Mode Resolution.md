---
kind: configuration_system
name: Environment-Driven Configuration with XDG CLI Config and Runtime Mode Resolution
category: configuration_system
scope:
    - '**'
source_files:
    - src/config.ts
    - src/config/runtime-mode.ts
    - src/config/embedding-fastembed.ts
    - src/config/mem-boot.ts
    - src/cli/config.ts
    - src/cli/config-file.ts
    - src/cli/config-file-internals.ts
    - src/cli/config-file-write.ts
    - src/cli/keyring.js
---

## Overview

SquadRules uses a two-tier configuration system:

1. **Runtime configuration** — process-wide, environment-variable-driven constants consumed by the HTTP server, MCP tools, services, and embedded UI.
2. **CLI configuration** — on-disk XDG-compliant JSON file plus OS keyring-backed secrets for `squadrules` CLI commands.

There is no YAML/TOML/`.env` parser; all runtime settings are read directly from `process.env` at module load time in `src/config.ts`, with a small set of dedicated submodules under `src/config/` for concerns that exceed the main file's line budget.

## Core files

- `src/config.ts` — single source of truth for every runtime constant (Redis/Qdrant/OpenAI/TEI/fastembed, OIDC/Keycloak auth, rate limits, search thresholds, metrics port, audit log level, etc.). Exposes typed helpers `getEnvRequired`, `getEnvString`, `getEnvInt`, `getEnvFloat`, `getEnvBoolean`.
- `src/config/runtime-mode.ts` — pure-function resolution of `TRANSPORT_TYPE` (`stdio` | `http`) and `AUTH_ENABLED` based on env, plus validation that stdio mode does not have Qdrant or auth enabled.
- `src/config/embedding-fastembed.ts` — fastembed model name and cache directory defaults.
- `src/config/mem-boot.ts` — `MEM_BOOT_FORCE_INJECT` escape hatch for re-injecting shipped adapters.
- `src/config/export-download-settings.ts`, `src/config/export-zip-settings.ts`, `src/config/adapter-markdown-size-limits.ts` — additional config slices following the same pattern.
- `src/cli/config.ts` — resolves the API URL for CLI commands: `SQUADRULES_API_URL` → saved `defaultUrl` → local sentinel.
- `src/cli/config-file.ts` — reads/writes the XDG config file, migrating old flat shape to multi-environment shape, and delegating bearer/refresh tokens to the OS keyring when available.
- `src/cli/config-file-internals.ts`, `src/cli/config-file-write.ts`, `src/cli/keyring.js` — parsing, writing, and platform keyring access.

## Architecture and conventions

### Environment variable parsing
All runtime values go through four helpers in `src/config.ts`:
- `getEnvRequired(key, message?)` — throws if missing/empty.
- `getEnvString(key, default)` — returns trimmed string or default.
- `getEnvInt(key, default)` — parses base-10 integer, falls back to default on NaN.
- `getEnvFloat(key, default)` — parses float, falls back to default on NaN.
- `getEnvBoolean(key, default)` — recognizes `true/1/yes/y` and `false/0/no/n` (case-insensitive); unparseable values return the default.

Derived/computed values (e.g. `AUTH_TRUSTED_ISSUERS`, `AUTH_ALLOWED_AUDIENCES`, `GROUP_SPACE_PATH_EXAMPLE`, `OIDC_SCOPES_SUPPORTED`, `QDRANT_SNAPSHOT_DIR`, `SQUADRULES_LOCAL_ARTIFACT_DIRS`) are computed at module-load time after the raw env vars are read.

### Runtime mode as a first-class concept
`src/config/runtime-mode.ts` defines two mutually exclusive modes:
- **simple** (`TRANSPORT_TYPE=stdio`): local single-user MCP server, embedded LanceDB only, no HTTP listener, no OIDC callback surface.
- **cluster** (`TRANSPORT_TYPE=http`): deployed posture with REST API, Streamable HTTP MCP, browser UI, metrics, and authentication on by default.

Transport selection priority: explicit `TRANSPORT_TYPE` > `SQUADRULES_MCP_STDIO=1` (set by `squadrules-mcp` bin) > `SQUADRULES_CLI_SERVE=1` (set by `squadrules serve`) > default `http`.
Auth follows mode unless explicitly overridden: `AUTH_ENABLED=true` in stdio is rejected via `assertStdioConfigConsistency`, which throws a startup error listing violations (auth enabled + Qdrant configured).

### Feature flags and switches
Feature toggles are plain env booleans:
- `EMBEDDING_PROVIDER` (`auto` | `openai` | `tei` | `fastembed`)
- `SQUADRULES_ENABLE_GROUP_COLLAPSE`
- `SQUADRULES_MCP_WIDGET_PRESENTATION_ONLY`
- `QDRANT_SNAPSHOT_ON_START`
- `MEM_BOOT_FORCE_INJECT` (repair path for shipped adapters)
- `AUTH_MODE` (`oidc_bearer` enables strict Bearer token validation)

### CLI config file format
The CLI stores per-environment credentials in an XDG-compliant JSON file. The current schema supports multiple environments keyed by normalized API URL:
```json
{
  "defaultUrl": "http://localhost:3000",
  "environments": {
    "http://localhost:3000": { "bearerToken": "__KEYCHAIN__", "refreshToken": "__KEYCHAIN__" }
  }
}
```
Tokens are stored in the OS keyring when available; the file contains `__KEYCHAIN__` placeholders instead of inline secrets. If the keyring is unavailable, secrets fall back to inline storage with a one-time warning. Old single-env flat shapes (`{ SQUADRULES_API_URL, bearerToken }`) are auto-migrated on first write.

### Secrets handling
- Runtime secrets (OpenAI key, Keycloak client secret, session secret) are read from env only — never persisted to disk by the runtime.
- CLI bearer/refresh tokens are preferentially stored in the OS keyring via `src/cli/keyring.js`.
- Audit logging can be written to a file controlled by `AUDIT_LOG_FILE`.

### Backend selection via env
- Redis/key-value store: `KEY_VALUE_STORE_URL` or `REDIS_URL` set → network backend; else in-memory.
- Vector store: `QDRANT_URL` set → external Qdrant; else embedded LanceDB.
- Embedding provider: `EMBEDDING_PROVIDER=auto` prefers configured external provider, else fastembed local default.

## Conventions and constraints

- All runtime configuration lives in `src/config.ts` (and its `src/config/*` siblings); consumers import exported constants rather than reading `process.env` directly.
- Boolean env values accept `true/1/yes/y` and `false/0/no/n` (case-insensitive); any other value falls back to the declared default — this is enforced by `getEnvBoolean`.
- Required env vars are validated at startup via `getEnvRequired` or explicit checks (e.g. `AUTH_ENABLED=true` requires `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`, `AUTH_CALLBACK_BASE_URL`, `SESSION_SECRET`).
- `TRANSPORT_TYPE=stdio` with `AUTH_ENABLED=true` or `QDRANT_URL` set is rejected at startup by `assertStdioConfigConsistency` (throws an error listing the violations).
- CLI API URL resolution order is fixed: `SQUADRULES_API_URL` env → saved `defaultUrl` in config file → local sentinel (`LOCAL_TARGET`).
- Config file paths follow XDG conventions via `getConfigPath()` in `config-file-internals.ts`.
- New config concerns exceeding the main file's line budget are split into sibling modules under `src/config/` and re-exported from `config.ts` (embedding-fastembed, mem-boot, export settings, adapter size limits).
- Runtime mode resolution functions in `runtime-mode.ts` take an explicit `NodeJS.ProcessEnv` argument so they are pure and unit-testable without touching `process.env`.