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

**Use multiple specialized databases for SquadRules 6, all open-source with embedded modes.**

### Architecture shift: from single-DB to multi-DB

**Previous constraint (SquadRules 1-5):** Single database (Qdrant) for both vector search and adapter storage to avoid forcing users to install multiple databases for simple deployments.

**New freedom (SquadRules 6+):** Modern embedded databases eliminate the installation burden. Users can run multiple specialized databases with zero external dependencies. This allows **best tool for each job** rather than compromise.

### Multi-database architecture

**Three specialized storage layers:**

1. **Graph DB (ontological relationships)** — NEW in SquadRules 6
   - Native graph storage for nodes (concepts, adapters), edges (inherits, specialized_by, contradicts, instances), properties
   - Graph traversal algorithms for inheritance resolution, anomaly detection, backpropagation
   - Ontological versioning (track taxonomy evolution)
   - **Embedded mode:** Kuzu, or similar native embedded graph DB
   - **Shared mode:** Neo4j, ArangoDB, FalkorDB, or similar scalable graph DB

2. **Vector DB (semantic search)** — EXISTING, retained
   - Embedding-based similarity search for adapter discovery, semantic matching
   - **Embedded mode:** LanceDB (already in use)
   - **Shared mode:** Qdrant (already in use)

3. **SQL DB (structured metadata)** — NEW in SquadRules 6
   - Transactional storage for adapter metadata, user preferences, organization conventions, execution history
   - Relational queries for structured data (JOINs, aggregations, constraints)
   - **Embedded mode:** SQLite (zero-dependency, file-based)
   - **Shared mode:** PostgreSQL (scalable, ACID-compliant)

### Technology constraints

1. **Open-source only** — no proprietary database licenses (Apache 2.0, MIT, GPL, or similar)
2. **Embedded mode for all** — each database must have an embedded variant (zero external dependencies, file-based persistence)
3. **Graph-native for ontological layer** — graph DB must be native (not SQLite/PostgreSQL with graph plugins)
4. **Best tool for each job** — each database optimized for its specific use case; no compromise single-DB architecture
5. **Mode agnosticism** — same data model and API surface in both embedded (single-machine) and shared (enterprise) deployment modes

### Dual-mode architecture

**Mode 1: Embedded (single-machine) — zero installation burden**
- **Graph DB:** Embedded native graph database (Kuzu or similar) — file-based, zero external dependencies
- **Vector DB:** Embedded LanceDB (already in use) — file-based, zero external dependencies
- **SQL DB:** Embedded SQLite (already in use for metadata) — file-based, zero external dependencies
- All three databases run in-process, persist to local files, require no separate server processes
- Multi-process safety via file locking or in-process coordination
- Lightweight footprint (<200 MB total memory for typical ontologies)
- **Limitations:** single-machine only, no distributed consensus, limited scalability

**Mode 2: Shared (enterprise/scalable) — distributed deployment**
- **Graph DB:** Scalable native graph database (Neo4j, ArangoDB, FalkorDB, or similar) — distributed cluster
- **Vector DB:** Scalable Qdrant (already in use) — distributed cluster
- **SQL DB:** Scalable PostgreSQL (already in use for metadata) — distributed cluster with ACID guarantees
- All three databases run as separate services, coordinated at application level
- Multi-agent concurrent access with consistency guarantees
- Shared ontology across team/organization (multiple agents contribute to collective knowledge)
- Consensus mechanisms for anomaly resolution (e.g., ≥3 children threshold for parent update)
- Hybrid queries: graph traversal + vector search + SQL joins across databases
- High availability and fault tolerance
- **Limitations:** requires separate database servers, operational complexity

### Mode agnosticism principle

The ontological knowledge system must be **mode-agnostic** across all three databases:
- **Same data model** — graph nodes/edges/properties, vector embeddings, SQL tables are identical in both modes
- **Same traversal algorithms** — inheritance resolution, anomaly detection, backpropagation logic are mode-independent
- **Same API surface** — `activate`, `train`, `query` operations have identical signatures regardless of backend
- **Only storage backends differ** — embedded files vs distributed clusters for each database type

This mirrors the existing SquadRules pattern: LanceDB (embedded) ↔ Qdrant (shared) for vector storage, now extended to graph and SQL layers.

## Consequences

### Positive

1. **Best tool for each job** — each database optimized for its specific use case (graph traversal, vector similarity, relational queries); no compromise single-DB architecture
2. **Native graph operations** — inheritance resolution, anomaly detection, and ontological traversal are first-class operations, not emulated via SQL joins or vector similarity
3. **Open-source alignment** — no licensing costs, community-driven development, full control over deployment
4. **Dual-mode flexibility** — same system works for local development (all embedded, zero installation) and enterprise deployment (all distributed, scalable), reducing cognitive load and maintenance burden
5. **Performance** — each database optimizes for its workload: graph DB for traversal (O(1) edge lookups), vector DB for similarity (ANN search), SQL DB for structured queries (indexed JOINs)
6. **Expressiveness** — graph query languages (Cypher, Gremlin, GQL) for ontological relationships, SQL for structured metadata, vector search for semantic similarity; each used where most natural

### Negative

1. **Technology selection deferred** — this ADR specifies constraints but does not choose specific databases. Implementation phase must evaluate:
   - Graph DB (embedded): Kuzu, or other native embedded graph DB
   - Graph DB (shared): Neo4j, ArangoDB, FalkorDB, or other scalable graph DB
   - SQL DB: already using SQLite (embedded) and PostgreSQL (shared) — retain or migrate
   - Vector DB: already using LanceDB (embedded) and Qdrant (shared) — retain or migrate
2. **Multi-database coordination** — application layer must coordinate queries across three databases (graph + vector + SQL), increasing complexity
3. **Migration complexity** — existing single-DB architecture (Qdrant for everything) must be decomposed into specialized layers during transition
4. **Learning curve** — team must learn graph database operations, query languages, and deployment patterns in addition to existing vector/SQL knowledge
5. **Operational overhead (shared mode)** — three distributed databases require cluster management, consistency tuning, and fault tolerance configuration (vs one in current architecture)

### Neutral

1. **Hybrid queries** — some graph databases (Neo4j) support vector search natively; others may require separate vector index. Design must accommodate both patterns. Cross-database queries (graph + vector + SQL) require application-level coordination.
2. **Versioning model** — ontological versioning (taxonomy evolution) is distinct from database versioning (schema migrations). Both must be supported. Graph DB owns ontological versions; SQL DB owns schema migrations.
3. **Data partitioning** — each database owns specific data:
   - Graph DB: ontological relationships (inherits, specialized_by, contradicts, instances), anomalies, version history
   - Vector DB: adapter embeddings for semantic search
   - SQL DB: adapter metadata, user preferences, organization conventions, execution history, audit logs

## Implementation Path

### Phase 1: Data model finalization (current)
- Define graph schema: node types (concept, adapter, anomaly), edge types (inherits, specialized_by, contradicts, instances), property structures
- Specify traversal algorithms: path-to-root resolution, anomaly backpropagation, consensus detection
- Document API surface: activate, train, query operations

### Phase 2: Technology evaluation (next)
- Evaluate embedded graph databases against requirements (zero-dependency, file-based, multi-process safe, <100 MB)
- Evaluate shared graph databases against requirements (distributed, consensus, hybrid queries, high availability)
- Select one graph database per mode (embedded + shared)
- Retain existing vector DB (LanceDB embedded, Qdrant shared) — no migration needed
- Retain existing SQL DB (SQLite embedded, PostgreSQL shared) — no migration needed
- Define data partitioning: what goes to graph DB vs vector DB vs SQL DB

### Phase 3: Prototype (implementation)
- Build minimal prototype with one parent-child adapter pair
- Implement graph DB integration: inheritance resolution at activation time, anomaly detection, backpropagation
- Integrate with existing vector DB: semantic search for adapter discovery
- Integrate with existing SQL DB: metadata storage, user preferences
- Test cross-database queries: graph traversal + vector similarity + SQL joins
- Validate dual-mode deployment (all embedded vs all distributed)

### Phase 4: Migration (production)
- Decompose existing single-DB architecture (Qdrant) into specialized layers:
  - Graph DB: ontological relationships, inheritance trees, anomalies
  - Vector DB: adapter embeddings (already in Qdrant, migrate to dedicated vector DB)
  - SQL DB: adapter metadata, execution history (already in Qdrant, migrate to dedicated SQL DB)
- Implement ontological versioning in graph DB
- Add consensus mechanisms for collective ontology (shared mode only)
- Deploy in both modes:
  - Embedded: all three databases in-process, zero installation
  - Shared: all three databases as distributed services, enterprise deployment

## Relationship to Other ADRs

- **ADR 0003** (no-lancedb-store-snapshot) — established dual-mode pattern (embedded ↔ shared); this ADR extends it to multi-database architecture (graph + vector + SQL)
- **ADR 0013** (embedded-store-multiprocess-safety) — embedded databases (graph, vector, SQL) must satisfy same multi-process safety requirements
- **ADR 0024** (adapter-contract-verification-ladder) — graph storage enables ontological verification (inheritance resolution, anomaly detection) beyond structural validation
- **ADR 0021** (embedding-provider-auto-resolution-and-store-width-binding) — vector DB layer retains existing embedding infrastructure; graph DB layer adds ontological relationships on top

## Expiry Conditions

This decision expires when:
1. A superior storage model emerges (e.g., unified multi-model database that natively supports graph + vector + relational operations without compromise)
2. Embedded databases become so lightweight that single-DB architecture is again preferable (reversing the multi-DB decision)
3. Open-source graph databases fail to meet dual-mode requirements (embedded + shared)
4. SquadRules pivots away from ontological knowledge representation (unlikely given core architecture)

## References

- Ontological Knowledge System spec: `docs/specs/ontological-knowledge-system.md`
- AI-Centered UX Design spec: `docs/specs/ai-centered-ux-design.md`
- Inheritance simulation: `docs/specs/inheritance-simulation.md`
- Graph database comparison: [Neo4j vs ArangoDB vs FalkorDB](https://db-engines.com/en/ranking/graph+dbms) (external resource)
