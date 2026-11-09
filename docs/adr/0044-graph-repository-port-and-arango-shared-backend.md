# ADR 0044: One narrow `GraphRepository` port, two backends, explicit selection and no embedded fallback

## Status

Accepted — implemented and verified on branch `sr6-graph-db-touchpoints` on 2026-11-06;
landed on `squadrules-6` via [PR #296](https://github.com/SquadRules/mcp/pull/296)
squash-merge commit `40af9c75` on 2026-11-09 with all thirteen required CI gates green,
including the `verify-integration-graph` lane executing both Arango suites against a
real `arangodb:3.11` service container (see [ADR 0048](0048-required-shared-backend-ci-lane.md));
reconciled by agent on 2026-11-09 under the documentation-authority ADR-status rule.

Keeps [ADR 0041](0041-graph-native-open-source-database-for-ontological-knowledge-system.md)'s
storage class (graph-native, open source, dual-mode) and
[ADR 0042](0042-graph-owned-by-runtime-scoped-keys-derived-topology.md)'s ownership, scoped
identity and derived-topology rules. It decides what ADR 0041 left open: **which API the
runtime may use**, **which concrete database satisfies it**, and **what happens when the
shared one is selected but unreachable**.

## Context

### 1. The runtime used a concrete service, not a contract

After ADR 0042 the graph was owned by the runtime and every tool called
`getGraphDb(store)`, but the return type was `GraphDatabaseService` — the LadybugDB
class. There was no named surface, so nothing said which operations the runtime actually
depends on, and no second backend could be added without editing every call site.

### 2. "Dual mode" had no shared implementation

ADR 0041 promised an embedded mode for one machine and a shared mode for an enterprise.
Only the embedded one existed. Multi-machine teams had no path, and an enterprise
deployment that lost its file had no way to keep the ontology that is *not* rebuildable
from memory content (anomalies, versions, proposals per ADR 0042 §4).

### 3. A silent fallback would be worse than no graph

The dangerous failure is not "the remote is down"; it is "the remote is down, so the
runtime quietly opened a local file and served a different ontology as if it were the
shared one". A local file is not a degraded shared database — it is *different data*
under the same keys.

### 4. Capability claims tend to outrun capability checks

A version banner is not a capability. Claiming cluster/HA behaviour, or assuming stream
transactions work because the version looks new enough, produces a deployment that
initializes and then corrupts multi-statement writes.

## Decision

### 1. The port is the only surface, and it names runtime operations

`src/services/graph-db/graph-repository.ts` declares `GraphRepository` with exactly the
methods the runtime calls: lifecycle (`initialize`/`isInitialized`/`close`), adapter
topology (`getAdapter`, `upsertAdapterFromFrontmatter`, `writeInheritanceEdges`,
`clearInheritanceEdges`, `getChildren`, `resolveInheritance`), ontology records
(`createAnomaly`, `listAnomalies`, `upsertConcept`, `getConcept`), history (`appendVersion`,
`getVersion`, `getLatestVersion`, `listVersions`), evolution (`createProposal`,
`getProposal`, `listProposals`, `updateProposalStatus`, `recordConfirmation`,
`listConfirmations`) and traversal (`findPathToRoot`).

`getGraphDb()` returns `GraphRepository | null`. Two implementations satisfy it:
`GraphDatabaseService` (LadybugDB, embedded, MIT) and `ArangoGraphRepository`
(ArangoDB 3.10–3.11, shared, Apache-2.0).

There is deliberately **no** `query(aqlOrCypher)` method. The port cannot express a raw
graph query, so no tool and no adapter can acquire one by accident
([`docs/specs/ontological-knowledge-system.md`](../specs/ontological-knowledge-system.md)
§ "Mode agnosticism principle": "query" means activate-time retrieval, not a tool).

### 2. Selection is an explicit operator decision

`src/config/graph-backend.ts`:

- `SQUADRULES_GRAPH_BACKEND=embedded` (default) → LadybugDB at `SQUADRULES_GRAPH_DB_PATH`.
- `SQUADRULES_GRAPH_BACKEND=arango` → require `SQUADRULES_ARANGO_URL` and
  `SQUADRULES_ARANGO_DATABASE`; a missing value is a configuration error, not a default.
- Any other value throws `GraphBackendConfigError`.

### 3. A failing shared backend never becomes a local file

`openGraphDb()` in `graph-db-singleton.ts` calls `openArango()` **only** when the operator
selected `arango`, and that function either returns a working repository or `null` with a
loud error. It never constructs a `GraphDatabaseService`. With
`SQUADRULES_GRAPH_BACKEND_STRICT=true` the open throws instead of returning `null`, so a
misconfiguration cannot hide behind "graph bookkeeping disabled".

`null` means "no graph bookkeeping for this run" — every call site already degrades to
that, and no call site invents a substitute store.

### 4. Supported series is pinned; capabilities are proven

`SUPPORTED_ARANGO_SERIES = { major: 3, minMinor: 10, maxMinor: 11 }`. Initialization
rejects anything outside it (`assertSupportedArangoVersion`), including 3.12, whose
transaction internals were not tested here.

`probeArangoCapabilities()` then proves what the repository depends on: it reads the
version, bootstraps the schema idempotently (409 "duplicate" is treated as present), and
opens **and aborts a real stream transaction** over `Adapter`. `streamTransactions` is
therefore typed `'verified'`, not `boolean`. There is no HA, cluster or replication claim
anywhere: a single server is what the shared tests exercise.

### 5. Arango storage is real AQL over the same scoped identities

`src/services/graph-db/arango/*` maps the canonical model onto node/edge collections and
the named graph `squadrules_ontology` (`Adapter`, `Concept`, `Instance`, `Anomaly`,
`Version`, `Proposal`, `Confirmation`; edges `Inherits`, `SpecializedBy`, `Contradicts`,
`VersionOf`, `DiscoveredBy`, `RoutesTo`, `ProposedFor`, `ConceptInstances`). Node keys are
the same `adapter:<spaceId>:<slug>` strings the embedded backend uses, and traversal
(`resolveInheritance`, `findPathToRoot`, `getChildren`) answers the same questions.

Multi-statement writes that must not half-exist run inside one stream transaction:
`appendVersion` (snapshot + `VersionOf` edge) and `createProposal` (proposal +
`ProposedFor` edge). History stays append-only by construction: the document `_key`
embeds the monotonic sequence, so a replay hits the unique-key constraint instead of
overwriting a snapshot.

### 6. The shared tests fail, they do not skip

When `SQUADRULES_ARANGO_URL`/`SQUADRULES_ARANGO_DATABASE` are set, the shared suite runs
the same scenarios as the embedded suite. When the operator has *explicitly selected*
the shared backend (`SQUADRULES_GRAPH_BACKEND=arango`) but it cannot be reached, the suite
fails with the precise error — it never reports success and never silently skips, because
"shared parity" must not be claimed without a real server.

## Consequences

**Positive**

- Adding the shared backend required zero edits in tool call sites.
- The API surface is auditable: the port is 99 lines and every method has a caller.
- A remote outage degrades to "no graph" and is visible in logs; it cannot serve the
  wrong ontology.
- Version and transaction support are proven at initialization rather than assumed.

**Negative**

- The port is a maintenance obligation: a new graph feature must be added to both
  implementations before the runtime can use it.
- ArangoDB 3.12 and later are rejected until they are tested, so operators on a newer
  series must wait for a deliberate bump.
- A shared deployment pays HTTP round-trips per operation; there is no local cache.

## Evidence

- `src/services/graph-db/graph-repository.ts`, `graph-db-singleton.ts`,
  `src/config/graph-backend.ts`, `src/services/graph-db/arango/**`.
- Embedded integration: `tests/integration/graph-db-instance-isolation.test.ts`
  (real LadybugDB + real LanceDB).
- Shared integration: `tests/integration/graph-db-arango-shared.test.ts`
  (real ArangoDB; fails rather than skips when the shared backend is explicitly required).

## Alternatives considered

- **A generic query method on the port.** Rejected: it is the raw graph surface ADR 0041
  and the mode-agnosticism principle explicitly exclude from agent reach.
- **Fall back to embedded when Arango fails.** Rejected: it substitutes different data
  under the same keys, which is worse than having no graph.
- **Assume stream transactions from the version number.** Rejected: a version banner is
  not a capability; the probe is cheap and decisive.
- **Pick an ArangoDB driver dependency.** Not taken: the HTTP API is stable, small and
  already sufficient for the operations the port names.

## Reopening trigger

This record must be revisited if: a supported ArangoDB series change is needed (bump the
pin with new evidence), a runtime operation cannot be expressed on both backends without
leaking the query language, an operator needs cluster/HA guarantees (that is a new
decision with its own capability proof), or a deployment requires an embedded fallback
policy different from "no graph bookkeeping".
