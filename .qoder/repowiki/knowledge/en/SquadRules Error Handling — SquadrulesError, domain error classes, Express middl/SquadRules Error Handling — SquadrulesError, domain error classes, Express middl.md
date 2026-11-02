---
kind: error_handling
name: SquadRules Error Handling — SquadrulesError, domain error classes, Express middleware, and process-level guards
category: error_handling
scope:
    - '**'
source_files:
    - src/types/index.ts
    - src/http/http-error-handlers.ts
    - src/http/http-route-errors.ts
    - src/tools/forward-tool-error.ts
    - src/tools/mcp-runtime-error.ts
    - src/cli/auth-error.ts
    - src/cli/fetch-error.ts
    - src/utils/global-error-handlers.ts
    - src/services/embedding/providers.ts
    - src/services/qdrant/connection.ts
    - src/services/memory/store-adapter-helpers.ts
---

## Overview

SquadRules uses a layered error-handling model:

1. **Domain errors** are expressed as typed `Error` subclasses (primarily `SquadrulesError`) carrying a stable machine-readable `code`, an HTTP-equivalent `statusCode`, and optional structured `details`.
2. **Transport-specific adapters** convert those domain errors into the wire format of each boundary: MCP tool results, REST JSON payloads, or CLI stderr messages.
3. **Express middleware** provides a global unhandled-error handler plus per-route helpers that map errors to HTTP status codes and JSON bodies.
4. **Process-level guards** in `src/utils/global-error-handlers.ts` log uncaught exceptions, unhandled promise rejections, multiple-resolve warnings, and Node warnings through the structured logger without crashing immediately.

There is no centralized error-code registry; codes are string literals attached at the call site (e.g. `'INVALID_SLUG'`, `'DUPLICATE_ADAPTER'`, `'MEMORY_NOT_FOUND'`, `'QDRANT_UNAVAILABLE'`, `'QDRANT_OPERATION_ERROR'`).

## Core types

- `SquadrulesError` (`src/types/index.ts`) — the base domain error with constructor `(message, code, statusCode = 500, details?)`. It sets `name = 'SquadrulesError'` and exposes `code`, `statusCode`, and `details`.
- `AuthRequiredError` (`src/cli/auth-error.ts`) — CLI-only error carrying a `loginUrl`; handled specially by `handleApiError` to print the message without the `Error:` prefix and optionally open the browser.
- `EmbeddingRateLimitError` (`src/services/embedding/providers.ts`) — wraps provider rate-limit responses with `provider`, `httpStatus`, and `code` so `mcpRateLimitErrorResult` can emit a structured MCP error payload.
- `TrainError` (`src/tools/train-store.ts`) — used by the CLI's local backend to translate training failures into user-facing messages.
- `EmbeddingWidthMismatchError`, `EmbeddingSchemaInvalidError` (`src/services/vector-store/lancedb/lance-width-validation.ts`) — vector-store schema validation errors.

## HTTP layer

`src/http/http-error-handlers.ts` registers a single Express `ErrorRequestHandler` via `app.use(globalErrorHandler)`:

- Logs the error through `structuredLogger.error` with `request_id`, `http_method`, `http_url`.
- Special-cases 413 / `entity.too.large` → `{ error: 'PAYLOAD_TOO_LARGE', message }`.
- All other unhandled errors → `500 Internal server error`.
- Also installs a `/mcp` GET handler returning `405 Method Not Allowed - use POST /mcp` and a catch-all 404 returning `{ error: 'Not found' }`.

`src/http/http-route-errors.ts` provides `sendToolRouteError(res, error, fallbackErrorCode)`:

- If `error instanceof SquadrulesError`, uses `error.statusCode` (clamped to 4xx/5xx) and `error.code`.
- Otherwise inspects `err.status` / `err.statusCode` on any object, defaulting to 500.
- Emits `{ error, message, ...details }` where `details` is spread from `SquadrulesError.details` when present.
- For non-`SquadrulesError` 404s, forces `error: 'NOT_FOUND'`.

## MCP tool layer

`src/tools/forward-tool-error.ts` — `formatForwardToolError(error: SquadrulesError)` returns `{ error, error_code, message, ...details }`, the shape consumed by the forward tool's result serialization.

`src/tools/mcp-runtime-error.ts` — `mcpRateLimitErrorResult(error)` detects `EmbeddingRateLimitError` and returns an MCP `isError: true` content block whose text is a JSON string containing `EMBEDDING_RATE_LIMIT`, provider, http_status, code, message, and a `retry_hint` distinguishing quota exhaustion from transient throttling. Non-matching errors return `null` so callers preserve existing rethrow behavior.

## CLI layer

`src/cli/auth-error.ts` centralizes auth failure handling:

- `AuthRequiredError` carries `loginUrl`.
- `handleApiError(error, openInBrowser?)` prints the message to stderr and calls `process.exit(1)`; for `AuthRequiredError` it also opens the login URL via `openBrowser` (with `BROWSER` allowlist and `SQUADRULES_NO_BROWSER` / `BROWSER=true|none|no|false|0` disabling).
- Browser launch is restricted to an explicit allowlist of binaries (`brave`, `chrome`, `firefox`, `open`, `xdg-open`, `rundll32.exe`, …) and rejects URLs with control characters or non-http(s) protocols.

`src/cli/fetch-error.ts` provides undici-specific helpers:

- `describeFetchError(err)` — appends the underlying `cause.code` + `cause.message` to opaque `TypeError: fetch failed` messages.
- `isRetryableNetworkError(err)` — recognizes `AbortError`, `ECONNREFUSED`, `ECONNRESET`, `EPIPE`, `ENOTFOUND`, `UND_ERR_CONNECT_TIMEOUT`, and generic `TypeError` with `fetch|network` in the message.
- `networkErrorWithHint(prefix, err)` — wraps an error with reachability guidance pointing at `--url` / `SQUADRULES_API_URL`.

## Process-level guards

`src/utils/global-error-handlers.ts::installGlobalErrorHandlers()` installs handlers once (guarded by an `installed` flag):

- `uncaughtException` — logs via `structuredLogger.error`, sets `process.exitCode = 1`, does NOT exit immediately (allows supervisor to decide).
- `unhandledRejection` — logs via `structuredLogger.error`.
- `rejectionHandled` — warns that a previously-unhandled rejection was later handled.
- `multipleResolves` — warns with serialized value and stack.
- `warning` — converts Node warnings (ExperimentalWarning, DeprecationWarning, …) into structured-log entries.

All handlers wrap their body in `try/catch` so logging itself cannot crash the process.

## Conventions observed

- Domain-layer code throws `new SquadrulesError(message, CODE, STATUS_CODE, details?)` rather than bare `Error`s; business logic lives in `src/services/*` and `src/tools/*`.
- Transport boundaries (HTTP routes, MCP tools, CLI) do not inspect `SquadrulesError` internals directly — they go through `sendToolRouteError`, `formatForwardToolError`, or `handleApiError`.
- HTTP error responses are always JSON objects with at least `error` and `message` fields; `SquadrulesError.details` is spread into the response body.
- The global Express error handler only handles truly unhandled cases; route-level handlers are expected to convert known errors before reaching it.
- Network failures from undici are surfaced with their underlying errno code rather than the generic `fetch failed` message.
- Auth-required flows in the CLI terminate the process via `process.exit(1)` after writing the actionable message to stderr.
- Global process-level error handlers are idempotent (single-install guard) and deliberately avoid exiting on uncaught exceptions, delegating lifecycle decisions to the supervisor.