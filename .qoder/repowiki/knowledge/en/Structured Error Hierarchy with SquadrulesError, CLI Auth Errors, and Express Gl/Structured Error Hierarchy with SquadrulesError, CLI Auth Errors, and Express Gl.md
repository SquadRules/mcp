---
kind: error_handling
name: Structured Error Hierarchy with SquadrulesError, CLI Auth Errors, and Express Global Handlers
category: error_handling
scope:
    - '**'
source_files:
    - src/types/index.ts
    - src/http/http-error-handlers.ts
    - src/http/http-route-errors.ts
    - src/utils/global-error-handlers.ts
    - src/cli/auth-error.ts
    - src/cli/fetch-error.ts
    - src/tools/mcp-runtime-error.ts
    - src/tools/forward-tool-error.ts
---

## Overview

The SQUADRULES MCP Server Runtime uses a layered error-handling strategy:

1. A domain-level `SquadrulesError` class carries a machine-readable `code`, HTTP `statusCode`, and optional `details`.
2. The CLI defines its own `AuthRequiredError` for 401 flows that can open a login URL in a browser.
3. The HTTP layer centralizes unhandled exceptions via an Express `ErrorRequestHandler` plus dedicated route-error helpers.
4. Process-level safety nets (`uncaughtException`, `unhandledRejection`, `rejectionHandled`, `multipleResolves`, `warning`) are installed once through a shared utility.
5. Network-layer errors from undici/fetch are surfaced with their underlying `cause` so callers see actionable errno codes rather than a bare "fetch failed".

There is no `panic`/`recover` (this is TypeScript/Node.js); instead, failures propagate as thrown `Error` subclasses or plain `Error`s, caught at transport boundaries (Express middleware, CLI command handlers).

## Key Files

- `src/types/index.ts` — defines `SquadrulesError` (the canonical domain error type).
- `src/http/http-error-handlers.ts` — global Express `ErrorRequestHandler` + 404 catch-all.
- `src/http/http-route-errors.ts` — `sendToolRouteError` / `resolveHttpStatus` used by tool routes to serialize errors into JSON responses.
- `src/utils/global-error-handlers.ts` — installs process-wide `uncaughtException` / `unhandledRejection` / `rejectionHandled` / `multipleResolves` / `warning` listeners.
- `src/cli/auth-error.ts` — `AuthRequiredError` class, `handleApiError`, and safe browser-launch helpers.
- `src/cli/fetch-error.ts` — `describeFetchError`, `isRetryableNetworkError`, `networkErrorWithHint` for undici network failures.
- `src/tools/mcp-runtime-error.ts` — `mcpRateLimitErrorResult` converts embedding provider rate-limit errors into structured MCP tool error payloads.
- `src/tools/forward-tool-error.ts` — `formatForwardToolError` serializes `SquadrulesError` for the forward tool's output contract.

## Architecture and Conventions

### Domain error type: `SquadrulesError`

```ts
class SquadrulesError extends Error {
    constructor(message: string, code: string, statusCode: number = 500, details?: Record<string, any>)
}
```

Business logic across `services/memory/*`, `services/qdrant/*`, and other layers throws `SquadrulesError` with stable, uppercase `code` values such as `INVALID_SLUG`, `DUPLICATE_ADAPTER`, `MEMORY_NOT_FOUND`, `QDRANT_UNAVAILABLE`, `QDRANT_OPERATION_ERROR`, `INVALID_PAYLOAD_STRUCTURE`, `MISSING_REQUIRED_FIELD`, `INVALID_FIELD_TYPE`. The `statusCode` field drives the HTTP status; `details` is merged into the JSON response body.

### HTTP serialization

- `http-route-errors.ts::resolveHttpStatus` maps an error to a numeric status: if it is a `SquadrulesError`, use its `statusCode`; otherwise inspect `err.statusCode` / `err.status`; default to 500. Only statuses in `[400, 600)` are accepted — others fall back to 500.
- `sendToolRouteError` builds `{ error, message, ...details }` where `error` is `error.code` for `SquadrulesError`, `'NOT_FOUND'` for 404, or a caller-supplied fallback code.
- The global Express handler in `http-error-handlers.ts` catches all unhandled exceptions, logs them via `structuredLogger.error` with `request_id`, `http_method`, `http_url`, then responds with either `413 PAYLOAD_TOO_LARGE` (detected via `status === 413`, `statusCode === 413`, or `type === 'entity.too.large'`) or `500 Internal server error`.

### CLI error handling

- `AuthRequiredError` extends `Error` and adds a `loginUrl` property. It is thrown from `cli/api-client.ts` when the API returns 401.
- `handleApiError(error, openInBrowser?)` is the single exit point for CLI errors: it prints the `AuthRequiredError.message` (without the generic `Error:` prefix), optionally opens the login URL via the whitelisted-browser launcher, and calls `process.exit(1)`. All other errors go through `writeError` and also exit with code 1.
- Browser launching is constrained: only binaries in `ALLOWED_BROWSER_BINARIES` (brave, chrome, chromium, firefox, microsoft-edge, open, rundll32.exe, safari, xdg-open) are permitted unless the path is absolute and exists on disk. URLs are validated against control characters and must be `http:` or `https:`.
- `fetch-error.ts` provides retryability detection (`ECONNREFUSED`, `ECONNRESET`, `EPIPE`, `ENOTFOUND`, `UND_ERR_CONNECT_TIMEOUT`, `AbortError`, and opaque `TypeError: fetch|network` messages) and enriches error messages with the underlying `cause`.

### MCP tool error shaping

- `mcp-runtime-error.ts::mcpRateLimitErrorResult` detects `EmbeddingRateLimitError` and returns an MCP tool result shaped as `{ isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'EMBEDDING_RATE_LIMIT', provider, http_status, code, message, retry_hint }) }] }`, preventing raw 429 strings from breaking client-side `JSON.parse` of tool content.
- `forward-tool-error.ts::formatForwardToolError` normalizes `SquadrulesError` into the forward tool's response contract, including both `error` and `error_code` fields plus spread `details`.

### Process-level safety net

`installGlobalErrorHandlers()` (in `utils/global-error-handlers.ts`) is idempotent (`installed` flag). It forwards:
- `uncaughtException` → `structuredLogger.error`, sets `process.exitCode = 1` (does not call `process.exit` immediately, letting a supervisor decide).
- `unhandledRejection` → `structuredLogger.error`.
- `rejectionHandled` → `structuredLogger.warn`.
- `multipleResolves` → `structuredLogger.warn` with serialized value and stack trace.
- `warning` → `structuredLogger.warn`, wrapping Node warnings as `Error` objects preserving `name` and `stack`.

All loggers are wrapped in `try/catch` blocks so logging itself cannot crash the process.

## Conventions and Constraints

- **Domain errors use `SquadrulesError`** with a stable uppercase `code` string and an explicit `statusCode` between 400–599. This is observed throughout `services/memory/*` and `services/qdrant/*`.
- **HTTP responses always include an `error` string and a `message` string.** Status codes outside `[400, 600]` are normalized to 500 by `resolveHttpStatus`.
- **CLI commands exit non-zero on failure.** `handleApiError` and most CLI command entry points call `process.exit(1)` after writing to stderr/stdout.
- **Network errors preserve their underlying cause.** `describeFetchError` and `networkErrorWithHint` attach `err.cause` so callers can inspect the real errno (e.g. `ECONNREFUSED`).
- **MCP tool results for rate limits are structured JSON**, not raw strings, so agent clients can parse them reliably (`mcpRuntimeError.ts`).
- **Process crashes are logged but do not force immediate termination.** `uncaughtException` sets `exitCode = 1` without calling `process.exit`, allowing an external supervisor to manage lifecycle.
- **Browser launch is allow-listed.** Only binaries in `ALLOWED_BROWSER_BINARIES` (or an existing absolute path) are executed; arbitrary `BROWSER` env values containing shell metacharacters are rejected.
- **Global error handlers are installed exactly once.** The `installed` guard prevents duplicate registration of process event listeners.