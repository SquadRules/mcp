# ADR 0008: Bare CLI invocation defaults to stdio; console logs must not leak to stdout

## Status

Accepted

## Context

MCP hosts (Cursor, Claude Desktop, Claude Code) launch the SquadRules server via
`mcp.json` with minimal configuration. The simplest possible config is:

```json
{
  "mcpServers": {
    "SquadRules": {
      "command": "npx",
      "args": ["-y", "@squadrules/mcp"]
    }
  }
}
```

Before this decision, running the CLI with no subcommand printed the Commander
help text to stdout. This broke the stdio MCP transport in two ways:

1. Help text on stdout corrupted the JSON-RPC protocol stream, causing MCP
   client parse failures.
2. The user had to know to pass `serve` (or `serve --transport stdio`) as
   explicit arguments, defeating the zero-config promise.

A secondary problem was log hygiene. The text-format logger rendered pino's
numeric levels verbatim (`[30     ]` instead of `[INFO ]`), several boot
messages referenced "Qdrant" even when the process was using LanceDB, and
per-operation audit lines (embedding calls, upserts, per-adapter training)
produced 40+ lines of repetitive output on every boot.

## Decision

### 1. Bare invocation → `serve` (stdio)

`src/cli/index.ts` injects `serve` into `process.argv` when no subcommand is
present (`process.argv.length <= 2`). The `serve` command already defaults to
stdio transport when `TRANSPORT_TYPE` is unset, so the full chain is:

```
npx -y @squadrules/mcp  →  CLI bare guard  →  serve  →  stdio transport
```

No additional arguments, no global install, no env file required.

### 2. Stdout is reserved for MCP protocol frames

When stdio transport is active, nothing may write to stdout except the MCP
JSON-RPC protocol. The `dotenv` v17 injection banner is suppressed with
`quiet: true`. All logging goes to stderr via the existing
`textFormatStream` in `src/utils/log-core.ts`.

A test in `tests/integration/mode/stdio/stdio-launch-smoke.test.ts` spawns
the CLI entry point with no arguments, waits for boot to complete, and asserts
`expect(startupStdout).toBe('')`.

### 3. Console log level and content hygiene

- **Numeric levels → labels.** The text-format stream now maps pino's numeric
  levels (30, 40, 50) to human-readable labels (INFO, WARN, ERROR) via
  `pino.levels.labels`.
- **Backend-aware messages.** "Initializing Qdrant memory store" now reads
  "Initializing LanceDB memory store" (or Qdrant, depending on
  `isQdrantConfigured`). "Startup snapshot disabled" no longer references
  Qdrant config variables on the embedded path.
- **Per-operation audit → debug.** Embedding provider call audits, per-adapter
  boot injection training messages, LanceDB upsert counts, and "removed
  preexisting app-space points" warnings are demoted from info/warn to debug.
  Only the boot injection summary line remains at info.

## Consequences

### Positive

- **Zero-config MCP host launch.** `npx -y @squadrules/mcp` with no extra
  args starts a working stdio MCP server.
- **Clean stdout.** MCP protocol frames are never corrupted by boot output.
- **Readable boot logs.** ~20 info-level lines instead of ~50; each line
  carries a human-readable level label and correct backend name.
- **Audit trail preserved.** Debug-level messages are still emitted and
  captured when `LOG_LEVEL=debug`; the audit log file (`AUDIT_LOG_FILE`)
  continues to receive all entries regardless of console level.

### Negative

- **Embedding audit not visible at default level.** Operators debugging
  embedding issues must set `LOG_LEVEL=debug` or consult the audit log file.
  Mitigated by the audit log side-channel (`AUDIT_LOG_FILE`).
- **Boot injection summary is less granular.** Per-adapter training messages
  are debug-only, so operators cannot see which specific adapters were
  retrained at info level. The summary line reports the total count.

## Alternatives Considered

### Global install instead of bare npx

Require `npm i -g @squadrules/mcp` and use `"command": "squadrules"` in
`mcp.json`. Rejected because it adds a manual install step and the npx
self-resolution bug (npx resolves the specifier against the local workspace
`package.json` name) only affects development inside the checkout — end users
running `npx` from any other directory are unaffected.

### Keep per-adapter boot messages at info

Retain the 4-lines-per-adapter output so operators can see each adapter being
trained. Rejected because the output is repetitive (9 × 4 = 36 lines) and
provides no actionable information on a normal boot where all adapters
succeed. The version-based skip (ADR 0002) is intended to eliminate this
output entirely once the reader defect (issue #24) is fixed.

## Evidence

- `node dist/cli/index.js` (bare, no args): stdio server starts, 0 bytes on
  stdout, ~20 info lines on stderr.
- `npx -y @squadrules/mcp` from outside the checkout: same result.
- `tests/integration/mode/stdio/stdio-launch-smoke.test.ts`: 3 tests pass,
  including the new CLI bare-invocation stdout-clean assertion.
- Unit suite: 98 suites / 567 tests passed, 0 failures.

## Related

- [ADR 0002: Boot-injection reuse rule](./0002-boot-injection-reuse-rule.md)
- [ADR 0007: SINGLE lane stdio integration](./0007-single-lane-stdio-integration-with-model-cache.md)
- Issue #24: boot-injection version reader defect (still open)
