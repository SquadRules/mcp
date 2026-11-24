# Issue #293: SquadRules 6: Multi-database architecture with graph-native ontological knowledge system

> Archived 2026-11-24 when the SquadRules 6 workstream was benched (branch `squadrules-6` renamed to `archive/squadrules-6`).
> Source: https://github.com/SquadRules/mcp/issues/293 · opened 2026-11-05T12:56:02Z by @jakub-plichcinski · state at archive: OPEN · labels: none

## Context

SquadRules 6 introduces a multi-database architecture specialized for ontological knowledge representation:
- Graph DB (NEW): ontological relationships, inheritance, anomalies
- Vector DB (RETAINED): semantic search (LanceDB embedded, Qdrant shared)
- SQL DB (RETAINED): structured metadata (SQLite embedded, PostgreSQL shared)

All databases have embedded modes (zero installation burden) and shared modes (enterprise/scalable).

## Design Documents

- ADRs 0041–0049 — see [`docs/adr/README.md`](../blob/squadrules-6/docs/adr/README.md) index for status
- Ontological Knowledge System spec: [`docs/specs/ontological-knowledge-system.md`](../blob/squadrules-6/docs/specs/ontological-knowledge-system.md)
- Graph schema: [`docs/specs/graph-schema.md`](../blob/squadrules-6/docs/specs/graph-schema.md)
- AI-Centered UX Design spec: [`docs/specs/ai-centered-ux-design.md`](../blob/squadrules-6/docs/specs/ai-centered-ux-design.md)
- Inheritance simulation: [`docs/specs/inheritance-simulation.md`](../blob/squadrules-6/docs/specs/inheritance-simulation.md)
- Technology evaluation: [`docs/specs/graph-database-technology-evaluation.md`](../blob/squadrules-6/docs/specs/graph-database-technology-evaluation.md)
- License compatibility matrix: [`docs/specs/license-compatibility-matrix.md`](../blob/squadrules-6/docs/specs/license-compatibility-matrix.md)
- LadybugDB prototype write-up: [`docs/specs/ladybugdb-prototype.md`](../blob/squadrules-6/docs/specs/ladybugdb-prototype.md)

## Implementation Tasks

The list below reflects the delivered state on `squadrules-6` (tip `40af9c75` on
2026-11-09). Two Phase 5 items were intentionally **superseded** by the design
decision in [ADR 0042](../blob/squadrules-6/docs/adr/0042-graph-owned-by-runtime-scoped-keys-derived-topology.md)
that the graph is a derived projection of stored records rather than a replacement
store; the corresponding migration is not scheduled and the items are annotated
below rather than checked off.

### Phase 1: Foundation — delivered
- [x] Validate license compatibility — `docs/specs/license-compatibility-matrix.md`
- [x] Define graph schema (concepts / adapters / anomalies / versions; inherits / specialized_by / contradicts / instances edges) — `docs/specs/graph-schema.md`, [ADR 0042](../blob/squadrules-6/docs/adr/0042-graph-owned-by-runtime-scoped-keys-derived-topology.md), [ADR 0044](../blob/squadrules-6/docs/adr/0044-graph-repository-port-and-arango-shared-backend.md)
- [x] Implement graph layer abstraction (mode-agnostic `GraphRepository` port) — `src/services/graph-db/graph-repository.ts`, [ADR 0044](../blob/squadrules-6/docs/adr/0044-graph-repository-port-and-arango-shared-backend.md)
- [x] Prototype with LadybugDB (embedded, MIT) — `src/services/graph-db/ladybug/*`, `docs/specs/ladybugdb-prototype.md`, [PR #294](https://github.com/SquadRules/mcp/pull/294)

### Phase 2: Core Features — delivered
- [x] Inheritance resolution at activation time — `src/services/graph-db/adapter-inheritance.ts`, `src/tools/activate-inheritance.ts`, [ADR 0043](../blob/squadrules-6/docs/adr/0043-additive-selective-inheritance-and-inheritance-checkpoints.md)
- [x] Anomaly detection (primitive-property disagreement, exact Must Always/Never opposition) — `src/services/graph-db/evolution/detection.ts`, [ADR 0046](../blob/squadrules-6/docs/adr/0046-evidence-gated-evolution-proposals.md)
- [x] Backpropagation (child discoveries raise evidence-gated parent proposals) — `src/services/graph-db/evolution/{consensus,evolution-plans,evolution-proposal-record,evolution.service}.ts`, [ADR 0046](../blob/squadrules-6/docs/adr/0046-evidence-gated-evolution-proposals.md)
- [x] Ontological versioning (immutable per-adapter Version snapshots with content digests) — `src/services/graph-db/graph-history.service.ts`, [ADR 0045](../blob/squadrules-6/docs/adr/0045-graph-native-history-and-restore.md)
- [x] Checkpoint generation (owner-instance restart state, never a proof) — `src/services/graph-db/inheritance-checkpoint.ts`, [ADR 0043](../blob/squadrules-6/docs/adr/0043-additive-selective-inheritance-and-inheritance-checkpoints.md)

### Phase 3: Integration — delivered
- [x] Vector DB integration — LanceDB (embedded) / Qdrant (shared) retained unchanged; per [ADR 0042](../blob/squadrules-6/docs/adr/0042-graph-owned-by-runtime-scoped-keys-derived-topology.md) the vector store remains the source of truth for adapter records and the graph is a derived projection
- [x] SQL DB integration — SQLite / PostgreSQL retained for structured metadata
- [x] Cross-database queries — delivered as an activate-time server-composed projection (`ontology_context`) rather than a query-language surface, per [ADR 0047](../blob/squadrules-6/docs/adr/0047-activate-time-ontology-context.md)
- [x] Data partitioning defined — graph stores relationships / anomalies / versions; vector store owns adapter record content and embeddings; SQL stores metadata; documented in [ADR 0042](../blob/squadrules-6/docs/adr/0042-graph-owned-by-runtime-scoped-keys-derived-topology.md) and [ADR 0044](../blob/squadrules-6/docs/adr/0044-graph-repository-port-and-arango-shared-backend.md)

### Phase 4: Shared Mode — delivered
- [x] Deploy ArangoDB ≤v3.11 (Apache-2.0, shared) — `src/services/graph-db/arango/*`, `src/config/graph-backend.ts`, [ADR 0044](../blob/squadrules-6/docs/adr/0044-graph-repository-port-and-arango-shared-backend.md)
- [x] Consensus mechanisms (≥3 distinct children threshold, evidence then human-expert then agent-majority then branch) — `src/services/graph-db/evolution/consensus.ts`, [ADR 0046](../blob/squadrules-6/docs/adr/0046-evidence-gated-evolution-proposals.md)
- [x] Test dual-mode deployment — CI `verify-integration-graph` lane runs both Arango suites against an `arangodb:3.11` service container; [ADR 0048](../blob/squadrules-6/docs/adr/0048-required-shared-backend-ci-lane.md)
- [x] Validate mode agnosticism — the `GraphRepository` port is the only way the runtime reaches either backend; [ADR 0044](../blob/squadrules-6/docs/adr/0044-graph-repository-port-and-arango-shared-backend.md)

### Phase 5: Migration — partially superseded by design
- [x] Decompose single-DB architecture into specialized layers — vector + graph + SQL each own their scope; embedded and shared variants wired through `src/config/graph-backend.ts` and the memory stores
- [~] Migrate adapter storage to graph DB — **superseded by [ADR 0042](../blob/squadrules-6/docs/adr/0042-graph-owned-by-runtime-scoped-keys-derived-topology.md)**: the vector store owns adapter records; the graph is a derived projection of them, written nodes-first-then-edges, reconciled on boot. No migration task remains.
- [~] Migrate metadata to SQL DB — **superseded by [ADR 0042](../blob/squadrules-6/docs/adr/0042-graph-owned-by-runtime-scoped-keys-derived-topology.md) scope split**: SQLite/PostgreSQL already own structured metadata (users, spaces, execution history); no additional migration surface is scheduled by the accepted design.
- [x] Retain vector DB for embeddings — unchanged
- [ ] Test production deployment (embedded + shared modes) — a real production bake beyond the CI-parity gate is still open

## Technology Decisions

- **Embedded graph DB:** LadybugDB (MIT, Kuzu fork, native, fast) — **updated from Kuzu (archived)**
- **Shared graph DB:** ArangoDB ≤v3.11 (Apache-2.0, multi-model) — **updated from Neo4j (GPL incompatible)**
- **Vector DB:** LanceDB (embedded) / Qdrant (shared) — retained
- **SQL DB:** SQLite (embedded) / PostgreSQL (shared) — retained

## License Compatibility Findings

- ✅ **LadybugDB (MIT):** Compatible
- ✅ **ArangoDB ≤v3.11 (Apache 2.0):** Compatible (must pin; v3.12 switched to BSL 1.1)
- ❌ **Neo4j Community (GPL v3):** Incompatible for embedded deployment with MIT
- ❌ **FalkorDB (SSPL v1):** Incompatible

See [`docs/specs/license-compatibility-matrix.md`](../blob/squadrules-6/docs/specs/license-compatibility-matrix.md) for the full analysis.

## Acceptance Criteria

- [x] Graph DB stores ontological relationships (inheritance, anomalies, versioning)
- [x] Inheritance resolution works at activation time (parent + delta materialization)
- [x] Anomaly detection and backpropagation functional (evidence-gated evolution proposals)
- [x] Dual-mode deployment validated (embedded + shared, proven by the required `verify-integration-graph` CI lane)
- [x] Cross-database queries operational (delivered as activate-time composition per [ADR 0047](../blob/squadrules-6/docs/adr/0047-activate-time-ontology-context.md))
- [x] Zero installation burden for embedded mode (LadybugDB + LanceDB + SQLite all in-process)
- [x] Mode-agnostic API (same `GraphRepository` interface for embedded and shared)
- [x] All database licenses compatible with SquadRules MIT license

## Delivery

- Branch: `squadrules-6` (this repository's consolidation branch for SquadRules 6)
- [PR #294](https://github.com/SquadRules/mcp/pull/294) — Graph schema specification and LadybugDB prototype (squash-merged `87ddc543`)
- [PR #295](https://github.com/SquadRules/mcp/pull/295) — Ontological knowledge graph integrated into adapter lifecycle (squash-merged `7bc6d8ca`)
- [PR #296](https://github.com/SquadRules/mcp/pull/296) — Instance-owned repository port, Arango shared backend, inheritance evolution, ontology context (squash-merged `40af9c75`, 2026-11-09)

## Follow-ups

- [ ] [#297](https://github.com/SquadRules/mcp/issues/297) — CI gate for [ADR 0049](../blob/squadrules-6/docs/adr/0049-drain-handles-on-graceful-shutdown-instead-of-process-exit.md) shutdown-handler `SIGABRT` reproducer
- [ ] Production bake for Phase 5 (embedded + shared deployment validation beyond CI parity)

## Principles

- Autonomy, help-not-puzzles, honest verification — see [`docs/adapter-design-principles.md`](../blob/squadrules-6/docs/adapter-design-principles.md)
- Architecture: ontological differentiation, anomaly-driven taxonomy evolution

---

## Comments

### @lvca — 2026-11-05T20:42:51Z

Have you checked ArcadeDB already? https://arcadedb.com.
