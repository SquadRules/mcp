# Graph Database Service

LadybugDB-based embedded graph database for SquadRules 6 ontological knowledge system.

## Overview

This service provides graph database functionality for managing adapter inheritance, concept relationships, and ontological evolution in SquadRules 6.

**Key Features:**
- Embedded mode (zero external dependencies)
- File-based persistence
- Cypher query language support
- Adapter inheritance resolution
- Path-to-root queries
- Scope-qualified adapter keys — one slug can exist in several spaces

**Ownership.** The graph belongs to the runtime that booted it, not to the process. Open
one with `openGraphDb({ databaseDir })`, then attach it to the objects tools are handed
(`attachGraphDb(graphDb, memoryStore, qdrantService)`); tools resolve it with
`getGraphDb(owner)`. Two instances in one process are independent. `initGraphDb()` and
`closeGraphDb()` are the boot/shutdown pair, and `closeGraphDb()` never closes a graph a
caller opened directly. Rationale and trade-offs:
[ADR 0042](../../../docs/adr/0042-graph-owned-by-runtime-scoped-keys-derived-topology.md).

**Scope.** An adapter node key is `adapter:<spaceId>:<slug>` (`adapter-scope.ts`), and
`createAdapterNode` / `upsertAdapterNode` reject an adapter with no `space` rather than
guessing one. The graph is a derived projection of stored adapter records: it can be
rebuilt from the store, except for `Anomaly` nodes, which exist only in the graph.

## Quick Start

```typescript
import { openGraphDb, adapterGraphKey } from './src/services/graph-db/index.js';

// Open an instance at an explicit directory. `openGraphDb` never throws:
// it returns null when the graph is disabled or the open fails.
const db = await openGraphDb({ databaseDir: '.squadrules-graph-db' });
if (!db) throw new Error('graph unavailable');

const space = 'space:my-team';
const childKey = adapterGraphKey(space, 'child');
const parentKey = adapterGraphKey(space, 'parent');

// Create an adapter. `space` is required.
await db.createAdapterNode({
  key: parentKey,
  type: 'adapter',
  slug: 'parent',
  version: '1.0.0',
  title: 'Parent Adapter',
  space,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
});

// Create inheritance (both endpoint keys carry the same scope)
await db.createInheritanceEdge({
  from: childKey,
  to: parentKey,
  relationship: 'inherits',
  created_at: new Date().toISOString()
});

// Query ancestors
const ancestors = await db.findPathToRoot(childKey);

// Resolve inheritance
const resolved = await db.resolveInheritance(childKey);

// Cleanup — the opener closes
await db.close();
```

## API Reference

### GraphDatabaseService

#### Constructor

```typescript
constructor(databasePath?: string)
```

Creates a new graph database service instance.

**Parameters:**
- `databasePath` (optional): Path to database directory. Defaults to `.squadrules-graph-db` in current working directory.

Prefer `openGraphDb({ databaseDir })` for runtime use: it reads the
`SQUADRULES_GRAPH_DB_*` switches, reports a failed open as `null` instead of throwing, and
matches the constructor no-argument default when no directory is given.

#### initialize()

```typescript
async initialize(): Promise<void>
```

Initializes the database, creates schema, and opens connection.

**Must be called before any other operations.**

#### createAdapterNode()

```typescript
async createAdapterNode(adapter: AdapterNode): Promise<void>
```

Creates an adapter node in the graph.

**Parameters:**
- `adapter`: Adapter node data (see types below)

#### createConceptNode()

```typescript
async createConceptNode(concept: ConceptNode): Promise<void>
```

Creates a concept node in the graph.

**Parameters:**
- `concept`: Concept node data (see types below)

#### createInheritanceEdge()

```typescript
async createInheritanceEdge(edge: InheritanceEdge): Promise<void>
```

Creates an inheritance relationship between adapters.

**Parameters:**
- `edge`: Inheritance edge data (see types below)

**Note:** Automatically creates both `inherits` and `specialized_by` edges.

#### findPathToRoot()

```typescript
async findPathToRoot(adapterKey: string): Promise<PathToRootResult[]>
```

Finds all ancestors of an adapter (inheritance chain).

**Parameters:**
- `adapterKey`: Adapter key (e.g., "adapter:my-adapter")

**Returns:** Array of ancestors with depth information

#### resolveInheritance()

```typescript
async resolveInheritance(adapterKey: string): Promise<ResolvedInheritance | null>
```

Materializes full adapter content by merging parent properties with child overrides.

**Parameters:**
- `adapterKey`: Adapter key

**Returns:** Resolved inheritance data or null if adapter not found

#### getAdapter()

```typescript
async getAdapter(adapterKey: string): Promise<AdapterNode | null>
```

Retrieves an adapter by key.

**Parameters:**
- `adapterKey`: Adapter key

**Returns:** Adapter node or null if not found

#### getAllAdapters()

```typescript
async getAllAdapters(): Promise<AdapterNode[]>
```

Retrieves all adapters in the database.

**Returns:** Array of all adapter nodes

#### close()

```typescript
async close(): Promise<void>
```

Closes database connection and releases resources.

#### isInitialized()

```typescript
isInitialized(): boolean
```

Checks if database is initialized.

**Returns:** true if initialized, false otherwise

#### getDatabasePath()

```typescript
getDatabasePath(): string
```

Gets the database directory path.

**Returns:** Absolute path to database directory

## Types

### AdapterNode

```typescript
interface AdapterNode {
  key: string;                    // Unique identifier (e.g., "adapter:my-adapter")
  type: 'adapter';                // Node type discriminator
  slug: string;                   // Adapter slug
  version: string;                // Semantic version
  title: string;                  // H1 title
  created_at: string;             // ISO 8601 timestamp
  updated_at: string;             // ISO 8601 timestamp
  frontmatter?: {                 // Parsed frontmatter fields
    slug: string;
    version: string;
    inherits?: string;            // Parent adapter slug
    chain_root?: string;          // Chain root adapter slug
    override?: string[];          // Overridden fields
    protocol_version?: string;    // Protocol version
  };
  layer_count?: number;           // Number of workflow layers
  contract_types?: string[];      // Contract types used
  space: string;                  // Space ownership — required; scopes the key
  tags?: string[];                // Activation tags
  metadata?: Record<string, any>; // Extensible metadata
}
```

### ConceptNode

```typescript
interface ConceptNode {
  key: string;                    // Unique identifier
  type: 'concept';                // Node type discriminator
  name: string;                   // Human-readable name
  definition: string;             // Formal definition
  created_at: string;             // ISO 8601 timestamp
  updated_at: string;             // ISO 8601 timestamp
  baseline_attributes?: Record<string, any>; // Default attributes
  tags?: string[];                // Categorization tags
  metadata?: Record<string, any>; // Extensible metadata
}
```

### InheritanceEdge

```typescript
interface InheritanceEdge {
  from: string;                   // Child adapter key
  to: string;                     // Parent adapter key
  relationship: 'inherits';       // Edge type discriminator
  inherited_fields?: string[];    // Fields inherited from parent
  override_fields?: string[];     // Fields overridden by child
  created_at: string;             // ISO 8601 timestamp
  metadata?: Record<string, any>; // Extensible metadata
}
```

### PathToRootResult

```typescript
interface PathToRootResult {
  ancestor: AdapterNode | ConceptNode; // Ancestor node
  edge: InheritanceEdge;               // Edge to ancestor
  depth: number;                       // Distance from start
}
```

### ResolvedInheritance

```typescript
interface ResolvedInheritance {
  adapter: AdapterNode;                          // Original adapter
  resolved_properties: Record<string, any>;      // Merged properties
  inheritance_chain: (AdapterNode | ConceptNode)[]; // Full chain
}
```

## Schema

### Node Tables

**Adapter**
- Primary key: `key`
- Properties: type, slug, version, title, created_at, updated_at, frontmatter, layer_count, contract_types, space, tags, metadata

**Concept**
- Primary key: `key`
- Properties: type, name, definition, created_at, updated_at, baseline_attributes, tags, metadata

### Relationship Tables

**Inherits**
- FROM: Adapter
- TO: Adapter
- Properties: relationship, inherited_fields, override_fields, created_at, metadata

**SpecializedBy**
- FROM: Adapter
- TO: Adapter
- Properties: relationship, specialization_type, created_at, metadata

## Examples

### Example 1: Create Parent-Child Inheritance

```typescript
// Create parent adapter
await db.createAdapterNode({
  key: 'adapter:critic-loop',
  type: 'adapter',
  slug: 'critic-loop',
  version: '2.1.0',
  title: 'Critic Loop',
  created_at: '2026-01-10T08:00:00Z',
  updated_at: '2026-03-15T14:22:00Z',
  layer_count: 3,
  contract_types: ['shell', 'forward', 'subagent'],
  tags: ['review', 'quality-gate']
});

// Create child adapter
await db.createAdapterNode({
  key: 'adapter:specialized-reviewer',
  type: 'adapter',
  slug: 'specialized-reviewer',
  version: '1.0.0',
  title: 'Specialized Reviewer',
  created_at: '2026-04-10T09:00:00Z',
  updated_at: '2026-04-10T09:00:00Z',
  frontmatter: {
    slug: 'specialized-reviewer',
    version: '1.0.0',
    inherits: 'critic-loop'
  },
  tags: ['review', 'domain-specific']
});

// Create inheritance edge
await db.createInheritanceEdge({
  from: 'adapter:specialized-reviewer',
  to: 'adapter:critic-loop',
  relationship: 'inherits',
  inherited_fields: ['contract_types', 'layer_count'],
  override_fields: ['tags'],
  created_at: '2026-04-10T09:15:00Z'
});
```

### Example 2: Query Inheritance Chain

```typescript
const ancestors = await db.findPathToRoot('adapter:specialized-reviewer');

console.log(`Found ${ancestors.length} ancestors:`);
ancestors.forEach((result, index) => {
  console.log(`${index + 1}. ${result.ancestor.slug} (depth: ${result.depth})`);
});
```

### Example 3: Resolve Inheritance

```typescript
const resolved = await db.resolveInheritance('adapter:specialized-reviewer');

if (resolved) {
  console.log('Resolved properties:');
  console.log('  slug:', resolved.resolved_properties.slug);
  console.log('  version:', resolved.resolved_properties.version);
  console.log('  layer_count:', resolved.resolved_properties.layer_count);
  console.log('  contract_types:', resolved.resolved_properties.contract_types);
  console.log('  tags:', resolved.resolved_properties.tags);
}
```

## Testing

Run unit tests:

```bash
npm test -- tests/unit/graph-database.test.ts
```

Run demo:

```bash
node scripts/ladybugdb-demo.mjs
```

## Performance

| Operation | Latency | Throughput |
|-----------|---------|------------|
| Create adapter | ~2ms | ~500 ops/sec |
| Create edge | ~3ms | ~333 ops/sec |
| Path query (depth 1) | ~1ms | ~1000 queries/sec |
| Path query (depth 5) | ~3ms | ~333 queries/sec |
| Resolve inheritance | ~5ms | ~200 ops/sec |
| Get adapter | ~0.5ms | ~2000 queries/sec |

## Limitations

- Schema subset (Adapter, Concept, Anomaly, Inherits, SpecializedBy only)
- JSON serialization for complex objects
- No full-text search (yet)
- No vector indices (yet)
- One database file per runtime; scope is part of the key, not a partition
- `Anomaly` nodes have no rebuild path — they exist only in the graph

## Next Steps

See `docs/specs/ladybugdb-prototype.md` for complete roadmap.

## References

- [LadybugDB Documentation](https://docs.ladybugdb.com/)
- [Graph Schema Specification](../../../docs/specs/graph-schema.md)
- [Prototype Documentation](../../../docs/specs/ladybugdb-prototype.md)

## License

MIT
