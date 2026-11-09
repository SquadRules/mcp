# ADR 0042: The adapter graph is owned by the runtime, keyed by scope, and projected from stored records

## Status

Accepted — implemented and verified on branch `sr6-graph-db-touchpoints` on
2026-11-06; landed on `squadrules-6` via [PR #296](https://github.com/SquadRules/mcp/pull/296)
squash-merge commit `40af9c75`
on 2026-11-09 with all thirteen required CI gates green (Build Node 24/26,
Single, Cluster, Graph, CodeQL ×2, CI gate, Dependency review, Security
workflow, Integration workflow, Automation policy, npm audit). Status reconciled
by agent on 2026-11-09 under the documentation-authority ADR-status rule.

This record does not change [ADR 0041](0041-graph-native-open-source-database-for-ontological-knowledge-system.md)'s
choice of storage class (graph-native, open source, dual-mode). It fixes three
things ADR 0041 left to implementation and that the Touchpoint 1/3 code settled
wrongly: **who owns** the embedded graph, **what identifies** an adapter node, and
**where topology is derived from**. It supersedes the module-singleton resolution
(`getGraphDbService()`) and the unscoped `adapter:<slug>` key as implemented; no
accepted ADR body is rewritten.

## Context

### 1. Ownership was by process, not by runtime

`graph-db-singleton.ts` memoized one `GraphDatabaseService` and every tool called
`getGraphDbService()`. The database path came from `SQUADRULES_GRAPH_DB_PATH`, so
whichever boot ran first — or whichever caller set the env last — selected the
graph for **every** consumer in the process. Two runtimes in one process (a
personal embedded runtime plus a second isolated one, or two fixtures) therefore
shared one handle, and a tool handed store A could read store B's topology. The
embedded vector store had the same shape, so the defect was symmetric and stayed
invisible until a second instance existed.

### 2. Identity ignored scope

The graph keyed adapters `adapter:<slug>`. The same slug legitimately exists in a
personal space, a group space and the app space at once, so one key meant
last-writer-wins: a personal child could be linked to a team parent that merely
shared a slug, and boot reconciliation could only speak about one global
namespace. Meanwhile `storeAdapter` already stamps `space_id` on every record and
`pointToMemory()` already attributes a record with no `space_id` to the app space.
The graph used neither, and `space: "personal"` was effectively a guess.

### 3. Projection lived in the wrong layer, from the wrong source

`train`/`tune` wrote nodes straight from the authoring markdown, inside the tools
layer, one adapter at a time, node and edge together. Consequences:

- `src/resources/**` could not reconcile the graph without importing
  `src/tools/**`, and the resource layer must not import tools.
- Boot could only re-inject **bundled markdown**, never reconcile what was
  actually stored — so a graph loss was "repaired" by rewriting memory content,
  and an adapter that was never bundled (a user's own) could never come back.
- A child enumerated before its parent lost its edge.
- A failed node write could still be followed by an edge attempt.

### 4. What the graph is, stated precisely

Adapter topology — `Inherits`/`SpecializedBy` and the frontmatter that produced
it — is a **derived projection** of adapter records. It is rebuildable from the
store. `Anomaly` nodes written by `reward` are **graph-native historical record**:
they exist nowhere else and are **not** reconstructible from memory content, not
even approximately. ADR 0041's ontological-versioning ambitions are therefore not
satisfied by projection; only topology is.

## Decision

### 1. The graph is attached to the runtime that booted it

`src/services/graph-db/graph-owner.ts` keeps a `WeakMap<object, GraphDatabaseService>`.
A boot calls `attachGraphDb(graphDb, memoryStore, qdrantService)`; tools call
`getGraphDb(memoryStore)`. There is **no global fallback**: an unattached or
de-initialized store resolves to `null`, which every call site already degrades to.
`detachGraphDb(owner)` detaches without closing — the opener closes.

`openGraphDb({databaseDir, enabled})` is the factory: it accepts an explicit
directory, never memoizes, never throws, and returns `null` on failure after
releasing a half-open handle. `initGraphDb()` is the boot adapter (factory plus
registration for shutdown); `closeGraphDb()` closes **only** registered boot
instances and is idempotent and error-swallowing, so a second shutdown signal is
never a rejection. Two boots in one process open two independent graphs.

The same shape applies to the vector store: the embedded Lance constructor accepts
an explicit path, and its default behaviour (resolve from env/home) is preserved
for callers that pass nothing. The public `GraphDatabaseService` constructor keeps
its existing signature, so code that opens a graph directly still compiles.

### 2. Node identity is `adapter:<spaceId>:<slug>`

`src/services/graph-db/adapter-scope.ts` owns the only key builder
(`adapterGraphKey`) and the only scope resolution:

- **Writes** use the store's tenant context (`writeAdapterScope()` →
  `getSpaceContextFromStorage().defaultWriteSpaceId`) — exactly the space id
  `storeAdapter` stamps on the records it writes. An empty context fails closed.
- **Reads** use the stored record's `space_id` (`storedAdapterScope` →
  `source: 'stored-record'`).
- The **single** fallback is the documented stored-content policy in
  `pointToMemory()`: a record with no `space_id` payload belongs to the app space.
  That resolution is recorded as `scope_source: 'stored-content-policy'`.
- `"personal"` is never invented, and an empty scope throws rather than defaulting.

Every resolution reports its provenance (`scope_space_id`, `scope_source`) onto
node and edge metadata, so a scope is auditable rather than implicit.

### 3. Parent resolution is one policy shared by validation and the edge

`parentScopeCandidates(childSpaceId)` returns `[child]`, or `[child, appSpace]`
when the child is outside the app space — the bundle lives in the app space and
is read-only content every space may execute. The resolved parent scope is
returned to the caller and recorded on the edge, so `train`/`tune` validation and
the edge write can never disagree about which parent they mean. Validation is
handed the **real stored parent frontmatter** (`resolveStoredParentSnapshot`),
not the child's own document.

When no candidate scope holds the parent, the child's existing edges are cleared
and the pair is reported in `missing_parents`: a removed parent must not leave
dangling topology behind.

### 4. Projection is a services-layer function from stored records, nodes first

`src/services/graph-db/adapter-graph-sync.ts` owns projection; `src/resources/**`
and `src/tools/**` call it and never implement it. `syncAdapterGraph(graphDb,
snapshots)` runs two passes: all nodes, then all edges. The node pass cannot fail
on a missing parent, and the edge pass sees every node the node pass wrote, so
child-before-parent enumeration still links. A node failure is collected in
`failed[]` and its edges are skipped — no edge ever points at a node that was not
written.

Snapshots come from **stored layer records** (`snapshotFromLayers`,
`snapshotFromStoredMemory`); the train path reads the head back with
`{fresh: true}` and projects from that, so an adapter whose `storeAdapter` failed
cannot leave a node. Topology frontmatter (`inherits`, `override`, `chain_root`)
is carried onto the stored `adapter` payload by `toStoredAdapterFrontmatter`,
because `storeAdapter` persists the body and would otherwise drop the only fields
reconciliation can read.

### 5. Boot reconciles from the store, in exactly the injected space

`reconcileAdapterGraphFromStore(graphDb, source, spaceIds)` enumerates stored
records with `scrollSpace` for the space ids the boot injected into
(`defaultReconcileSpaceIds()` — the configured app space) and projects them. It
never writes memory content, so recovering a graph cannot overwrite an adapter.
It runs on the warm path too: an adapter skipped by the version check still gets
its node back after a graph loss.

Order in `src/runtime/boot-local-runtime.ts`: `initGraphDb()` → `attachGraphDb()` →
boot injection → reconcile. Reconciliation is deliberately last, so it observes
what injection actually stored.

## Consequences

### Positive

1. Two runtimes, or two fixtures, in one process own independent graphs and
   independent vector stores; closing one leaves the other usable, and neither can
   read the other's topology.
2. The same slug can exist in several spaces without collision, and hierarchy
   resolution cannot silently cross scopes.
3. Validation and the `Inherits` edge share one resolved parent scope, so a
   `parent_missing` warning and the edge state can no longer contradict each other.
4. A failed memory write leaves no node, and a failed node write leaves no edge.
5. A lost or empty graph is recoverable from the store without rewriting memory
   content, including adapters that were never bundled.
6. `src/resources/**` can reconcile the graph without importing `src/tools/**`.
7. Child-before-parent enumeration no longer loses edges.

### Negative

1. **Key format changed.** A database written by the previous code holds
   `adapter:<slug>` nodes that will never be matched again. They are stale
   derived data; the supported cleanup is deleting the graph directory, and no
   migration script is provided. This is acceptable only while the graph is known
   to be derived.
2. **`Anomaly` history is not recovered.** A lost graph loses the anomaly record
   that `reward` wrote, permanently. Nothing in memory content can regenerate it.
3. **Train-time projection is conditional.** `train`/`tune` project only when the
   document declares inheritance frontmatter; a plain adapter's node appears at
   the next boot reconcile. A process that trains a plain adapter and never
   reboots has it in the store and not in the graph.
4. **Reconcile scope is narrow.** Boot reconciles only the space(s) it injected
   into. Adapters stored in other spaces are deliberately not enumerated: scanning
   arbitrary team spaces is not authorized by a boot.

### Neutral

1. Scope provenance is now stored on nodes and edges — a little metadata in
   exchange for an auditable scope.
2. A `WeakMap` hop stands between a tool and the graph. It removes a lifecycle
   owner and a reset hook rather than adding one.
3. `reconcileAdapterGraphFromStore` is idempotent against an already-correct graph:
   re-projection overwrites the same nodes with the same values.

## Evidence

- `src/services/graph-db/graph-owner.ts` — `attachGraphDb` / `getGraphDb` /
  `detachGraphDb` over a `WeakMap`; no global fallback, `null` for an
  uninitialized service.
- `src/services/graph-db/graph-db-singleton.ts` — `openGraphDb` factory (explicit
  directory, no memoization, never throws, half-open close on failure),
  `initGraphDb` registry, `closeGraphDb` that closes only its own instances.
- `src/services/graph-db/adapter-scope.ts` — `adapterGraphKey`,
  `writeAdapterScope`, `storedAdapterScope`, `parentScopeCandidates`,
  `scopeMetadata`.
- `src/services/graph-db/adapter-graph-sync.ts` — `syncAdapterGraph` two-pass
  nodes-then-edges, `resolveParentScope`, stale-edge clearing,
  `reconcileAdapterGraphFromStore`, `defaultReconcileSpaceIds`.
- `src/services/memory/stored-adapter-frontmatter.ts` — persists `inherits`,
  `override`, `chain_root` on the stored `adapter` payload.
- `src/tools/train-store.ts` — validation against the stored parent, then
  `projectStoredAdapter` from the re-read head.
- `src/runtime/boot-local-runtime.ts:164–223` — `initGraphDb` → `attachGraphDb` →
  injection → `reconcileAdapterGraphFromStore`.
- `tests/integration/graph-db-instance-isolation.test.ts` — 9 tests, **no mocks**:
  real `openGraphDb` on explicit directories, real `LanceVectorRecordStore`, real
  `storeAdapter`/`syncAdapterGraph`/`reconcileAdapterGraphFromStore`. Covers two
  graphs and two vector stores in one process, independent close, same slug in two
  scopes, same-scope parent resolution, app-space-only fallback, empty-scope
  throw, child-before-parent ordering, failed-write-no-phantom, and lost-graph
  recovery.
- `tests/unit/graph-db-singleton.test.ts` — 17 tests over the factory/registry
  semantics and the `graph-owner` attachment.
- `tests/unit/graph-db-train-unit.test.ts` (34), `-activate-unit` (9),
  `-forward-unit` (10), `-reward-unit` (7), `-delete-unit` (5) — the mocked-graph
  suites, renamed from `*-integration` because they mock the graph boundary.
- Targeted run on the branch: 8 suites, 104 tests, exit 0;
  `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` exit 0.

## Revisit condition

Reopen when any of these is observed:

- A deployment needs adapters reconciled across more than the injected space —
  then the space set becomes an explicit, opt-in parameter rather than a boot
  default, with the authorization stated.
- Graph-native history becomes authoritative for anything (anomalies, ontology
  versions) — then it needs its own backup/restore path, because projection can
  never restore it.
- More than one graph per store is required (per-space sharding) — then the key
  format and the attachment change together, in one record.
- A plain adapter is observed missing from the graph for longer than one boot —
  then move train-time projection out of the inheritance-conditional branch.

Track in a new issue; do not rewrite this record.

## Related

- [ADR 0041](0041-graph-native-open-source-database-for-ontological-knowledge-system.md)
  — chose graph-native storage and dual mode; this record fixes ownership,
  identity and derivation inside it. 0041's ontological-versioning goal is **not**
  met by this change.
- [ADR 0003](0003-no-lancedb-store-snapshot.md) — the embedded/shared dual-mode
  pattern the vector store keeps; the explicit-path constructor preserves it.
- [ADR 0013](0013-embedded-store-multiprocess-safety.md) — multi-process safety
  still applies to the graph directory; two graphs in one process is a different
  axis.
- [ADR 0021](0021-embedding-provider-auto-resolution-and-store-width-binding.md) —
  embedding resolution is unchanged; the vector store is still opened by the
  runtime, now with an explicit directory available.
- `docs/specs/train-graph-writes.md` — the *how* for the train/tune hooks;
  `docs/specs/graph-schema.md` — node/edge shapes and the physical key form.
