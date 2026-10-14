---
kind: error_handling
name: 'Error Handling: SquadrulesError, Domain-Specific Error Classes, and Layered Response Formatting'
category: error_handling
scope:
    - '**'
source_files:
    - src/types/index.ts
    - src/utils/global-error-handlers.ts
    - src/http/http-error-handlers.ts
    - src/http/http-route-errors.ts
    - src/http/http-mcp-handler.ts
    - src/tools/forward-tool-error.ts
    - src/tools/mcp-runtime-error.ts
    - src/cli/auth-error.ts
    - src/cli/fetch-error.ts
    - src/services/embedding/providers.ts
    - src/tools/train-store.ts
---

## Approach

SquadRules uses a layered error model built on Node.js `Error` subclasses, with a central `SquadrulesError` type that carries a machine-readable `code`, an HTTP `statusCode`, and optional `details`. Errors are propagated as thrown exceptions through the call stack and converted to transport-specific responses at the boundary (HTTP Express, MCP JSON-RPC, CLI stdout). There is no use of `try/catch`/`throw` for control flow inside business logic; errors bubble up. Uncaught exceptions and unhandled promise rejections are captured globally and logged via the structured logger.

## Core Types

- `src/types/index.ts` — defines `SquadrulesError(message, code, statusCode=500, details?)`. Every domain-level failure in services should be a `SquadrulesError` so downstream layers can read `code` and `statusCode` uniformly.
- Domain-specific subclasses exist where the caller needs to distinguish behavior:
  - `AuthRequiredError` (`src/cli/auth-error.ts`) — signals a 401 requiring browser login; carries `loginUrl`.
  - `EmbeddingRateLimitError` (`src/services/embedding/providers.ts`) — wraps OpenAI/TEI 429s with `provider`, `httpStatus`, and `code` (e.g. `insufficient_quota`).
  - `TrainError` (`src/tools/train-store.ts`) — validation/store failures from the train pipeline, carrying its own `code` and `details`.

These classes all extend `Error` and set their own `name` property.

## Global Process-Level Handlers

`src/utils/global-error-handlers.ts::installGlobalErrorHandlers()` installs handlers for:
- `uncaughtException` — logs via `structuredLogger.error`, sets `process.exitCode = 1`, does NOT exit immediately (lets supervisor decide).
- `unhandledRejection` — logs via `structuredLogger.error`.
- `rejectionHandled` — warns when a previously unhandled rejection is later handled.
- `multipleResolves` — warns about multiple resolves on one promise.
- `warning` — forwards Node warnings (ExperimentalWarning, DeprecationWarning) as structured warnings.

The function is idempotent via an `installed` flag.

## HTTP Layer

`src/http/http-error-handlers.ts` registers a single Express `ErrorRequestHandler` (`globalErrorHandler`) that:
- Logs the error with request context (`x-request-id`, method, URL).
- Special-cases payload-too-large (`status === 413 || statusCode === 413 || type === 'entity.too.large'`) → `413 { error: 'PAYLOAD_TOO_LARGE', message }`.
- Falls back to `500 { error: 'Internal server error' }`.
- Also mounts a 405 handler for GET `/mcp` and a catch-all 404 route returning `{ error: 'Not found' }`.

`src/http/http-route-errors.ts::sendToolRouteError(res, error, fallbackErrorCode)` is the helper used by individual HTTP routes:
- Resolves status from `error.statusCode` / `error.status` (validated to be 400–599, else 500).
- For `SquadrulesError`, uses `error.code`; for 404 falls back to `'NOT_FOUND'`; otherwise uses `fallbackErrorCode`.
- Spreads `error.details` into the response body.

## MCP JSON-RPC Layer

`src/http/http-mcp-handler.ts` maps errors to MCP tool results:
- `SquadrulesError` → `error_code: error.code`.
- Connection conflicts → `CONNECTION_CONFLICT`.
- Overloaded → `OVERLOADED` with `retry_hint`.
- Fallback → `SERVER_ERROR`.
- The comment documents that `error_code` is part of the client contract and internal details are never exposed.

`src/tools/mcp-runtime-error.ts::mcpRateLimitErrorResult(error)` converts an `EmbeddingRateLimitError` into an MCP `{ isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'EMBEDDING_RATE_LIMIT', provider, http_status, code, message, retry_hint }) }] }` so clients parse a structured payload instead of a raw string that would break JSON parsing.

`src/tools/forward-tool-error.ts::formatForwardToolError(error)` serializes a `SquadrulesError` to `{ error, error_code, message, ...details }`.

## CLI Layer

`src/cli/auth-error.ts`:
- `handleApiError(error, openInBrowser?)` — if `error instanceof AuthRequiredError`, prints the message (without the default `"Error: "` prefix), optionally opens the login URL via `openBrowser()`, then calls `process.exit(1)`. All other errors go through `writeError` and also `process.exit(1)`.
- `openBrowser(url)` validates the URL (only `http:`/`https:`, no control characters) and launches a whitelisted system/browser binary (`ALLOWED_BROWSER_BINARIES` set). `BROWSER` env var is sanitized against shell metacharacters; unsafe overrides fall back to the system opener.
- `isBrowserDisabled()` honors `SQUADRULES_NO_BROWSER=1` or `BROWSER=true|none|no|false|0`.

`src/cli/fetch-error.ts` provides helpers for undici network failures:
- `describeFetchError(err)` — extracts `err.cause` (e.g. `ECONNREFUSED`, `ENOTFOUND`) and appends it to the opaque `"fetch failed"` message.
- `isRetryableNetworkError(err)` — returns true for `AbortError`, `ECONNREFUSED`/`ECONNRESET`/`EPIPE`/`ENOTFOUND`/`UND_ERR_CONNECT_TIMEOUT`, or any `TypeError` whose message contains `fetch`/`network`.
- `networkErrorWithHint(prefix, err)` — wraps the original error with a user-facing hint including reachability advice.

## Business-Layer Retry & Rate-Limiting

`src/services/embedding/providers.ts` implements retry semantics around embedding provider calls:
- `isRetriableNetworkError` matches tokens like `fetch failed`, `timed out`, `econnreset`, `econnrefused`, `enotfound`, `eai_again`.
- `isRetriableHttpStatus` accepts 429, 502, 503, 504.
- `parseRetryAfterMs` reads `retry-after-ms` then `retry-after` headers.
- `computeBackoffMs` — exponential backoff with full jitter capped at `EMBEDDING_RETRY_MAX_DELAY_MS`.
- `computeRetryDelayMs` — honors `Retry-After` (capped by `EMBEDDING_RETRY_AFTER_CAP_MS`) or falls back to jittered exponential backoff.
- `isOpenAiNonRetriableQuota` — treats `insufficient_quota` as non-retriable (billing problem).
- `computeDeadline` / `isBudgetExceeded` enforce a wall-clock retry budget (`EMBEDDING_RETRY_BUDGET_MS`).
- `fetchWithRetries` retries transient network errors up to `EMBEDDING_MAX_RETRIES`.
- OpenAI 429 with `insufficient_quota` throws `EmbeddingRateLimitError` immediately; other 429s are retried and then wrapped in `EmbeddingRateLimitError`.

## Conventions Observed

- Domain errors are thrown as exceptions carrying a stable string `code` (e.g. `INVALID_SLUG`, `DUPLICATE_ADAPTER`, `MEMORY_NOT_FOUND`, `QDRANT_UNAVAILABLE`, `QDRANT_OPERATION_ERROR`, `PROTOCOL_STRUCTURE_INVALID`, `UNSUPPORTED_MIME`, `MISSING_REQUIRED_FIELD`, `INVALID_FIELD_TYPE`). These codes are consumed by HTTP/MCP/CLI layers to produce consistent payloads.
- `SquadrulesError` is the canonical base for application-domain errors; domain-specific subclasses are used only when the caller needs to branch on the exception type (auth, embedding rate limit, train validation).
- HTTP routes do not return plain strings on error — they use `sendToolRouteError` or the global Express handler, which always emit JSON with at least `{ error, message }` and spread `details` when present.
- MCP endpoints never expose internal error details; they map to documented `error_code` values (`CONNECTION_CONFLICT`, `OVERLOADED`, `SERVER_ERROR`, `EMBEDDING_RATE_LIMIT`) plus optional `retry_hint`.
- CLI errors terminate the process via `process.exit(1)` after writing to stderr; they do not throw past the command entry point.
- Network-layer failures are surfaced with actionable detail (underlying errno + reachability hint) rather than bare `"fetch failed"`.
- Global process error hooks are installed once and log without crashing the process, deferring termination to the supervisor.