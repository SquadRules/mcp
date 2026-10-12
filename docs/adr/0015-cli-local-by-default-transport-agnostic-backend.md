# ADR 0015: The CLI is local-by-default with a transport-agnostic backend and human-first output

## Status

Accepted

## Context

The `squadrules` CLI only ever worked against an HTTP server: `apiUrl` defaulted
to `http://localhost:3000`, so with no server running every data command failed
at connection time. That is a poor default for a tool whose store is embedded —
the same `execute*` core in `src/tools/*` already powers both the HTTP handlers
and the stdio MCP tools, and the LanceDB store needs no server at all.

The audiences also differ. Humans drive the CLI; agents drive the MCP tools. The
only machine-facing CLI paths are the bulk `export` and directory `train`
commands, which an agent may prefer to run in the CLI to keep adapter and content
bytes out of its context window. Output had drifted to match neither audience:
most data commands hard-coded JSON regardless of terminal, `export` defaulted to
text, and the "what to run next" hint was a multi-line string embedded inside the
JSON body.

## Decision

### 1. Local by default

When nothing is configured, the CLI target resolves to a local sentinel
(`LOCAL_TARGET = 'stdio://local'`, with `local` and `stdio` accepted as aliases)
instead of an HTTP URL. Data commands then run **in-process** against the
embedded store — no MCP SDK client, no spawned server, no HTTP hop. `login`
persists an http `apiUrl` to the config file, which flips every subsequent
command to the HTTP path with no new mechanism.

### 2. Transport-agnostic backend

An `ActionBackend` interface (`activate`, `forward`, `train`, `tune`, `delete`,
`reward`, `export`, `spaces`) has two implementations:

- `HttpBackend` wraps the existing `ApiClient`.
- `LocalBackend` calls `execute*` directly against the booted embedded store.

Commands depend only on the interface. `createBackendFromProgram()` resolves the
sentinel **before** URL validation, so `stdio://local` never reaches the http(s)
validator that would reject it. One core, two transports, no drift.

### 3. Fastboot in local mode

A cold CLI invocation should not pay server-boot cost. In local mode the boot
skips the LanceDB health probe, seeds the bundled adapters only when the store is
empty, and loads the embedding model lazily: only embedding-needing commands
(`activate`, `train`, or a fresh seed) trigger the ONNX load, while `forward`,
`reward`, `tune`, `delete`, `spaces`, and `export` never load the model.
`--reseed` (and `MEM_BOOT_FORCE_INJECT`) remain the repair hatch.

### 4. Human-first output

One global `--format <auto|pretty|json|text>` applies to every data command;
`auto` renders pretty on a TTY and JSON when piped. In pretty mode the next-call
hint goes to **stderr**; in JSON mode the body carries a single structured
`next_call` object rather than prose mixed into JSON. Bulk `export` and directory
`train` stay quiet and machine-facing: artifacts are written to `--out <dir>` /
`--zip-out <file>`, stdout carries only a compact summary, and `--format json`
emits a manifest of what was written.

### 5. Auth commands are HTTP-only

`login`, `token`, and `logout` need an OAuth server, which the local sentinel is
not. Against a local target they print guidance and fall back to
`http://localhost:3000` rather than attempting OAuth on `stdio://local`.

This is a single breaking change with no compatibility aliases for the renamed
commands, modules, or flags.

## Consequences

### Positive

- **Zero-config local use.** `squadrules activate "..."` works with no server
  running; a warm `squadrules spaces` returns fast with no model load.
- **Consistent surface.** Every command shares `--url`, `--timeout`, `--retries`,
  `--format`, and `--space`; output shape no longer varies by command.
- **No transport drift.** Both paths call the same `execute*` core.

### Negative

- **Local mode has no auth.** Writes land in the personal space; OAuth applies
  only to an http target.
- **Per-process cache staleness.** Local mode is another process on the shared
  store, inheriting the caveat in
  [ADR 0013](0013-embedded-store-multiprocess-safety.md).
- **Breaking.** Renamed flags and commands have no aliases; scripts written
  against the old surface must be updated.

## Alternatives Considered

### Spawn an MCP SDK client against a stdio child

Rejected: the CLI already ships both sides of the stack, so calling `execute*`
in-process removes a process spawn, a client dependency, and a serialization hop
without losing any capability.

### Keep HTTP as the default and require `serve` first

Rejected: it makes the embedded store's zero-config property invisible to the one
tool a human reaches for first, and it is the status quo this record replaces.

### Per-command output formats

Rejected: it is the drift this record removes. A single global `--format` with a
TTY-aware `auto` default serves both the human and the bulk machine-facing cases.

## Evidence

- `src/cli/local-target.ts` (`LOCAL_TARGET`, aliases, `isLocalTarget`),
  `src/cli/config.ts` (`getCliApiUrlDefault` returns the sentinel).
- `src/cli/backend/action-backend.ts`, `http-backend.ts`, `local-backend.ts`,
  `resolve-backend.ts` (interface, two implementations, sentinel-before-validate
  resolution).
- `src/runtime/boot-local-runtime.ts` (shared boot, seed-on-empty),
  `src/services/embedding/lazy-probe.ts` (`ensureEmbeddingDimension`).
- `src/cli/format.ts`, `src/cli/output.ts`, `src/cli/render.ts` (global format,
  `emitResult`, pretty/text renderers, stderr next-call hint).
- `src/cli/commands/export.ts` and `src/cli/commands/cli-train.ts` (quiet bulk
  artifacts, `--out`/`--zip-out`, JSON manifest).
- Issue [#47](https://github.com/SquadRules/mcp/issues/47).

## Related

- [ADR 0008: Bare CLI invocation defaults to stdio](0008-bare-cli-defaults-to-stdio-and-console-log-hygiene.md)
- [ADR 0013: Embedded store multi-process safety](0013-embedded-store-multiprocess-safety.md)
- [ADR 0014: Always track the latest MCP spec and SDK](0014-always-latest-mcp-spec-and-sdk.md)
