# ADR 0047: Activate-time ontology context is a scoped projection, not a query surface

## Status

Proposed — implemented and verified on branch `sr6-graph-db-touchpoints` on 2026-11-06;
awaiting independent owner ratification.

Implements Layer 3 of
[`docs/specs/ontological-knowledge-system.md`](../specs/ontological-knowledge-system.md)
("Knowledge Retrieval") on top of
[ADR 0042](0042-graph-owned-by-runtime-scoped-keys-derived-topology.md),
[ADR 0044](0044-graph-repository-port-and-arango-shared-backend.md),
[ADR 0045](0045-graph-native-history-and-restore.md) and
[ADR 0046](0046-evidence-gated-evolution-proposals.md).

## Context

### 1. The retrieval layer existed in the spec and nowhere else

The ontology could record relationships, anomalies, proposals and history, but an agent
activating an adapter saw only search hits and the inheritance chain. It could not see the
open anomalies its choice is involved in, the proposals pending against that adapter, or
what the last successful change was — the exact context Layer 3 describes.

### 2. The obvious implementation is the one the spec forbids

The obvious answer is a `graph_query` tool. The spec's mode-agnosticism principle names
"query" as activate-time retrieval *surfaced through `activate`*, explicitly "not
query-language or storage-layer access exposed to agents". A query tool would also defeat
the port design of ADR 0044, which deliberately cannot express one.

### 3. "Context" is an authorization question

Task, domain, human preferences and organizational conventions come from different
authorities. If any of them can be supplied as a free-text scope, an agent can widen its own
retrieval across team boundaries by typing a space name.

## Decision

### 1. The projection is composed server-side and attached to `activate`

`resolveActivationOntologyContext()` runs after inheritance resolution and attaches
`ontology_context` to the activation result (and only when it can be resolved):

- `scope` — `adapter_key`, `space_id`, `space_source`;
- `context` — `task`, `domain`, `human`, `org`, plus `sources` naming where each came from;
- `relationships` — the inheritance/concept path from `findPathToRoot`;
- `concept` — the concept node **only** when the stored adapter declares one;
- `evidence` — open anomaly count plus capped rows, pending/accepted proposal counts plus
  capped rows, retained snapshot count;
- `evolution` — current adapter version and snapshot, the applied snapshots with
  `content_digest`, accepted resolution notes, and a one-sentence explanation of which
  snapshot is current;
- `degraded` — a reason when part of the projection could not be read.

No new MCP tool, no route, no resource. `activate`'s input gains an optional `context:
{ task?, domain? }` describing the request; it is not a scope.

### 2. Every read is addressed by the scoped adapter identity

The key is `adapter:<spaceId>:<slug>` with `spaceId` from the stored record
(`storedAdapterScope`). Anomalies are filtered to those whose `source_child` carries the
same scope (or whose metadata records it); proposals are filtered by `targetKey` **and**
`space`; history is read by the scoped key. Nothing enumerates other spaces, and the only
cross-space read remains the documented read-only app-space parent fallback that inheritance
already uses ([ADR 0042](0042-graph-owned-by-runtime-scoped-keys-derived-topology.md) §2).

### 3. Authority is split by source, and recorded

- `task` — caller-declared (`context.task`); it describes the request.
- `domain` — caller-declared, else the stored adapter's own `domain` frontmatter/metadata.
- `human` — `human://<userId>` from the runtime space context
  (`getSpaceContextFromStorage().userId`); never taken from a document.
- `org` — a **permitted** group space from the runtime space context
  (`defaultWriteSpaceId`/`allowedSpaceIds`); never from input, never a global lookup.

`context.sources` records the provenance of each non-null value, so the projection is
auditable rather than implied.

### 4. Degradation is honest and never blocks activation

No graph, no stored scope, or a failed read returns `null` (or sets `degraded`) and the
activation result stands. Partial reads report which part failed and contribute zero — a
failed anomaly read is not rendered as "no anomalies".

### 5. The digest explains bytes, not claims

`evolution.applied[].content_digest` is presented as the integrity of that snapshot. The
explanation sentence names the snapshot, its actor, time and reason; it never asserts that
the recorded change was correct.

## Consequences

**Positive**

- An agent chooses an adapter with its history, open evidence and applied evolution visible.
- No new agent-facing graph surface was added, so the port of ADR 0044 stays closed.
- Cross-team retrieval is impossible by construction: the scope comes from the stored
  record and the permitted space context.
- The projection is cheap: bounded reads on one key, plus a capped evidence list.

**Negative**

- The projection is fixed: a caller cannot ask for an arbitrary subgraph (that is the
  price of not adding a query tool).
- It adds a handful of reads to every activation that resolves a match; all are covered by
  the existing indexes and caps.
- `ontology_context` is absent when the graph is unavailable, so consumers must treat
  absence as "unknown", not "empty".

## Evidence

- `src/tools/activate-ontology-context.ts`,
  `src/services/graph-db/ontology-context/{types,evidence}.ts`,
  `src/tools/activate.ts`, `src/tools/activate_schema.ts`.
- `tests/integration/graph-db-activate-context.test.ts` (real LadybugDB + real LanceDB):
  scoped reads, scope isolation between two spaces, applied-evolution explanation,
  degradation when the graph is absent.

## Alternatives considered

- **A `graph_query` MCP tool.** Rejected: the spec excludes agent-facing query-language
  access, and it would reopen ADR 0044's surface.
- **Return the whole graph for the adapter.** Rejected: unbounded payload, and it exposes
  neighbouring entities the caller did not ask about.
- **Let the caller pass `human`/`org` URIs.** Rejected: that is a self-declared authority
  and defeats team isolation.
- **Fail activation when context is unavailable.** Rejected: context is an aid, not a
  precondition; failing would turn a degradation into an outage.

## Reopening trigger

Revisit if: a caller needs a genuinely different projection (add a named projection, not a
query tool), an operator grants explicit cross-space retrieval with an auditable grant, or
activation latency shows the projection is not negligible at scale.
