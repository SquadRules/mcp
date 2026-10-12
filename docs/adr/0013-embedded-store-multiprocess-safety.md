# ADR 0013: The embedded store is safe across multiple local processes

## Status

Accepted

## Context

The embedded LanceDB backend keeps its data in one shared per-user directory
(`<configDir>/lancedb`, resolved by `resolveLanceDbDir()`). Since the CLI is now
local-by-default ([ADR 0015](0015-cli-local-by-default-transport-agnostic-backend.md))
and MCP hosts launch one server process each, it is normal for two or three
independent processes on the same machine to hold that directory open at once:
a developer runs `squadrules serve` while an agent runs `squadrules activate`,
or two agents each spawn their own instance.

A separate Qdrant server used to give two properties for free: it serialized
access, and every client saw the latest committed write. Embedded LanceDB gives
neither implicitly — each process owns its DB handle and its own in-process
`MemoryStore` cache — so write safety and cross-process read freshness have to
be requested explicitly. A centralized daemon (one writer, IPC from the rest)
was proposed and rejected: it adds port, auth, lifecycle and versioning surface
against the zero-config goal, and the existing HTTP transport already serves the
"one server, many agent clients" shape when a single always-fresh writer is
wanted.

## Decision

Each process opens the shared directory directly — no daemon, no lock file — and
relies on Lance MVCC plus three primitives:

1. **Strong-consistency reads.** `openLanceConnection()` connects with
   `readConsistencyInterval: 0`, so every read re-checks the latest committed
   manifest instead of serving a cached snapshot. A reader sees another
   process's committed writes on its next read.
2. **Bounded commit retry.** Every mutation runs through `withCommitRetry()`, an
   optimistic-concurrency wrapper: on a commit conflict the loser re-reads the
   latest version and re-issues the write, with exponential backoff plus jitter
   (default 8 attempts, 20 ms base, 1000 ms cap). Only conflict-classified
   errors retry; any other error surfaces unchanged, so a commit is never
   silently dropped or rerouted to a different store.
3. **Atomic batched publish.** A logical group of writes is one MVCC commit, not
   N: upserts use `mergeInsert('id').whenMatchedUpdateAll().whenNotMatchedInsertAll()`,
   which is idempotent and keyed by row id.

**Accepted caveat.** `readConsistencyInterval: 0` fixes LanceDB visibility but
not the application-level per-process `MemoryStore` cache, which can still serve
a value another process has since changed. That window is acceptable at the
target scale (a single user, two or three processes, adapters that change
rarely); workloads that need one always-fresh shared writer use the HTTP
transport instead.

## Consequences

### Positive

- **The CLI in local mode is just another process.** It opens the same directory
  with the same primitives, so no separate safety story is needed for it.
- **Zero-config concurrency.** No daemon to start, no port to reserve, no lock to
  leak; two or three local processes coexist on the shared store.
- **Defensive, not load-bearing.** The retry is a backstop: at target scale Lance
  serializes local-directory commits internally, so conflicts are rare.

### Negative

- **A short staleness window** exists on the per-process cache (above). It is
  bounded by how often a process re-reads, not by the store.
- **Compaction is deferred.** No periodic `optimize()`/compaction runs yet, so a
  heavily churned store keeps its delete tombstones until that is added.

## Alternatives Considered

### Centralized daemon with IPC clients

One long-lived writer process, everyone else talks to it over a socket. Rejected:
write safety is already solved by MVCC plus the retry, and a daemon only
pre-empts the deferred cache-coherence item while adding exactly the
port/auth/lifecycle/version surface the zero-config path avoids. The HTTP
transport already covers the "one shared writer" need.

### A cross-process lock file around writes

Rejected: Lance already serializes commits for a local directory, so a lock
would add a stale-lock failure mode and a cross-platform `flock` problem without
buying correctness.

## Evidence

- Feasibility probe: two processes × 80 commits produced zero corruption, the
  exact expected row count, and `conflicts=0` per writer — Lance serialized the
  commits internally for local-directory mode.
- `src/services/vector-store/lancedb-connection.ts` (`readConsistencyInterval: 0`,
  lazy SDK import so the Qdrant path never loads native bindings).
- `src/services/vector-store/commit-retry.ts` (`isCommitConflictError`,
  `withCommitRetry`, backoff + jitter, structured logger only).
- `src/services/vector-store/lancedb/lance-records-engine.ts` (atomic
  `mergeInsert` upsert, delete-by-filter, all under `withCommitRetry`) and
  `src/services/vector-store/lancedb/LanceExecutionTraceStore.ts`.
- `tests/unit/vector-store-commit-retry.test.ts` (conflict classification and
  retry bounds, without ONNX or a server).

## Related

- [ADR 0003: No LanceDB store snapshot in CI](0003-no-lancedb-store-snapshot.md)
- [ADR 0015: CLI is local-by-default](0015-cli-local-by-default-transport-agnostic-backend.md)
- Issue [#47](https://github.com/SquadRules/mcp/issues/47): CLI local-by-default
  makes multi-process access the common case; reopen this decision there if the
  per-process cache window ever needs to close.
