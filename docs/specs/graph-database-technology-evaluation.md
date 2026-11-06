# Graph Database Technology Evaluation for SquadRules 6

**Status:** Research Draft  
**Created:** 2026-11-05  
**Purpose:** Evaluate open-source graph databases for ontological knowledge system  
**Context:** SquadRules 6 multi-database architecture (graph + vector + SQL)

---

## Executive Summary

This document evaluates graph database options for SquadRules 6's ontological knowledge system. The system requires:

- **Graph-native storage** — nodes, edges, properties with native traversal
- **Dual-mode deployment** — embedded (zero installation) and shared (enterprise/scalable)
- **Open-source licensing** — no proprietary dependencies
- **Ontological operations** — inheritance resolution, anomaly detection, backpropagation, versioning

**Recommendation (updated after license validation):**

- **Embedded mode:** LadybugDB (MIT license, Kuzu fork) — **changed from Kuzu (archived Oct 2025)**
- **Shared mode:** ArangoDB ≤v3.11 (Apache 2.0) — **changed from Neo4j (GPL v3 incompatible with MIT)**

**License compatibility findings:**

- ✅ LadybugDB (MIT) — Fully compatible with SquadRules MIT license
- ✅ ArangoDB ≤v3.11 (Apache 2.0) — Compatible (must pin version to avoid BSL 1.1 in v3.12+)
- ❌ Neo4j Community (GPL v3) — Incompatible for embedded deployment with MIT
- ❌ FalkorDB (SSPL v1) — Incompatible (SaaS copyleft)

See `docs/specs/license-compatibility-matrix.md` for full analysis.

---

## Requirements Matrix

### Functional Requirements

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| FR1 | Native graph data model (nodes, edges, properties) | Must-have | Ontological relationships are first-class citizens |
| FR2 | Graph traversal algorithms (path-to-root, depth-first, breadth-first) | Must-have | Inheritance resolution requires efficient traversal |
| FR3 | Property storage on nodes and edges | Must-have | Store adapter metadata, anomaly details, version history |
| FR4 | Cypher or similar declarative query language | Should-have | Expressive queries for ontological relationships |
| FR5 | Vector search integration | Nice-to-have | Semantic similarity within graph context |
| FR6 | Full-text search | Nice-to-have | Search adapter content within graph |
| FR7 | ACID transactions | Should-have | Consistent ontology updates |
| FR8 | Ontological versioning (custom) | Must-have | Track taxonomy evolution over time (application-level) |

### Non-Functional Requirements

| ID | Requirement | Priority | Target |
|----|-------------|----------|--------|
| NFR1 | Embedded mode: zero external dependencies | Must-have | No separate server process |
| NFR2 | Embedded mode: file-based persistence | Must-have | Graph survives restarts |
| NFR3 | Embedded mode: multi-process safety | Must-have | Concurrent agent access |
| NFR4 | Embedded mode: lightweight footprint | Should-have | <100 MB memory for typical ontologies |
| NFR5 | Shared mode: horizontal scaling | Must-have | Distributed cluster support |
| NFR6 | Shared mode: high availability | Should-have | Fault tolerance |
| NFR7 | Shared mode: multi-agent concurrent access | Must-have | Team/org-wide ontology sharing |
| NFR8 | Open-source license | Must-have | Apache 2.0, MIT, or GPL |
| NFR9 | Performance: graph traversal | Must-have | O(1) edge lookups, sub-second path queries |
| NFR10 | Performance: write throughput | Should-have | >1000 updates/second for ontology evolution |

---

## Embedded Mode Evaluation

### Candidate 1: LadybugDB (Kuzu fork)

**Overview:** Embedded property graph database built for query speed and scalability. Active fork of archived Kuzu (Oct 2025). Optimized for complex analytical workloads on very large graphs.

**Key Features:**

- ✅ Native graph database (property graph model)
- ✅ Embedded (in-process, zero external dependencies)
- ✅ File-based persistence
- ✅ Open-source (MIT license) — **Fully compatible with SquadRules MIT**
- ✅ Cypher-like query language
- ✅ Vector search built-in (as of 2025-2026)
- ✅ Full-text search built-in
- ✅ Query parallelism for performance
- ✅ Multi-process safety (via file locking)

**Strengths:**

- **License compatibility:** MIT license, same as SquadRules — zero restrictions
- **Performance:** Optimized for analytical workloads, very fast traversal
- **Simplicity:** Embedded, zero-config, file-based
- **Features:** Vector search + full-text search integrated (reduces need for separate databases)
- **Active development:** Fork of archived Kuzu, continued maintenance

**Weaknesses:**

- **Maturity:** Relatively new (2025-2026 as LadybugDB, 2023-2025 as Kuzu), smaller community than Neo4j
- **Documentation:** Less extensive than Neo4j
- **Ecosystem:** Fewer tools, integrations, and third-party libraries
- **Kuzu archival:** Original Kuzu archived Oct 2025 — LadybugDB is the continuation

**Fit for SquadRules 6:**

- ✅ Meets all must-have functional requirements
- ✅ Meets all must-have non-functional requirements for embedded mode
- ✅ Vector search integration reduces multi-database complexity
- ✅ **MIT license ensures full compatibility with SquadRules**
- ⚠️ Maturity risk — mitigate by abstracting graph layer (swap if needed)

**Verdict:** **PRIMARY CHOICE for embedded mode** (updated from Kuzu due to archival and license compatibility)

---

### Candidate 2: FalkorDB Lite

**Overview:** Embedded Python graph database with zero-config setup. Process isolation and Unix socket communication.

**Key Features:**

- ✅ Native graph database (property graph model)
- ✅ Embedded (Python library, zero-config)
- ✅ Open-source (AGPL v3 license)
- ✅ Cypher query language
- ✅ Redis-based performance (in-memory)
- ✅ Process isolation

**Strengths:**

- **Performance:** Redis-based, very fast in-memory operations
- **Simplicity:** Python-native, zero-config
- **Query language:** Full Cypher support

**Weaknesses:**

- **License:** AGPL v3 (copyleft, may restrict commercial use)
- **Persistence:** In-memory by default, file persistence requires configuration
- **Multi-process safety:** Process isolation via Unix sockets (may not suit all deployment scenarios)
- **Memory footprint:** In-memory may exceed 100 MB for large ontologies

**Fit for SquadRules 6:**

- ✅ Meets functional requirements
- ⚠️ AGPL license may be restrictive
- ⚠️ Memory footprint may be too large for embedded mode
- ⚠️ Persistence model less clear than Kuzu

**Verdict:** **ALTERNATIVE for embedded mode** (if Kuzu fails)

---

### Candidate 3: DuckDB + Graph Extensions

**Overview:** DuckDB is an embedded analytical database with graph extensions (e.g., Apache AGE plugin).

**Key Features:**

- ✅ Embedded (in-process, zero external dependencies)
- ✅ Open-source (MIT license)
- ✅ SQL query language
- ⚠️ Graph extensions via plugins (Apache AGE)

**Strengths:**

- **Simplicity:** Embedded, zero-config
- **License:** MIT (permissive)
- **SQL ecosystem:** Leverage existing SQL knowledge

**Weaknesses:**

- ❌ **Not graph-native** — relational database with graph plugins
- ❌ Violates SquadRules 6 constraint: "no SQLite/PostgreSQL with graph plugins"
- ❌ Graph operations emulated via SQL joins (suboptimal performance)

**Fit for SquadRules 6:**

- ❌ Fails graph-native requirement
- ❌ Explicitly rejected by architecture decision

**Verdict:** **REJECTED** (not graph-native)

---

### Embedded Mode Comparison Matrix

| Criterion | LadybugDB | FalkorDB Lite | DuckDB + Extensions |
|-----------|-----------|---------------|---------------------|
| Graph-native | ✅ Yes | ✅ Yes | ❌ No (relational + plugin) |
| Embedded | ✅ Yes | ✅ Yes | ✅ Yes |
| Zero dependencies | ✅ Yes | ✅ Yes | ✅ Yes |
| File persistence | ✅ Yes | ⚠️ Configurable | ✅ Yes |
| Multi-process safe | ✅ Yes | ⚠️ Unix sockets | ✅ Yes |
| Open-source license | ✅ MIT (compatible) | ⚠️ AGPL v3 (incompatible) | ✅ MIT (compatible) |
| Cypher query language | ✅ Yes (Cypher-like) | ✅ Yes (full Cypher) | ❌ No (SQL) |
| Vector search | ✅ Built-in | ❌ No | ❌ No |
| Full-text search | ✅ Built-in | ❌ No | ✅ Yes (SQL) |
| Performance (traversal) | ✅ Very fast | ✅ Very fast (in-memory) | ⚠️ Moderate (joins) |
| Memory footprint | ✅ <100 MB | ⚠️ >100 MB (in-memory) | ✅ <100 MB |
| Maturity | ⚠️ New (2025-2026) | ⚠️ New (2025-2026) | ✅ Mature (DuckDB) |
| Community size | ⚠️ Small | ⚠️ Small | ✅ Medium |
| **Overall fit** | ✅ **PRIMARY** | ❌ **REJECTED (license)** | ❌ **REJECTED (not graph-native)** |

---

## Shared Mode Evaluation

### Candidate 1: ArangoDB ≤v3.11

**Overview:** Multi-model database (document + graph + vector). Native graph support with AQL query language. Version ≤v3.11 uses Apache 2.0 license (compatible with MIT).

**Key Features:**

- ✅ Native graph database (property graph model)
- ✅ Multi-model (document + graph + vector in one database)
- ✅ Open-source (Apache 2.0 license for ≤v3.11) — **Compatible with SquadRules MIT**
- ✅ AQL query language (SQL-like for graphs)
- ✅ Vector search (ArangoDB 3.10+)
- ✅ Full-text search
- ✅ ACID transactions
- ✅ Distributed cluster support (open-source, ≤v3.11)

**Strengths:**

- **License compatibility:** Apache 2.0 (≤v3.11), permissive, no copyleft restrictions
- **Multi-model:** Document + graph + vector in one database (reduces multi-DB complexity)
- **Clustering:** Distributed cluster support in open-source version (no commercial license needed for ≤v3.11)
- **Query language:** AQL is SQL-like, easier for teams with SQL background
- **Performance:** Scales writes and multi-hop traversals natively

**Weaknesses:**

- **Version pinning required:** Must pin to ≤v3.11 to avoid BSL 1.1 license change in v3.12+
- **Maturity:** Less mature than Neo4j for pure graph workloads
- **Community:** Smaller graph-specific community than Neo4j
- **Complexity:** Multi-model adds complexity (more features to learn)
- **License risk:** ArangoDB changed license in v3.12+ to BSL 1.1 (restricts commercial use)

**Fit for SquadRules 6:**

- ✅ Meets all functional requirements
- ✅ Meets all non-functional requirements
- ✅ Apache 2.0 license (≤v3.11) is permissive, compatible with MIT
- ✅ Clustering in open-source version (no commercial license needed)
- ⚠️ Must pin version to ≤v3.11 to avoid BSL 1.1 license
- ⚠️ Less mature than Neo4j for pure graph workloads

**Verdict:** **PRIMARY CHOICE for shared mode** (updated from Neo4j due to GPL v3 incompatibility with MIT)

---

### Candidate 2: ArangoDB

**Overview:** Multi-model database (document + graph + vector). Native graph support with AQL query language.

**Key Features:**

- ✅ Native graph database (property graph model)
- ✅ Multi-model (document + graph + vector in one database)
- ✅ Open-source (Apache 2.0 license)
- ✅ AQL query language (SQL-like for graphs)
- ✅ Vector search (ArangoDB 3.10+)
- ✅ Full-text search
- ✅ ACID transactions
- ✅ Distributed cluster support (open-source)

**Strengths:**

- **Multi-model:** Document + graph + vector in one database (reduces multi-DB complexity)
- **License:** Apache 2.0 (permissive, no copyleft restrictions)
- **Clustering:** Distributed cluster support in open-source version
- **Query language:** AQL is SQL-like, easier for teams with SQL background
- **Performance:** Scales writes and multi-hop traversals natively

**Weaknesses:**

- **Maturity:** Less mature than Neo4j for pure graph workloads
- **Community:** Smaller graph-specific community than Neo4j
- **Complexity:** Multi-model adds complexity (more features to learn)

**Fit for SquadRules 6:**

- ✅ Meets all functional requirements
- ✅ Meets all non-functional requirements
- ✅ Apache 2.0 license (permissive, no restrictions)
- ✅ Clustering in open-source version (no commercial license needed)
- ⚠️ Less mature than Neo4j for pure graph workloads

**Verdict:** **ALTERNATIVE for shared mode** (if multi-model appealing)

---

### Candidate 3: FalkorDB

**Overview:** Redis-based graph database optimized for low-latency inference-time retrieval.

**Key Features:**

- ✅ Native graph database (property graph model)
- ✅ Redis-based (in-memory, very low latency)
- ✅ Open-source (AGPL v3 license)
- ✅ Cypher query language
- ✅ Vector search
- ✅ High performance (sub-millisecond latency)

**Strengths:**

- **Performance:** Redis-based, very low latency (sub-millisecond)
- **Vector search:** Optimized for GenAI retrieval
- **Query language:** Cypher support

**Weaknesses:**

- **License:** AGPL v3 (copyleft, may restrict commercial use)
- **Memory footprint:** In-memory, may not handle graphs larger than RAM
- **Persistence:** Redis persistence model (RDB/AOF), less robust than ACID
- **Maturity:** Newer than Neo4j

**Fit for SquadRules 6:**

- ✅ Meets functional requirements
- ⚠️ AGPL license (copyleft)
- ⚠️ In-memory (may not scale to large ontologies)
- ⚠️ Persistence model less robust than Neo4j

**Verdict:** **NOT RECOMMENDED** (AGPL license, memory constraints)

---

### Shared Mode Comparison Matrix

| Criterion | ArangoDB ≤v3.11 | Neo4j Community | FalkorDB |
|-----------|-----------------|-----------------|----------|
| Graph-native | ✅ Yes | ✅ Yes | ✅ Yes |
| Distributed cluster | ✅ Open-source (≤v3.11) | ⚠️ Enterprise only | ⚠️ Redis cluster |
| Open-source license | ✅ Apache 2.0 (compatible) | ⚠️ GPL v3 (incompatible) | ⚠️ SSPL v1 (incompatible) |
| Cypher/AQL query language | ✅ AQL (SQL-like) | ✅ Cypher | ✅ Cypher |
| Vector search | ✅ Yes (3.10+) | ✅ Yes (5.x+) | ✅ Yes |
| Full-text search | ✅ Yes | ✅ Yes | ⚠️ Limited |
| ACID transactions | ✅ Yes | ✅ Yes | ⚠️ Redis persistence |
| High availability | ✅ Open-source (≤v3.11) | ⚠️ Enterprise only | ⚠️ Redis cluster |
| Multi-model | ✅ Document + graph + vector | ❌ Graph only | ❌ Graph only |
| Performance (traversal) | ✅ Fast (disk-based) | ✅ Fast (disk-based) | ✅ Very fast (in-memory) |
| Memory footprint | ⚠️ Moderate | ⚠️ JVM overhead | ⚠️ In-memory (large) |
| Handles graphs > RAM | ✅ Yes | ✅ Yes | ❌ No (in-memory) |
| Maturity | ✅ Mature (2012-) | ✅ Very mature (2007-) | ⚠️ Newer (2022-) |
| Community size | ✅ Medium | ✅ Largest | ⚠️ Small |
| **Overall fit** | ✅ **PRIMARY** | ❌ **REJECTED (license)** | ❌ **REJECTED (license)** |

---

## Recommendation (Updated After License Validation)

### Embedded Mode: **LadybugDB** (MIT license)

**Rationale:**

1. **Graph-native** — meets core architectural requirement
2. **MIT license** — fully compatible with SquadRules MIT license, zero restrictions
3. **Zero dependencies** — embedded, file-based, multi-process safe
4. **Vector search built-in** — reduces multi-database complexity
5. **Performance** — optimized for analytical workloads, fast traversal
6. **Lightweight** — <100 MB memory footprint
7. **Active development** — fork of archived Kuzu (Oct 2025), continued maintenance

**Risk mitigation:**

- Abstract graph layer (swap LadybugDB if maturity becomes issue)
- Monitor community growth and development activity
- Verify LadybugDB feature parity with Kuzu

**Previous recommendation:** Kuzu (archived Oct 2025, replaced with LadybugDB fork)

### Shared Mode: **ArangoDB ≤v3.11** (Apache 2.0 license)

**Rationale:**

1. **Apache 2.0 license (≤v3.11)** — compatible with SquadRules MIT license, permissive
2. **Multi-model** — document + graph + vector in one database (reduces database count)
3. **Open-source clustering** — HA without commercial license (for ≤v3.11)
4. **AQL** — SQL-like, easier for teams with SQL background
5. **Mature** — Active development since 2012, good community

**Critical constraint:**

- **Must pin to version ≤v3.11** — v3.12+ uses BSL 1.1 license (restricts commercial use)
- Monitor ArangoDB releases for license changes
- Have migration plan ready (to LadybugDB or other) if needed

**Previous recommendation:** Neo4j Community (GPL v3 incompatible with MIT for embedded deployment)

**When Neo4j might still be viable:**

- If deployed as separate network service (not embedded) — GPL "SaaS loophole"
- If commercial license obtained (Neo4j Enterprise)
- Consult legal counsel before relying on SaaS loophole

### Alternative: **LadybugDB for Both Modes**

**Rationale:**

1. **Single database** — simplifies deployment, maintenance, documentation
2. **MIT license** — zero restrictions for any deployment model
3. **Embedded + shared** — verify if LadybugDB supports distributed clustering

**Implementation:**

- Use LadybugDB for both embedded and shared deployments
- If LadybugDB lacks clustering, use ArangoDB ≤v3.11 for shared mode

### Rejected Options

**Neo4j Community (GPL v3):**

- ❌ Incompatible with MIT for embedded deployment
- ❌ Copyleft requires derivative works to be GPL
- ⚠️ May be viable as separate service (SaaS loophole) — consult legal

**FalkorDB (SSPL v1):**

- ❌ Incompatible with any deployment model (SaaS copyleft)
- ❌ Requires open-sourcing entire service stack if offered as service
- ❌ Not OSI-approved, high enterprise adoption barrier

**ArangoDB ≥v3.12 (BSL 1.1):**

- ❌ Restricts commercial use
- ❌ Source-available, not open-source (OSI-approved)
- ✅ Use ≤v3.11 (Apache 2.0) instead

---

## Implementation Path

### Phase 1: Prototype with Kuzu (embedded)

1. **Install Kuzu** — add as dependency to SquadRules server
2. **Define graph schema** — nodes (concepts, adapters), edges (inherits, specialized_by, contradicts, instances), properties
3. **Implement inheritance resolution** — path-to-root traversal at activation time
4. **Implement anomaly detection** — store contradictions, resolutions, triggers
5. **Test with example adapter** — validate parent-child inheritance (critic-loop → specialized-reviewer)

### Phase 2: Add Neo4j (shared mode)

1. **Deploy Neo4j** — standalone instance (Community Edition)
2. **Implement graph layer abstraction** — same API for Kuzu (embedded) and Neo4j (shared)
3. **Test dual-mode deployment** — validate mode agnosticism
4. **Implement consensus mechanisms** — ≥3 children threshold for parent update (shared mode only)

### Phase 3: Integrate with existing databases

1. **Vector DB (LanceDB/Qdrant)** — retain for semantic search
2. **SQL DB (SQLite/PostgreSQL)** — retain for structured metadata
3. **Cross-database queries** — graph traversal + vector similarity + SQL joins
4. **Data partitioning** — graph DB owns ontological relationships, vector DB owns embeddings, SQL DB owns metadata

### Phase 4: Production deployment

1. **Embedded mode** — all three databases in-process, zero installation
2. **Shared mode** — all three databases as distributed services, enterprise deployment
3. **Migration** — decompose existing single-DB (Qdrant) into specialized layers
4. **Monitoring** — track performance, memory usage, query latency

---

## Open Questions

1. **GPL v3 compatibility** — is Neo4j Community's GPL v3 license compatible with SquadRules licensing?
2. **Kuzu maturity** — is Kuzu mature enough for production use, or should we wait?
3. **Multi-database coordination** — how to coordinate queries across graph + vector + SQL efficiently?
4. **Data consistency** — how to ensure consistency across three databases (distributed transactions)?
5. **Backup/restore** — how to backup/restore three databases atomically?

---

## Next Steps

1. **Validate license compatibility** — confirm GPL v3 (Neo4j) and AGPL v3 (FalkorDB) are acceptable
2. **Prototype with Kuzu** — build minimal proof-of-concept for embedded mode
3. **Benchmark performance** — test traversal speed, write throughput, memory usage
4. **Evaluate ArangoDB** — if Neo4j GPL is unacceptable, test ArangoDB as alternative
5. **Create GitHub issue** — track implementation tasks for SquadRules 6

---

## References

- Kuzu: <https://github.com/kuzudb/kuzu>
- Neo4j: <https://neo4j.com/>
- ArangoDB: <https://arangodb.com/>
- FalkorDB: <https://www.falkordb.com/>
- Graph database comparison: <https://db-engines.com/en/ranking/graph+dbms>
- ADR 0041: `docs/adr/0041-graph-native-open-source-database-for-ontological-knowledge-system.md`
- Ontological Knowledge System spec: `docs/specs/ontological-knowledge-system.md`
