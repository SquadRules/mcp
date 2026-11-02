# ADR 0040: Unify artifact materialization on a transport-neutral URL

## Status

Accepted — decision taken 2026-11-02 and implemented by the accompanying change
([#257](https://github.com/SquadRules/mcp/issues/257)). Supersedes
[ADR 0039](0039-artifact-materialize-emits-an-exact-command.md) and, through it,
**Decision §6** of [ADR 0033](0033-gate-scripts-as-adapter-artifacts.md); §1–§5 and
§7 of ADR 0033 stand. The `source` + `inline_base64` export API that ADR 0039
widened is preserved as a read/compat surface but is no longer the materialization
path.

## Context

ADR 0033 §6 replaced a CLI shell command with a structured `materialize`
instruction so the payload stopped depending on which `squadrules` CLI version an
agent happens to have. ADR 0039 then made `materialize.cmd` an exact per-transport
shell line: HTTP `curl`s the capability URL, stdio decodes an `export`
`inline_base64` response the agent must first place in `$B64`.

That kept two divergences. First, the stdio branch pushes artifact bytes — as
base64 inside an `export` tool response — back through MCP context and asks the
agent to shuttle them into an environment variable before running the command. It
is one more agent-handled step, and it re-introduces the very context round-trip
the URL path avoids. Second, both branches assumed a GNU userland (`base64 -d`,
`sha256sum -c`), which fails at the verify stage on a BSD userland without
coreutils — the host that runs the stdio/local topology most often.

The stdio transport already runs a live server process on the same host as the
agent. That server holds the authoritative artifact bytes in
`AdapterArtifactMetadata.text` (carried by `listAdapterArtifacts`, the same UTF-8
bytes `store-artifact.ts` hashed at train time). It can therefore write those
bytes to a private local cache and hand back a `file://` URL, exactly as the HTTP
transport hands back a capability URL. Both transports then feed one `curl`-based
command, and no artifact bytes ever enter MCP context.

## Decision

1. **One transport-neutral `materialize` contract.** The instruction is
   `{ method: 'url', url, out, sha256, chmod: '700', cmd }`. `tool` and
   `arguments` are removed; there is no `$B64` and no `export` step. `cmd` is a
   single POSIX shell line that curls `url` into a fresh private staging file
   inside the destination directory, verifies the SHA-256, applies `chmod 700`,
   and atomically renames staging into `out`. Any failure exits nonzero, removes
   staging, leaves a previously verified destination untouched, and never chmods
   an unverified file.

2. **STDIO source is a server-written `file://` URL.** On stdio the running
   server writes the verified bytes to a private per-process namespace under
   `os.tmpdir()` and returns `pathToFileURL(absPath).href`. No CLI process, no
   version matching, and no second backend or LanceDB connection: the bytes come
   from the metadata the server already loaded. The write is verified against
   `artifact.sha256` before publish and fails closed on mismatch.

3. **HTTP is unchanged.** The HTTP transport keeps its short-lived bearer
   capability URL and its TTL/expiry and no-logging behaviour; re-`activate`
   refreshes an expired URL. Only the instruction shape around it is unified.

4. **Byte-exactness stays framework work.** `curl`-to-file is a zero-copy byte
   transport, so the agent never re-types artifact bytes through an editor,
   heredoc, or environment variable — the failure class that motivated ADR 0039
   and issue [#231](https://github.com/SquadRules/mcp/issues/231). The digest is
   checked before the file is published, so "wrong version" and "corrupted write"
   remain distinguishable.

5. **Portable digest verification.** `cmd` resolves the digest with a
   deterministic fallback chain — `sha256sum`, else `shasum -a 256`, else
   `openssl dgst -sha256` — and compares the computed hex to the expected
   `sha256`. This removes ADR 0039's GNU-userland assumption without baking in a
   platform or asking the server to detect one.

6. **`file://` is a shared-filesystem MVP.** The stdio/local topology runs the
   server and the agent on one host, so a `file://` URL is readable by the
   `curl` the command runs. Where that assumption does not hold, the load fails
   with actionable diagnostics rather than emitting a URL the agent cannot reach;
   there is no speculative isolation detection.

7. **Identity, safety, and lifecycle are the server's, not the agent's.**
   Artifact identity is the UUID plus its digest, never the slug. The path
   grammar rejects traversal and shell metacharacters; the destination root and
   ancestors are checked for symlinks; two distinct UUIDs resolving to the same
   normalized destination fail the whole load instead of racing. The cache is a
   per-server-process `0700` namespace with availability leases
   (`SQUADRULES_EXPORT_DOWNLOAD_TTL_SEC`), per-instance entry/byte admission
   quotas, and orphan cleanup that never touches a live process's namespace.

## Consequences

### Positive

- Both transports share one instruction shape and one `curl`-based command, so
  there is a single materialization path to test, document, and reason about.
- No artifact bytes — raw or base64 — traverse MCP context, and the agent no
  longer manages `$B64` or calls `export` before writing.
- The digest fallback chain works on GNU and BSD userlands, so verification no
  longer fails at the verify stage on a coreutils-less host.
- The stdio path stops depending on the `export` tool for materialization, which
  is what issue #231 was ultimately after.

### Negative

- `file://` requires the server and the agent to share a filesystem. A future
  split-process or remote-agent stdio deployment needs a different carrier.
- The server now writes to `os.tmpdir()`. That is bounded by leases, quotas, and
  orphan cleanup, but it is state the process must manage, and an OS temp-cleaner
  can still remove a file out from under a lease — the recovery is re-`activate`.
- A POSIX shell alone cannot close a time-of-check/time-of-use race against a
  hostile concurrent writer, so the destination tree must be caller-owned and
  non-adversarial. Canonical-path validation and symlink rejection are mandatory
  but are not a race-free containment guarantee.
- `curl` must be present. This was already true of the HTTP path and is now true
  of both.

### Neutral

- `export` with `format: "source"` and `delivery: "inline_base64"` remains a
  supported read and compatibility API; it is simply no longer how
  `linked_artifacts[].materialize` delivers bytes.

## Evidence

- `src/tools/artifact-local-cache.ts` — the per-process stdio cache: `0700`
  namespace, digest-verified atomic publish, leases, quotas, orphan cleanup.
- `src/tools/artifact-materialize-command.ts` — the transport-neutral builder and
  the `curl` + portable-digest + `chmod 700` + atomic-rename `cmd`.
- `src/tools/activate-artifacts.ts` — path preflight, destination-collision
  rejection, and the stdio-cache versus HTTP-capability branch.
- `src/tools/artifact-relative-path.ts` — the shell-metacharacter and containment
  grammar. `src/tools/activate_schema.ts` — the strict `{ method: 'url', … }`
  schema. `src/tools/shell-failure-diagnostics.ts` — recovery text pointing at
  `materialize.cmd` rather than `$B64`.
- `tests/unit/artifact-materialize-command.test.ts` runs the emitted `cmd` for
  real against a `file://` source and an in-process HTTP listener;
  `tests/unit/artifact-local-cache.test.ts` covers digest, dedup, modes, leases,
  quotas, and cleanup; `tests/integration/write/squadrules-train-artifact.test.ts`
  asserts the unified row end to end.
- Per `.qoder/rules/low-memory-hosts.md`, `tsc`, repo-wide `eslint .`, and the
  full Jest/integration suites are proven by CI on the PR head commit, not run on
  the authoring host.

## Revisit condition

Reopen if stdio/local deployments commonly run the agent on a different host or
filesystem than the server, so a `file://` URL is not reachable by the command's
`curl` — then the bytes need a network carrier on stdio too. Reopen if a
materialized artifact is found on disk that does not match its row's `sha256`,
which would mean `cmd` was bypassed rather than fixed. Reopen if the tmp-cache
lease/quota model proves insufficient under aggressive OS temp-cleaners in
practice. Track through [#257](https://github.com/SquadRules/mcp/issues/257); do
not rewrite this record.

## Related

- [ADR 0039](0039-artifact-materialize-emits-an-exact-command.md) — superseded
  here; its per-transport `cmd` and base64 stdio carrier are replaced by one URL
  contract.
- [ADR 0033](0033-gate-scripts-as-adapter-artifacts.md) — Decision §6, superseded
  through 0039; §1–§5 and §7 unchanged.
- [ADR 0022](0022-skip-application-cache-for-embedded-lancedb.md) — why the cache
  is a plain local file namespace, not a second store read.
- [ADR 0013](0013-embedded-store-multiprocess-safety.md) — multiprocess safety
  informs the per-process namespace and no-cross-process-dedup rule.
- [ADR 0015](0015-cli-local-by-default-transport-agnostic-backend.md) — the
  local-by-default CLI topology this stdio path serves.
