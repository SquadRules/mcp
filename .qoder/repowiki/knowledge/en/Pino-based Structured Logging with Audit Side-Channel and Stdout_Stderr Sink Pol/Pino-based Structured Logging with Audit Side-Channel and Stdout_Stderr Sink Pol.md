---
kind: logging_system
name: Pino-based Structured Logging with Audit Side-Channel and Stdout/Stderr Sink Policy
category: logging_system
scope:
    - '**'
source_files:
    - src/utils/log-core.ts
    - src/utils/structured-logger.ts
    - src/cli/log-sink-prelude.ts
    - src/config.ts
    - docs/adr/0008-bare-cli-defaults-to-stdio-and-console-log-hygiene.md
---

## System Overview

SQUADRULES MCP uses **Pino** as the sole logging framework. All log output is structured JSON (with an optional human-readable text formatter) emitted through a shared singleton `pino.Logger` created in `src/utils/log-core.ts`. A thin wrapper in `src/utils/structured-logger.ts` adds application-level conventions: sanitization, audit-side-channel writes, HTTP access logging, and a stable API surface (`debug/info/warn/error/tool/success/requestTimeout`).

## Key Files

- `src/utils/log-core.ts` — single source of truth for Pino configuration: level, timestamp format, redaction paths, serializers, and stdout/stderr destination selection.
- `src/utils/structured-logger.ts` — application-facing logger API, HTTP middleware, audit-line writer, and binding sanitizer.
- `src/cli/log-sink-prelude.ts` — MUST be imported first by `cli/index.ts`; forces `SQUADRULES_LOG_STDERR=1` so CLI logs never corrupt stdout data payloads.
- `src/config.ts` — exposes `LOG_LEVEL`, `LOG_FORMAT`, `AUDIT_LOG_LEVEL`, `AUDIT_LOG_FILE`, `TRANSPORT_TYPE` consumed by the logger.
- `docs/adr/0008-bare-cli-defaults-to-stdio-and-console-log-hygiene.md` — authoritative design decision documenting why stdout is reserved for MCP protocol frames and how console log hygiene was achieved.

## Architecture

### Logger initialization

`getBaseLogger()` in `log-core.ts` lazily creates one global Pino instance. The sink destination is chosen by `shouldLogToStderr(transportType, forceStderr)`:

- In `stdio` transport mode → stderr.
- In `http` transport mode → stdout (container convention).
- `SQUADRULES_LOG_STDERR=1` overrides to stderr regardless of transport (used by the CLI prelude).

The text-format stream parses each JSON line and re-emits it as `[HH:MM:SS] [LEVEL] msg`, mapping Pino's numeric levels (30/40/50) to readable labels via `pino.levels.labels`. If parsing fails, the raw chunk is passed through unchanged.

Redaction is configured at the Pino level via `redact.paths`: `req.headers.authorization`, `*.password`, `*.secret`, `user.ssn`, `req.headers.cookie`, `res.headers["set-cookie"]` are replaced with `[REDACTED]`. Custom serializers strip `req`/`res` objects down to safe fields before serialization.

### Application API

`structured-logger.ts` wraps the base Pino logger in `wrapPino()`, exposing:

- `debug(info|bindings, message?)`
- `info(info|bindings, message?)`
- `warn(info|bindings, message?)`
- `error(message, error?, options?)` — supports `error_code` and `request_id` in options; stacks are included only when `LOG_LEVEL === 'debug'` or `NODE_ENV === 'development'`.
- `tool(toolName, operation, details)` — emits `{ tool, operation, category: 'tool_operation' }`.
- `success(operation, details)` — emits `{ operation, category: 'success' }`.
- `requestTimeout(operation, timeoutMs)` — emits `{ category: 'timeout', note: 'Client did not receive response' }`.
- `child(bindings)` — returns another wrapped logger with child Pino context.
- `getTransportType()`, `getLogFormat()`, `getPinoLogger()` — introspection helpers.

Every call path runs bindings through `sanitizeBindingsForAudit()` and messages through `sanitizeLogMessage()`, which strips CR/LF, collapses control characters, and truncates strings (default 32 KiB for messages, 2 KiB for audit values). Object keys are also sanitized to prevent injection via parsed JSON bindings.

### Audit side-channel

When `AUDIT_LOG_FILE` is set, `createWriteStream(AUDIT_LOG_FILE, { flags: 'a' })` opens a file handle at module load. `writeAuditLine(level, bindings)` serializes bindings through `toSafeAuditValue()` (depth ≤ 4, ≤ 40 keys per object, string length ≤ 2 KiB, arrays truncated to first item + count) and writes via `buildAuditLine()` from `utils/audit-log-events.ts`. Audit writes are fire-and-forget: failures are caught and never propagate to the request path. This allows audit records to flow independently of the console log level.

### HTTP access logging

`httpLogger(req, res, next)` is an Express middleware that:

- Generates or reads `x-request-id`.
- Extracts client IP from `socket.remoteAddress` / `req.ip` / `x-forwarded-for` (trusted proxy CIDRs honored via `TRUSTED_PROXY_CIDRS`).
- Emits an `info` record on request start and a `warn`/`info`/`error` record on `finish` based on status code (≥500 → error, ≥400 → warn, else info), including `response_time_ms`.

## Conventions and Constraints

- **Structured JSON is the default.** `LOG_FORMAT=text` produces a human-readable stream but still parses JSON lines internally; production containers typically use `LOG_FORMAT=json` so stdout is valid JSONL.
- **Levels:** Pino defaults apply (`LOG_LEVEL='info'`); `debug` is available for verbose operator tracing. Error stacks are suppressed unless `LOG_LEVEL==='debug'` or `NODE_ENV==='development'`.
- **stdout is reserved for MCP protocol frames.** Per ADR 0008, nothing except JSON-RPC messages may write to stdout in stdio mode. The CLI prelude enforces this by setting `SQUADRULES_LOG_STDERR=1` before any logger module is loaded. An integration test asserts bare invocation emits zero bytes on stdout.
- **Sensitive data redaction is automatic.** Authorization headers, cookies, passwords, secrets, and SSN fields are redacted by Pino's built-in redactor.
- **Audit logs are independent of console level.** Audit entries are written whenever `AUDIT_LOG_FILE` is configured, regardless of `LOG_LEVEL`, because they bypass the Pino level filter.
- **Binding safety is enforced at the sink boundary.** Every logger method sanitizes both keys and values before reaching Pino or the audit file, preventing log injection and unbounded memory growth.
- **HTTP client IP respects trusted proxies.** When `TRUSTED_PROXY_CIDRS` is set, only the first segment of `x-forwarded-for` is used; otherwise the socket remote address is used directly.