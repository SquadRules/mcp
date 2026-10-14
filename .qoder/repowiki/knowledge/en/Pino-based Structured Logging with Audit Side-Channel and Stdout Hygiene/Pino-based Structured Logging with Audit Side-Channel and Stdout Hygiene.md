---
kind: logging_system
name: Pino-based Structured Logging with Audit Side-Channel and Stdout Hygiene
category: logging_system
scope:
    - '**'
source_files:
    - src/utils/structured-logger.ts
    - src/utils/log-core.ts
    - src/cli/log-sink-prelude.ts
    - src/config.ts
    - docs/adr/0008-bare-cli-defaults-to-stdio-and-console-log-hygiene.md
---

## What system/approach is used

SquadRules uses **Pino** as its structured JSON logging backend, wrapped by a shared `StructuredLoggerApi` (`src/utils/structured-logger.ts`) that adds application-level fields (`category`, `tool`, `operation`, `success`, `timeout`, HTTP access fields) and an audit side-channel. The base Pino instance is created in `src/utils/log-core.ts`, which is the single source of truth for `LOG_LEVEL`, `LOG_FORMAT`, and `TRANSPORT_TYPE`. Output routing goes through a custom text-format stream that renders pino's numeric levels (30/40/50) into human-readable `[INFO ] [WARN ] [ERROR ]` labels.

## Key files and packages

- `src/utils/log-core.ts` — singleton Pino factory; redaction paths, serializers for `req`/`res`, stdout vs stderr selection via `shouldLogToStderr(transportType, forceStderr)`.
- `src/utils/structured-logger.ts` — `StructuredLoggerApi` wrapper around Pino: `debug/info/warn/error`, plus domain helpers `tool()`, `success()`, `requestTimeout()`, `child()`, `getTransportType()`, `getLogFormat()`, `getPinoLogger()`; also exposes `httpLogger` middleware and `writeAuditLine()`.
- `src/cli/log-sink-prelude.ts` — MUST be the first import in `cli/index.ts`; sets `SQUADRULES_LOG_STDERR=1` so CLI logs go to stderr even when `TRANSPORT_TYPE=http` resolves at boot time.
- `src/config.ts` — env-backed constants `LOG_LEVEL` (default `'info'`), `LOG_FORMAT` (default `'text'`), `AUDIT_LOG_LEVEL` (clamped 0..3).
- `docs/adr/0008-bare-cli-defaults-to-stdio-and-console-log-hygiene.md` — ADR documenting why stdout is reserved for MCP protocol frames and console log hygiene rules.
- `src/utils/audit-log-events.ts` + `src/utils/audit-mcp-summary.ts` — audit line serialization consumed by `maybeWriteAuditLine`.

## Architecture and conventions

### Two-tier sink model

1. **Console sink** — Pino writes to `process.stdout` in HTTP mode or `process.stderr` in stdio mode (or whenever `SQUADRULES_LOG_STDERR=1`). In text mode a custom `Writable` parses each JSON line and re-emits a `[HH:MM:SS] [LEVEL] msg` line; in JSON mode the raw JSON lines pass through unchanged.
2. **Audit side-channel** — Every `info`, `warn`, and `error` call on the structured logger passes bindings through `sanitizeBindingsForAudit` → `toSafeAuditValue` → `buildAuditLine`, then appends to `AUDIT_LOG_FILE` (opened once at module load if configured). This is independent of `LOG_LEVEL`: audit records are written regardless of console level.

### Sanitization pipeline

All bindings flow through a defense-in-depth sanitizer before reaching any sink:
- `sanitizeLogMessage` strips CR/LF and CTL characters from strings (CodeQL log-injection mitigation).
- `sanitizeBindingKey` caps keys at 256 chars and replaces empty keys with `_key`.
- `toSafeAuditValue` recursively walks objects up to `MAX_AUDIT_DEPTH=4`, limits arrays to one sampled item, truncates object entries to `MAX_AUDIT_KEYS=40`, and serializes `Error` as `{name, message, stack?}`.
- `cloneSafeRecordForPino` does a `JSON.parse(JSON.stringify(...))` round-trip so no prototype or unexpected getters reach Pino's serializer.

### Redaction

Pino's built-in `redact.paths` removes sensitive fields at the base logger: `req.headers.authorization`, `*.password`, `*.secret`, `user.ssn`, `req.headers.cookie`, `res.headers["set-cookie"]`. Values are replaced with `[REDACTED]`.

### HTTP access logging

The `httpLogger` middleware attached in the HTTP layer attaches a `requestId` (from `x-request-id` or generated), captures client IP (respecting `TRUSTED_PROXY_CIDRS` and `X-Forwarded-For`), emits an `info` line on request start and a level-selected line (`info`/`warn`/`error` based on status code) on response finish. Fields include `http.method`, `http.path`, `http.protocol`, `status`, `response_time_ms`, `client.ip`, `user_agent`, `request_id`.

### Transport-aware output routing

`log-core.shouldLogToStderr` returns true when `TRANSPORT_TYPE === 'stdio'` or `SQUADRULES_LOG_STDERR=1`. The CLI prelude forces stderr for all CLI-invoked processes because stdout is the MCP data channel; the spawned `serve` child overrides this per its own transport.

### Error logging convention

`error(message, error?, options?)` accepts an optional `ErrorLogOptions` with `error_code` and `request_id`; the error object is normalized to `{message, stack?}` where `stack` is included only when `LOG_LEVEL==='debug'` or `NODE_ENV==='development'`.

### Domain helpers

- `tool(toolName, operation, details)` — emits `category: 'tool_operation'` with `tool` and `operation.toUpperCase()`.
- `success(operation, details)` — emits `category: 'success'`.
- `requestTimeout(operation, timeoutMs)` — emits `category: 'timeout'` with a note that the client did not receive a response.

## Conventions and constraints

- **stdout is reserved for MCP protocol frames.** Nothing may write to stdout except the JSON-RPC transport. All logs go to stderr in stdio mode or when `SQUADRULES_LOG_STDERR=1`. Enforced by `log-core.shouldLogToStderr` and the CLI prelude comment "MUST be the first import in `cli/index.ts`".
- **CLI prelude must run before any other import.** `src/cli/log-sink-prelude.ts` sets `SQUADRULES_LOG_STDERR=1` before the module graph eagerly creates the logger singleton in `utils/structured-logger.ts`; otherwise HTTP-mode `TRANSPORT_TYPE` would route logs to stdout and corrupt payloads like `activate ... | jq`.
- **Text format maps pino numeric levels to labels.** The text-format stream converts pino's numeric levels (30, 40, 50) to `[INFO ]`, `[WARN ]`, `[ERROR ]` using `pino.levels.labels` (ADR 0008).
- **Audit log is independent of console level.** `maybeWriteAuditLine` is called from every `info`, `warn`, and `error` path regardless of `LOG_LEVEL`; audit records continue even when console output is filtered.
- **Sensitive fields are redacted at the Pino layer.** The `REDACT_PATHS` array in `log-core.ts` censors authorization headers, passwords, secrets, SSN, cookies, and set-cookie responses.
- **Audit records are bounded.** Max line length 65536 bytes, max depth 4, max keys 40, max string length 2048 — enforced by `MAX_AUDIT_LINE_BYTES`, `MAX_AUDIT_DEPTH`, `MAX_AUDIT_KEYS`, `MAX_AUDIT_STRING_LEN`.
- **Environment variables:** `LOG_LEVEL` (default `'info'`), `LOG_FORMAT` (default `'text'`), `AUDIT_LOG_LEVEL` (default 1, clamped 0..3), `AUDIT_LOG_FILE`, `TRUSTED_PROXY_CIDRS`, `SQUADRULES_LOG_STDERR=1`.