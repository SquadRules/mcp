# ADR 0041: Graph-Native Open-Source Database for Ontological Knowledge System

## Status

**Proposed** — 2026-11-05

## Context

SquadRules requires a knowledge storage layer capable of representing ontological relationships (inheritance, specialization, contradiction, instantiation) and supporting anomaly-driven taxonomy evolution. The existing vector database (Qdrant) excels at semantic similarity search but cannot natively represent or traverse graph relationships.

The ontological knowledge system design (see `docs/specs/ontological-knowledge-system.md`) requires:
- **Graph-native storage** — nodes, edges, properties with native traversal algorithms
- **Ontological versioning** — track taxonomy evolution over time
- **Anomaly detection** — store contradictions, resolutions, triggers
- **Dual-mode deployment** — embedded (single-machine) and shared (enterprise/scalable)
- **Open-source licensing** — no proprietary database dependencies

## Decision

**Use graph-native, open-source databases for SquadRules 6.**

### Technology constraints

1. **Graph-native only** — database must store and query graph data structures (nodes, edges, properties) as first-class citizens, not as tables with foreign keys or vectors with metadata.
2. **Open-source only** — no proprietary licenses (Apache 2.0, MIT, GPL, or similar).
3. **No SQLite/PostgreSQL with graph plugins** — relational databases with graph extensions (e.g., Apache AGE for PostgreSQL) are rejected because they are not graph-native; they simulate graph operations on top of relational storage, resulting in suboptimal traversal performance and limited expressiveness.
4. **Dual-mode architecture** — the system must support both embedded (single-machine, zero-dependency) and shared (distributed, scalable) deployment modes with the same data model and API surface.

### Dual-mode architecture

**Mode 1: Embedded graph DB (single-machine)**
- Zero external dependencies (no separate database server process)
- File-based persistence (graph survives restarts)
- Multi-process safety (concurrent agent access with appropriate locking)
- Lightweight footprint (<100 MB memory for typical ontologies)
- Native graph traversal for inheritance resolution, anomaly detection, backpropagation
- Ontological versioning (track changes over time)
- **Limitations:** single-machine only, no distributed consensus, limited scalability (thousands of adapters, not millions)

**Mode 2: Shared scalable graph DB (enterprise)**
- Distributed architecture (horizontal scaling across multiple nodes)
- Multi-agent concurrent access with consistency guarantees (ACID or eventual consistency)
- Shared ontology across team/organization (multiple agents contribute to collective knowledge)
- Consensus mechanisms for anomaly resolution (e.g., ≥3 children threshold for parent update)
- Hybrid queries: graph traversal + vector search (semantic similarity within graph context)
- Ontological versioning with distributed consensus
- High availability and fault tolerance
- **Limitations:** requires separate database server, operational complexity

### Mode agnosticism principle

The ontological knowledge system must be **mode-agnostic**:
- **Same data model** — graph nodes, edges, properties are identical in both modes
- **Same traversal algorithms** — inheritance resolution, anomaly detection, backpropagation logic are mode-independent
- **Same API surface** — `activate`, `train`, `query` operations have identical signatures
- **Only storage backend differs** — embedded file vs distributed cluster

This mirrors the existing SquadRules pattern: LanceDB (embedded) ↔ Qdrant (shared) for vector storage.

## Consequences

### Positive

1. **Native graph operations** — inheritance resolution, anomaly detection, and ontological traversal are first-class operations, not emulated via SQL joins or vector similarity.
2. **Open-source alignment** — no licensing costs, community-driven development, full control over deployment.
3. **Dual-mode flexibility** — same system works for local development (embedded) and enterprise deployment (shared), reducing cognitive load and maintenance burden.
4. **Performance** — graph-native databases optimize for traversal operations (O(1) edge lookups), unlike relational databases which require expensive joins.
5. **Expressiveness** — graph query languages (Cypher, Gremlin, GQL) are more natural for ontological relationships than SQL.

### Negative

1. **Technology selection deferred** — this ADR specifies constraints but does not choose specific databases. Implementation phase must evaluate:
   - Embedded: Kuzu, DuckDB (with graph extensions), or custom in-memory graph
   - Shared: Neo4j, ArangoDB, FalkorDB, Apache TinkerPop-compatible stores
2. **Migration complexity** — existing Qdrant-based vector storage must coexist with new graph storage during transition period.
3. **Learning curve** — team must learn graph database operations, query languages, and deployment patterns.
4. **Operational overhead (shared mode)** — distributed graph databases require cluster management, consistency tuning, and fault tolerance configuration.

### Neutral

1. **Hybrid queries** — some graph databases (Neo4j) support vector search natively; others may require separate vector index. Design must accommodate both patterns.
2. **Versioning model** — ontological versioning (taxonomy evolution) is distinct from database versioning (schema migrations). Both must be supported.

## Implementation Path

### Phase 1: Data model finalization (current)
- Define graph schema: node types (concept, adapter, anomaly), edge types (inherits, specialized_by, contradicts, instances), property structures
- Specify traversal algorithms: path-to-root resolution, anomaly backpropagation, consensus detection
- Document API surface: activate, train, query operations

### Phase 2: Technology evaluation (next)
- Evaluate embedded graph databases against requirements (zero-dependency, file-based, multi-process safe, <100 MB)
- Evaluate shared graph databases against requirements (distributed, consensus, hybrid queries, high availability)
- Select one database per mode (or one database supporting both modes)

### Phase 3: Prototype (implementation)
- Build minimal prototype with one parent-child adapter pair
- Implement inheritance resolution at activation time
- Test anomaly detection and backpropagation
- Validate dual-mode deployment (embedded + shared)

### Phase 4: Migration (production)
- Migrate existing adapter storage to graph database
- Implement ontological versioning for adapter evolution
- Add consensus mechanisms for collective ontology
- Deploy in both modes (embedded for local dev, shared for enterprise)

## Relationship to Other ADRs

- **ADR 0003** (no-lancedb-store-snapshot) — established dual-mode pattern (embedded ↔ shared); this ADR extends it to graph storage.
- **ADR 0013** (embedded-store-multiprocess-safety) — embedded graph DB must satisfy same multi-process safety requirements.
- **ADR 0024** (adapter-contract-verification-ladder) — graph storage enables ontological verification (inheritance resolution, anomaly detection) beyond structural validation.

## Expiry Conditions

This decision expires when:
1. A superior storage model emerges (e.g., hypergraph databases, temporal knowledge graphs) that better captures ontological relationships
2. Open-source graph databases fail to meet dual-mode requirements (embedded + shared)
3. SquadRules pivots away from ontological knowledge representation (unlikely given core architecture)

## References

- Ontological Knowledge System spec: `docs/specs/ontological-knowledge-system.md`
- AI-Centered UX Design spec: `docs/specs/ai-centered-ux-design.md`
- Inheritance simulation: `docs/specs/inheritance-simulation.md`
- Graph database comparison: [Neo4j vs ArangoDB vs FalkorDB](https://db-engines.com/en/ranking/graph+dbms) (external resource)
