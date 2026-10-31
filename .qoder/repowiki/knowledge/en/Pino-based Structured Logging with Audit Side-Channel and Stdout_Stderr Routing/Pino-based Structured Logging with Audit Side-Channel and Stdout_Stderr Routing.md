---
kind: logging_system
name: Pino-based Structured Logging with Audit Side-Channel and Stdout/Stderr Routing
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

## System Overview

SquadRules uses **Pino** as the structured logging backend, wrapped by a shared `structured-logger.ts` API that adds audit-side-channel writes, request-scoped fields, sanitization, and transport-aware sinks. The core is configured once via environment variables and consumed uniformly across HTTP, CLI, stdio, and services.

## Key Files

- `src/utils/log-core.ts` — single source of truth for Pino initialization: level, timestamp format (`isoTime`), redaction paths, serializers for Express `req`/`res`, and stdout/stderr routing based on `TRANSPORT_TYPE` and `SQUADRULES_LOG_STDERR`.
- `src/utils/structured-logger.ts` — public `StructuredLoggerApi` (`debug/info/warn/error/tool/success/requestTimeout/child/getPinoLogger`) wrapping the base Pino logger; also provides `httpLogger` middleware and `writeAuditLine` for audit-file side-channel writes.
- `src/cli/log-sink-prelude.ts` — MUST be the first import in `cli/index.ts`; sets `SQUADRULES_LOG_STDERR=1` so CLI logs go to stderr (stdout is reserved for MCP protocol frames per ADR 0008).
- `src/config.ts` — exposes `LOG_LEVEL` (default `'info'`), `LOG_FORMAT` (default `'text'`), `AUDIT_LOG_FILE`, and `AUDIT_LOG_LEVEL` (0–3) from environment.
- `docs/adr/0008-bare-cli-defaults-to-stdio-and-console-log-hygiene.md` — documents the stdout-reservation rule and console log hygiene decisions.

## Architecture and Conventions

### Logger lifecycle

1. `log-core.ts` lazily creates one shared Pino instance via `getBaseLogger()`.
2. `structured-logger.ts` wraps it in `wrapPino()` exposing a typed API plus `child()` composition.
3. All modules import `structuredLogger` (or `logger`, an alias); direct Pino usage is confined to the core.

### Sink routing

- In **HTTP mode** (`TRANSPORT_TYPE=http`): Pino writes to `process.stdout` (container-friendly).
- In **stdio mode** (`TRANSPORT_TYPE=stdio`): Pino writes to `process.stderr` so MCP JSON-RPC frames on stdout stay parseable.
- CLI overrides this globally via `SQUADRULES_LOG_STDERR=1` before any module graph loads, ensuring data-command payloads (`activate | jq`, etc.) are never polluted by boot INFO lines.
- Text format is rendered by a custom `Writable` stream in `log-core.ts` that parses each JSON line and emits `[HH:MM:SS] [LEVEL] msg`, mapping pino numeric levels (30/40/50) to human-readable labels.

### Structured fields

The logger enforces consistent field shapes:

- HTTP access logs include `time`, `http.{method,path,protocol}`, `client.ip`, `user_agent`, `request_id`, `status`, `response_time_ms`.
- Tool operations use `tool`, `operation`, `details`, `category: 'tool_operation'`.
- Success events use `category: 'success'`.
- Timeout events use `category: 'timeout'` with `timeoutMs`.
- Errors attach `error.{message,stack}` (stack only when `LOG_LEVEL=debug` or `NODE_ENV=development`).
- Every log gets a `category` field injected automatically if missing.

### Redaction and sanitization

- Pino-level redaction via `redact.paths`: `req.headers.authorization`, `*.password`, `*.secret`, `user.ssn`, `req.headers.cookie`, `res.headers["set-cookie"]` → replaced with `[REDACTED]`.
- Free-form messages pass through `sanitizeLogMessage()`: strips CR/LF, CTL characters (`\x00-\x1f`), collapses whitespace, truncates at 32 KB.
- Object bindings passed to audit sink are deep-sanitized via `toSafeAuditValue()` with caps: max depth 4, max keys 40, max string length 2048, max key length 256, arrays reduced to `{kind,item_count,first_item}`.
- Before writing to Pino, records are cloned via `JSON.parse(JSON.stringify(...))` to strip prototype chains and unexpected getters (defense-in-depth against malicious binding keys).

### Audit side-channel

When `AUDIT_LOG_FILE` is set, every `info`/`warn`/`error` call is mirrored to a separate file stream via `maybeWriteAuditLine`. The audit writer is isolated from the request path — failures are silently swallowed. Audit entries are built by `buildAuditLine` from `utils/audit-log-events.js` and gated by `AUDIT_LOG_LEVEL` (0–3). The `writeAuditLine(level, bindings)` export lets other modules emit audit records directly.

### Log levels

- Configurable via `LOG_LEVEL` env var (defaults to `info`).
- Levels used in code: `debug`, `info`, `warn`, `error`.
- `debug` is additionally enabled for stack traces when `NODE_ENV=development` regardless of `LOG_LEVEL`.

## Conventions and Constraints

- **Rule (enforced by ADR 0008 and `log-sink-prelude.ts`):** stdout must not receive log output in CLI/data-command contexts; all logs go to stderr. The prelude comment states "MUST be the first import in `cli/index.ts`", and the integration test `tests/integration/mode/stdio/stdio-launch-smooth.test.ts` asserts `startupStdout === ''`.
- **Rule (enforced by `structured-logger.ts`):** every log message passes through `sanitizeLogMessage` before reaching Pino, preventing log injection via CR/LF/CTL characters.
- **Rule (enforced by `structured-logger.ts`):** object bindings written to the audit file are deep-sanitized via `toSafeAuditValue`, which caps nesting depth, key count, string length, and replaces non-primitive structures with summaries.
- **Convention:** modules use the shared `structuredLogger` API rather than calling Pino directly; new structured fields should follow the existing `category` + domain-specific shape pattern.
- **Convention:** HTTP request tracing uses `x-request-id` header (generated if absent) and attaches it to every log line in the request scope.
- **Convention:** sensitive headers/values are redacted at the Pino serializer/redaction layer rather than stripped at call sites.