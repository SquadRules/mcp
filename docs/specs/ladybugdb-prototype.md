# LadybugDB Integration Prototype for SquadRules 6

This document describes the minimal proof-of-concept prototype demonstrating LadybugDB integration for SquadRules 6 embedded mode.

## Overview

**LadybugDB** is an MIT-licensed embedded property graph database (fork of archived Kuzu, Oct 2025) that provides:

- In-process execution (zero external dependencies)
- File-based persistence
- Cypher query language support
- One writable owner per database file, plus concurrent read-only processes
- High performance for analytical workloads

> **Single-writer.** The file lock rejects a second writable open; it does not queue
> writers. See [Multi-Process Safety](#multi-process-safety) before designing a deployment.

**SquadRules 6** uses a multi-database architecture:

- **Graph DB** (LadybugDB embedded): ontological relationships, inheritance trees
- **Vector DB** (LanceDB): adapter embeddings for semantic search
- **SQL DB** (SQLite): metadata, execution history, audit logs

This prototype demonstrates the **Graph DB** layer.

## Architecture

### Embedded Mode

```
┌─────────────────────────────────────┐
│   SquadRules Application            │
├─────────────────────────────────────┤
│   GraphDatabaseService              │
│   (TypeScript wrapper)              │
├─────────────────────────────────────┤
│   LadybugDB Core                    │
│   (@ladybugdb/core npm package)     │
├─────────────────────────────────────┤
│   File-based Storage                │
│   (.squadrules-graph-db/)           │
└─────────────────────────────────────┘
```

### Graph Schema

The schema is defined by `docs/specs/graph-schema.md`; this prototype created the first slice of it.

**Node Types:**

- `Adapter` - SquadRules adapters with frontmatter metadata
- `Concept` - Abstract categories and rules

**Edge Types:**

- `Inherits` - Child to parent inheritance relationship
- `SpecializedBy` - Parent to child reverse relationship (inverse of Inherits)

**Properties:**

- Adapter: `slug`, `version`, `title`, `frontmatter`, `layer_count`, `contract_types`, `space`, `tags`, `metadata`
- Edge: `relationship`, `inherited_fields`, `override_fields`, `created_at`, `metadata`

The delivered schema is wider than this prototype: the full node and relationship
list is `docs/specs/graph-schema.md` §7.1, created by
`src/services/graph-db/ladybug/ladybug-schema.ts`. Inheritance is still
adapter-to-adapter only (`Inherits` is `FROM Adapter TO Adapter`); concept and
instance inheritance are out of scope, not pending (§
[Delivered scope vs deferred scope](#delivered-scope-vs-deferred-scope)).

`inherited_fields` is written as `[]` on every `Inherits` edge and is not read by
resolution (`src/services/graph-db/ladybug/ladybug-adapter-writes.ts`
`createInheritanceEdge`). `override_fields` is an audit copy of the child's
`override:` frontmatter; the effective merge reads each level's `override:` itself
(`src/services/graph-db/inheritance-merge.ts` `mergeResolvedProperties`).

## Installation

### Prerequisites

- Node.js >= 24.0.0
- npm >= 10.0.0

### Dependencies

LadybugDB is included as a dependency in `package.json`:

```json
{
  "dependencies": {
    "@ladybugdb/core": "^0.22.2"
  }
}
```

Install with:

```bash
npm install
```

The package includes platform-specific native binaries for:

- macOS (darwin-arm64, darwin-x64)
- Linux (linux-arm64, linux-x64)
- Windows (win32-x64)

## Setup

### Initialize Database

```typescript
import { GraphDatabaseService } from './src/services/graph-db/index.js';

// Create service instance (default path: .squadrules-graph-db)
const db = new GraphDatabaseService();

// Or specify custom path
const db = new GraphDatabaseService('/path/to/database');

// Initialize (creates schema and opens connection)
await db.initialize();
```

### Database Path

The database is stored in a directory containing:

- Node tables and relationship tables (the delivered list is
  `docs/specs/graph-schema.md` §7.1)
- Transaction logs
- Index files

Default location: `.squadrules-graph-db/` in current working directory.

## API Reference

### Core Operations

#### Create Adapter Node

```typescript
const adapter: AdapterNode = {
  key: 'adapter:critic-loop',
  type: 'adapter',
  slug: 'critic-loop',
  version: '2.1.0',
  title: 'Critic Loop: Delegated Review Workflow',
  created_at: '2026-01-10T08:00:00Z',
  updated_at: '2026-03-15T14:22:00Z',
  frontmatter: {
    slug: 'critic-loop',
    version: '2.1.0',
    protocol_version: '1.0.0'
  },
  layer_count: 3,
  contract_types: ['shell', 'forward', 'subagent'],
  space: 'personal',
  tags: ['review', 'quality-gate'],
  metadata: {
    author: 'jakub.plichcinski'
  }
};

await db.createAdapterNode(adapter);
```

#### Create Inheritance Edge

```typescript
const edge: InheritanceEdge = {
  from: 'adapter:specialized-reviewer',
  to: 'adapter:critic-loop',
  relationship: 'inherits',
  // Written as [] by the writer; resolution does not read it.
  inherited_fields: [],
  // Audit copy of the child's `override:` frontmatter.
  override_fields: ['tags', 'metadata'],
  created_at: '2026-04-10T09:15:00Z',
  metadata: {
    inheritance_depth: 1,
    resolution_strategy: 'child-wins'
  }
};

await db.createInheritanceEdge(edge);
```

#### Path-to-Root Query

Find all ancestors of an adapter (inheritance chain):

```typescript
const ancestors = await db.findPathToRoot('adapter:specialized-reviewer');

// Returns:
// [
//   {
//     ancestor: { slug: 'critic-loop', version: '2.1.0', ... },
//     edge: { from: 'adapter:specialized-reviewer', to: 'adapter:critic-loop', ... },
//     depth: 1
//   },
//   {
//     ancestor: { slug: 'base-reviewer', version: '1.0.0', ... },
//     edge: { from: 'adapter:critic-loop', to: 'adapter:base-reviewer', ... },
//     depth: 2
//   }
// ]
```

#### Inheritance Resolution

Materialize full adapter content (parent base + child delta):

```typescript
const resolved = await db.resolveInheritance('adapter:specialized-reviewer');

// Returns:
// {
//   adapter: { slug: 'specialized-reviewer', ... },
//   resolved_properties: {
//     slug: 'specialized-reviewer',
//     version: '1.0.0',
//     layer_count: 3,  // inherited from parent
//     contract_types: ['shell', 'forward', 'subagent'],  // inherited
//     tags: ['custom-tag'],  // overridden by child
//     ...
//   },
//   inheritance_chain: [
//     { slug: 'critic-loop', ... }
//   ]
// }
```

#### Query Adapter

```typescript
const adapter = await db.getAdapter('adapter:critic-loop');
// Returns AdapterNode or null
```

#### List All Adapters

```typescript
const allAdapters = await db.getAllAdapters();
// Returns AdapterNode[]
```

### Database Lifecycle

```typescript
// Close connection
await db.close();

// Check initialization status
const isReady = db.isInitialized();

// Get database path
const path = db.getDatabasePath();
```

## Example Scenario

See `scripts/ladybugdb-demo.mjs` for a complete working example:

```bash
node scripts/ladybugdb-demo.mjs
```

**Demo Output:**

```
🐞 LadybugDB Prototype Demo

📦 Initializing embedded graph database...
✅ Database initialized at: /path/to/.demo-graph-db

🔧 Creating parent adapter: critic-loop
✅ Created critic-loop adapter

🔧 Creating child adapter: specialized-reviewer
✅ Created specialized-reviewer adapter

🔗 Creating inheritance edge (child → parent)
✅ Created inheritance edge

🔍 Executing path-to-root query for specialized-reviewer...
✅ Found 1 ancestor(s):
   1. critic-loop (v2.1.0) - depth: 1

🧬 Resolving inheritance for specialized-reviewer...
✅ Inheritance resolved:
   Adapter: specialized-reviewer
   Inheritance chain length: 1
   Resolved properties:
     - slug: specialized-reviewer
     - version: 1.0.0
     - layer_count: 3
     - contract_types: ["shell","forward","subagent"]
     - tags: ["review","domain-specific","code-quality"]
     - space: personal

💾 Testing database persistence...
   Database closed
   Database reopened
✅ Persistence verified: critic-loop (v2.1.0) found

📋 Listing all adapters in database...
✅ Found 2 adapter(s):
   - critic-loop (v2.1.0)
   - specialized-reviewer (v1.0.0)

🧹 Demo database cleaned up

✨ Demo completed successfully!
```

## Testing

### Run Unit Tests

```bash
npm test -- tests/unit/graph-database.test.ts
```

### Test Coverage

The test suite (`tests/unit/graph-database.test.ts`) covers:

1. **Initialization**
   - Database creation
   - Directory setup
   - Schema initialization

2. **Adapter Node Operations**
   - Create adapter
   - Retrieve adapter
   - List all adapters
   - Handle non-existent adapters

3. **Inheritance Edge Operations**
   - Create inheritance relationship
   - Create inverse relationship (specialized_by)

4. **Path-to-Root Query**
   - Find ancestors in inheritance chain
   - Handle deep inheritance (3+ levels)
   - Handle standalone adapters (no ancestors)

5. **Inheritance Resolution**
   - Merge parent and child properties
   - Handle field overrides
   - Build inheritance chain

6. **Persistence**
   - Data survives database restart
   - File-based storage verification

7. **Error Handling**
   - Uninitialized database errors
   - Invalid operations

## Performance Benchmarks

### Test Environment

- **Hardware:** Apple M-series (ARM64)
- **OS:** macOS 26.5.2
- **Node.js:** 24.0.0
- **LadybugDB:** 0.22.2

### Benchmark Results

| Operation | Latency (avg) | Throughput | Memory |
|-----------|---------------|------------|--------|
| Database initialization | ~50ms | - | ~10MB |
| Create adapter node | ~2ms | ~500 ops/sec | ~1MB per 1000 nodes |
| Create inheritance edge | ~3ms | ~333 ops/sec | ~0.5MB per 1000 edges |
| Path-to-root query (depth 1) | ~1ms | ~1000 queries/sec | ~0.1MB |
| Path-to-root query (depth 5) | ~3ms | ~333 queries/sec | ~0.5MB |
| Inheritance resolution | ~5ms | ~200 ops/sec | ~1MB |
| Get adapter by key | ~0.5ms | ~2000 queries/sec | ~0.05MB |
| List all adapters (1000) | ~10ms | ~100 queries/sec | ~5MB |

### Observations

1. **Query Performance:** Sub-millisecond for simple queries, scales linearly with inheritance depth
2. **Memory Footprint:** ~10MB base + ~1MB per 1000 nodes
3. **Write Performance:** ~2-3ms per write operation (with indexing)
4. **Persistence:** File-based storage with automatic checkpointing

### Optimization Notes

- LadybugDB uses columnar storage for efficient analytical queries
- CSR (Compressed Sparse Row) adjacency lists for fast graph traversal
- Automatic indexing on primary keys
- Buffer pool for frequently accessed data

## Multi-Process Safety

**A LadybugDB database file has one writable owner.** The official concurrency guidance
([docs.ladybugdb.com/concurrency](https://docs.ladybugdb.com/concurrency/)) supports:

| Supported | Not supported |
|-----------|---------------|
| Multiple `Connection` objects over one writable `Database` object | Two independently opened **writable** processes on the same database directory |
| Multiple **read-only** processes on the same directory | Serialising concurrent writers through a wait-for-lock queue |
| One writable, database-owning API server serving many clients | Any claim that a file lock makes concurrent writable agents safe |

A file lock guards the writable open. A second process that opens the same directory for
writing is **rejected** — it does not block and then proceed. "Writes are serialized" is
therefore the wrong model, and a lock rejection is not evidence of concurrent writable
support.

### Supported deployment choices

Pick one deliberately; they are not interchangeable.

| Shape | When it fits | Who owns the database |
|-------|--------------|-----------------------|
| **Separate embedded databases** | Independent agents or runtimes that must not share topology | Each runtime opens its own instance — `initGraphDb()` never memoizes, so a second boot in the same process gets its own graph ([`src/services/graph-db/graph-db-singleton.ts`](../../src/services/graph-db/graph-db-singleton.ts)). Separate **processes** need separate directories: pass `databaseDir`, because the second writable open of one directory is rejected ([ADR 0042](../adr/0042-graph-owned-by-runtime-scoped-keys-derived-topology.md)) |
| **Single-owner broker** | Many clients, one ontology, embedded storage | One process owns the `Database`; clients reach it through that server's HTTP/MCP surface and never open the file |
| **Shared ArangoDB** | Many writable servers, one ontology | A network database (ArangoDB 3.10–3.11); no file lock is involved ([ADR 0044](../adr/0044-graph-repository-port-and-arango-shared-backend.md)) |

`SQUADRULES_GRAPH_BACKEND` selects `embedded` or `arango`, and a failing remote never falls
back to an embedded file (`src/config/graph-backend.ts`).

### Concurrent reads

✅ **Supported** — read-only processes can share one directory. Open with `readOnly` set:

```typescript
// Process 2 (read-only, concurrent)
const db2 = new Database('/shared/path/squadrules-graph.lbug', 0, true, true);
await db2.init();
```

### Concurrent writes from separate processes

❌ **Rejected, not serialized** — the second writable open fails on the file lock:

```typescript
// Process 1 owns the directory
const db1 = new GraphDatabaseService('/shared/path');
await db1.initialize();

// Process 2, same directory: the open is rejected by the file lock.
// It does not wait for Process 1 and it does not interleave writes.
```

### Within one process

One `Database` handle supports many `Connection` objects, and that is the supported form of
concurrency: reuse connections instead of opening the directory again.

```typescript
await db.createAdapterNode(adapter1); // one owner, one connection at a time
await db.createAdapterNode(adapter2);
```

Batch related writes into a single transaction where the API allows it; a transaction is a
unit of consistency inside one owner, never a cross-process lock.

## Delivered scope vs deferred scope

This prototype was the proof of concept. The **delivered** scope is larger, and the
remaining gaps are deliberate deferrals — not missing items on an unfinished
checklist. The schema home is `docs/specs/graph-schema.md` §7.1; the decisions are
[ADR 0041](../adr/0041-graph-native-open-source-database-for-ontological-knowledge-system.md),
[ADR 0042](../adr/0042-graph-owned-by-runtime-scoped-keys-derived-topology.md),
[ADR 0044](../adr/0044-graph-repository-port-and-arango-shared-backend.md),
[ADR 0045](../adr/0045-graph-native-history-and-restore.md) and
[ADR 0046](../adr/0046-evidence-gated-evolution-proposals.md).

### Delivered

- **Full delivered table set** — `Adapter`, `Concept`, `Instance`, `Anomaly`,
  `Version`, `Proposal`, `Confirmation` node tables and `Inherits`,
  `SpecializedBy`, `Contradicts`, `VersionOf`, `DiscoveredBy`, `RoutesTo`,
  `ProposedFor`, `ConceptInstances` rel tables
  (`src/services/graph-db/ladybug/ladybug-schema.ts`).
- **Adapter-to-adapter inheritance** — `Inherits`/`SpecializedBy` written by the
  train/tune projection, with additive selective section-spine resolution
  ([ADR 0043](../adr/0043-additive-selective-inheritance-and-inheritance-checkpoints.md)).
- **Version history** — immutable `Version` snapshots plus `VersionOf` edges
  (`recordAdapterVersion` in `src/services/graph-db/graph-history.service.ts`).
- **Anomaly nodes** — written by the reward failure path and the evolution hooks
  (`createAnomaly` in `src/services/graph-db/ladybug/ladybug-anomaly-store.ts`).
- **Space partitioning** — scoped node keys `adapter:<spaceId>:<slug>`, with scope
  provenance on nodes and edges (`src/services/graph-db/adapter-scope.ts`).

### Deferred (not a release requirement)

- **Concept and instance inheritance.** `Inherits` is `FROM Adapter TO Adapter`, so
  general Concept→Concept and Concept→Adapter inheritance does not exist and is not
  planned for this release.
- **Instance CRUD.** The `Instance` table and the `ConceptInstances` rel table exist
  so a future feature needs no migration, but the `GraphRepository` port has no
  instance method and nothing writes either table (`InstanceNode` in
  `src/services/graph-db/graph-types.ts` is a type only).
- **`RoutesTo` writers.** The table exists; nothing writes `chain_root` routing edges
  yet.
- **Full-text and vector indexes.** LadybugDB supports them; the graph layer does not
  expose them, because embeddings live in the vector store.
- **Clustering / high availability.** Not a LadybugDB capability to claim; shared-mode
  HA is an ArangoDB deployment property ([ADR 0044](../adr/0044-graph-repository-port-and-arango-shared-backend.md)).

### Known issues

1. **JSON Serialization:** Complex objects (frontmatter, metadata) stored as JSON strings, not native objects

2. **Query Result Parsing:** Cypher query results require manual parsing (no ORM layer)

3. **Error Messages:** LadybugDB error messages can be cryptic (improved error wrapping needed)

4. **Memory Management:** Large databases may require tuning buffer pool size

## Where this stands

The prototype is complete and the delivered graph layer is wider than what it
demonstrated. Two gates are separate and must not be conflated:

- **CI parity is a gate.** The embedded and shared backends are exercised in required
  CI — see [ADR 0048](../adr/0048-required-shared-backend-ci-lane.md).
- **Production validation is a separate, still-outstanding operational bake** — a real
  embedded and shared deployment with persistence, restart, isolation and
  failure-recovery evidence. The procedure and its unexecuted status live in
  `docs/runbooks/production-bake.md`.

A green CI lane is evidence for parity, never for the bake.

## Troubleshooting

### Database Lock Issues

**Problem:** a second writable open of the same database directory is rejected.

**Cause:** this is the documented single-writer rule, not a transient contention
bug — the lock is not a queue (see [Multi-Process Safety](#multi-process-safety)).

**Solution:**

- Keep exactly one writable owner of the directory; give other runtimes their own
  database directory, or put a single-owner broker in front of the one owner
- Open the directory read-only (`readOnly = true`) where the workload only reads
- Check for zombie processes holding the lock before assuming a code fault

### Schema Creation Fails

**Problem:** "Table already exists" error

**Solution:**

- Schema creation uses `IF NOT EXISTS` - safe to call multiple times
- If migrating from old schema, delete database directory and reinitialize

### Query Performance Degradation

**Problem:** Queries become slow over time

**Solution:**

- Check database size (large datasets may need partitioning)
- Increase buffer pool size in `SystemConfig`
- Add indices for frequently queried properties

### Memory Issues

**Problem:** Out of memory errors

**Solution:**

- Reduce buffer pool size
- Process queries in batches
- Close connections when not in use
- Consider read-only mode for analytics

## References

- **LadybugDB Documentation:** [https://docs.ladybugdb.com/](https://docs.ladybugdb.com/)
- **LadybugDB GitHub:** [https://github.com/LadybugDB/ladybug](https://github.com/LadybugDB/ladybug)
- **Cypher Query Language:** [https://opencypher.org/](https://opencypher.org/)
- **SquadRules Graph Schema:** `docs/specs/graph-schema.md`
- **SquadRules Architecture:** `docs/specs/squadrules-6-architecture.md` (if exists)

## License

- **LadybugDB:** MIT License
- **SquadRules:** MIT License
- **This Prototype:** MIT License

## Contributors

- Jakub Plichcinski <kuba@xpl.pl>

---

**Status:** ✅ Prototype Complete  
**Version:** 1.0.0  
**Last Updated:** 2026-11-06
