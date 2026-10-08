# Audit logging

## Document status

This page is the **specification** for SquadRules MCP audit logging: behavior,
fields, and configuration so operators and engineers share one reference.

The repository contains plumbing for **embedding/search anomaly** events
(`audit.embedding`, `audit.anomaly`) and **MCP tool call** events
(`audit.mcp`). The optional audit file stream receives coarse JSON lines
for allowlisted categories.

This document does **not** assert alignment with a specific compliance
framework; customers map controls in their own assessments.

## Overview

Audit logging centers on **embedding/search anomaly** events and **MCP tool
call** events under stable `category` values for operational and security
investigations. **Target behavior:** those events appear in the **primary
structured log** (Pino). **Target behavior:** optionally, a **second
append-only file** receives a **summary line** per qualifying event when a
path is configured.

For incident triage, operators are expected to query the **main structured log**
by `category`, `tenant_id`, and `request_id`. The optional file is an extra sink
for environments that want a dedicated append-only path or separate log
shipping.

## Configuration

| Variable | Default | Effect |
|----------|---------|--------|
| `AUDIT_LOG_FILE` | (empty) | If set to a non-empty path, the server opens that path for **append** writes at startup. If empty or unset, no audit file stream is opened. If opening the path fails, the stream stays disabled; request handling continues. |
| `AUDIT_LOG_LEVEL` | `1` | Verbosity for MCP audit events (0-3). See [MCP audit levels](#mcp-audit-levels) below. Does not affect `audit.embedding` or `audit.anomaly` events. |

There is **no** separate `AUDIT_LOG_ENABLED` flag: an empty `AUDIT_LOG_FILE`
disables the file stream.

Defaults and related variables are defined in
[`src/config.ts`](../../src/config.ts).

**Operations note:** rotation, retention, and permissions for the file are
**environment responsibilities** (for example log shipper, `logrotate`, or
container volume policies). The application does not implement built-in
rotation parameters for this path.

## Where events are emitted (current tree)

Rich **audit.embedding** and **audit.anomaly** records are produced from:

- [`src/services/embedding/audit.ts`](../../src/services/embedding/audit.ts) --
  request-level embedding success and failure, anomaly detection (latency,
  vector norm, dimension mismatch), and search anomalies (zero results, low
  score).
- [`src/services/embedding/providers.ts`](../../src/services/embedding/providers.ts)
  -- provider-stage embedding calls (`stage: 'provider'` in structured fields).

**audit.mcp** records are produced from:

- [`src/http/http-mcp-handler.ts`](../../src/http/http-mcp-handler.ts) --
  MCP tool call audit events at the HTTP handler dispatch point.

HTTP request lifecycle (method, path, status, duration, `request_id`, client
IP) is logged by the HTTP middleware and uses the same structured logger, but
those lines use other `category` values. They **do not** produce lines in the
optional audit file unless the category is one of the allowlisted values.

## Event categories (structured log)

The structured logger attaches a `category` field. Investigation-relevant
values for audit logging are:

- **`audit.embedding`** -- embedding request completion (success or error) and
  provider-stage outcomes. Typical fields include `tenant_id`, `request_id`,
  `provider`, `model`, input sizing, `output_dimension`, `latency_ms`, and
  status. Provider rows may include `stage: 'provider'`.
- **`audit.anomaly`** -- heuristic anomalies (for example high latency,
  unusual vector norm, dimension mismatch, or search quality warnings). Includes
  `anomaly_type`, `severity`, `tenant_id`, `request_id`, and detail fields.
- **`audit.mcp`** -- MCP tool call lifecycle events. See
  [MCP audit levels](#mcp-audit-levels) below for verbosity control.

These records are **sanitized** before they reach any sink (see
[`src/utils/structured-logger.ts`](../../src/utils/structured-logger.ts)):
strings and object keys are bounded and scrubbed so control characters and
line breaks cannot break log lines.

## MCP audit levels

`AUDIT_LOG_LEVEL` controls what gets written to the audit file for
`audit.mcp` events:

| Level | Name | What's captured |
|-------|------|----------------|
| `0` | Off | No MCP audit events |
| `1` | Metadata | Tool name, correlation_id, tenant_id, request_id, timestamps, duration_ms, status, error_code |
| `2` | Request | Level 1 + request arguments (sanitized, bounded) |
| `3` | Full | Level 2 + response body (sanitized, bounded) |

**Existing behavior preserved:** `audit.embedding` and `audit.anomaly` events
continue to write to the audit file regardless of `AUDIT_LOG_LEVEL`. The level
only gates MCP tool call detail.

### MCP event names

| Event | Description |
|-------|-------------|
| `mcp_request_start` | Emitted at handler entry, before space context is established. `tenant_id` is `'unknown'` at this point. |
| `mcp_tool_call` | Emitted after tool execution completes, inside the space context. Carries full level-dependent detail. |
| `mcp_request_end` | Emitted in the response `finish` handler. Carries `correlation_id`, `duration_ms`, and `tool_name`. |

### Correlation model

The MCP handler creates a new `StreamableHTTPServerTransport` per HTTP request
(no persistent session state). Instead of `session_id`, the audit uses:

- **`request_id`** -- the JSON-RPC request id (unique per call)
- **`correlation_id`** -- a server-generated identifier grouping related requests
  within a short time window per tenant

The journey export script (`scripts/journey-export.mjs`) groups events by
`correlation_id` to reconstruct multi-request agent runs.

### MCP audit JSONL format examples

**Level 1 -- Metadata:**

```json
{"time":"2026-06-10T12:00:00.000Z","level":"info","category":"audit.mcp","event":"mcp_tool_call","stage":"response","correlation_id":"corr-abc","tenant_id":"t-1","request_id":"req-42","tool_name":"activate","status":"success","duration_ms":230}
```

**Level 2 -- + Request:**

```json
{"time":"...","level":"info","category":"audit.mcp","event":"mcp_tool_call","stage":"response","correlation_id":"corr-abc","tenant_id":"t-1","request_id":"req-42","tool_name":"activate","status":"success","duration_ms":230,"request":{"query":"find deploy workflow"}}
```

**Level 3 -- + Response:**

```json
{"time":"...","level":"info","category":"audit.mcp","event":"mcp_tool_call","stage":"response","correlation_id":"corr-abc","tenant_id":"t-1","request_id":"req-42","tool_name":"activate","status":"success","duration_ms":230,"request":{"query":"find deploy workflow"},"response":{"isError":false,"content":[{"type":"text","text":"{\"choices\":[...]}"}]}}
```

### Sanitization policy

At all levels, request and response data are sanitized:

- Bearer tokens and API keys are redacted (regex pass on string values)
- Strings capped at 2048 chars
- Arrays capped at 50 items (with `_truncated: true` flag)
- Nested objects capped at depth 6
- Object keys capped at 50 per level

Sanitization helpers: [`src/utils/audit-mcp-summary.ts`](../../src/utils/audit-mcp-summary.ts).

## Optional audit file stream (coarse lines)

When `AUDIT_LOG_FILE` is set, each qualifying event may write **one** JSON line
built by
[`src/utils/audit-log-events.ts`](../../src/utils/audit-log-events.ts). Only
events whose sanitized bindings include an allowlisted `category`
(`audit.embedding`, `audit.anomaly`, or `audit.mcp`) are written.

For `audit.embedding` and `audit.anomaly`, the line contains **only**:

- `time` -- ISO 8601 timestamp when the line is built
- `level` -- `info`, `warn`, or `error`
- `category` -- `audit.embedding` or `audit.anomaly`
- `event` -- a **derived** label (for example `embedding_success`,
  `embedding_provider_error`, `embedding_high_latency`)

For `audit.mcp`, the line includes level-dependent fields (see above).

**Tenant, request, provider, and metrics are not duplicated** into the
embedding/anomaly line; they remain in the **main structured log** for the
same event. That split is intentional: the file stream is a compact,
allowlisted side channel.

### Derived `event` values (reference)

For **`audit.embedding`**, the code derives the event from `stage` and
`status` (request vs provider stage, success vs error). For **`audit.anomaly`**,
the code maps `anomaly_type` (with a fallback to a generic anomaly label).
For **`audit.mcp`**, the event name is passed through from the handler
(`mcp_tool_call`, `mcp_request_start`, `mcp_request_end`).

## Journey export (dev tooling)

The audit file can be exported as journey JSON files for replay and diff:

- `scripts/journey-export.mjs` -- read audit JSONL, group by `correlation_id`, output journey JSON
- `scripts/journey-replay.mjs` -- replay a journey against a running server
- `scripts/journey-diff.mjs` -- compare journey sets across versions

These scripts are **standalone dev tools**, not part of the server runtime.
See the plan in the repository for details.

## Relationship to other documentation

- **[Logging (project Wiki)](https://github.com/SquadRules/mcp/wiki)** -- general log levels, fields, and
  environment variables for the Pino pipeline.
- **[Incident runbook](incident-runbook.md)** -- using structured logs and the
  optional audit stream for correlation by `request_id`.

## Source reference summary

| Concern | Location |
|---------|----------|
| Env: `AUDIT_LOG_FILE`, `AUDIT_LOG_LEVEL` | [`src/config.ts`](../../src/config.ts) |
| Sanitization, HTTP logging, Pino wrapper, `writeAuditLine()` | [`src/utils/structured-logger.ts`](../../src/utils/structured-logger.ts) |
| Coarse file line builder, category allowlist | [`src/utils/audit-log-events.ts`](../../src/utils/audit-log-events.ts) |
| MCP audit request/response sanitization | [`src/utils/audit-mcp-summary.ts`](../../src/utils/audit-mcp-summary.ts) |
| MCP tool call audit emission | [`src/http/http-mcp-handler.ts`](../../src/http/http-mcp-handler.ts) |
| Embedding and search audit and anomalies | [`src/services/embedding/audit.ts`](../../src/services/embedding/audit.ts) |
| Provider-stage audit lines | [`src/services/embedding/providers.ts`](../../src/services/embedding/providers.ts) |
