/**
 * LadybugDB Graph Database Service for SquadRules 6
 * 
 * Embedded graph database for ontological knowledge system.
 * Implements adapter inheritance, concept relationships, and anomaly tracking.
 * 
 * @see docs/specs/graph-schema.md
 */

import { Database, Connection } from '@ladybugdb/core';
import type { InheritanceFrontmatter } from './adapter-inheritance.js';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Maximum database size in bytes (256 MB). LadybugDB 0.22.2 defaults to an 8 TB
 * mmap address-space reservation when maxDBSize is 0, which fails on macOS and
 * other systems that cannot overcommit that much virtual memory — especially when
 * multiple Database instances are created and closed in rapid succession (tests).
 * 256 MB is generous for the adapter/concept graph and avoids the mmap failure.
 */
const MAX_DB_SIZE_BYTES = 256 * 1024 * 1024;

export interface AdapterNode {
  key: string;
  type: 'adapter';
  slug: string;
  version: string;
  title: string;
  created_at: string;
  updated_at: string;
  frontmatter?: {
    slug: string;
    version: string;
    inherits?: string;
    chain_root?: string;
    override?: string[];
    protocol_version?: string;
  };
  layer_count?: number;
  contract_types?: string[];
  space?: string;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface ConceptNode {
  key: string;
  type: 'concept';
  name: string;
  definition: string;
  created_at: string;
  updated_at: string;
  baseline_attributes?: Record<string, any>;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface AnomalyNode {
  key: string;
  /** Node type discriminator. Kept as the literal 'Anomaly' per Touchpoint 4. */
  type: 'Anomaly';
  /** Adapter (or agent) slug that discovered the anomaly — the adapter that failed. */
  discovered_by: string;
  /**
   * Where the anomaly routes for triage: the parent adapter slug when inheritance
   * is involved, otherwise the failing adapter slug itself.
   */
  routes_to: string;
  /** Human-readable failure summary. */
  description: string;
  /** ISO 8601 timestamp. */
  created_at: string;
  /** Severity derived from the proof failure class when available. */
  severity?: string;
  /** Classification per graph-schema.md (failure/contradiction/ambiguity/regression). */
  anomaly_type?: string;
  /** Resolution state per graph-schema.md (open/investigating/resolved/wontfix). */
  status?: string;
  metadata?: Record<string, any>;
}

export interface InheritanceEdge {
  from: string;
  to: string;
  relationship: 'inherits';
  inherited_fields?: string[];
  override_fields?: string[];
  created_at: string;
  metadata?: Record<string, any>;
}

export interface PathToRootResult {
  ancestor: AdapterNode | ConceptNode;
  edge: InheritanceEdge;
  depth: number;
}

export interface ResolvedInheritance {
  adapter: AdapterNode;
  resolved_properties: Record<string, any>;
  inheritance_chain: (AdapterNode | ConceptNode)[];
}

/**
 * Returns true when a resolved-property value should be overwritten by a parent's
 * value during inheritance merge.  Treats undefined, null, 0, and empty arrays as
 * "not explicitly set" — these are the sentinel defaults `createAdapterNode` stores
 * when the caller omits the field.
 */
function isInheritable(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (value === 0) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

/**
 * Graph Database Service using LadybugDB (embedded mode)
 */
export class GraphDatabaseService {
  private db: Database | null = null;
  private connection: Connection | null = null;
  private dbPath: string;
  private initialized = false;

  constructor(databasePath?: string) {
    this.dbPath = databasePath || path.join(process.cwd(), '.squadrules-graph-db');
  }

  /**
   * Initialize the graph database
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Ensure database directory exists
    if (!fs.existsSync(this.dbPath)) {
      fs.mkdirSync(this.dbPath, { recursive: true });
    }

    // Create database instance (embedded mode) - use file path, not directory
    const dbFilePath = path.join(this.dbPath, 'squadrules-graph.lbug');
    this.db = new Database(dbFilePath, 0, true, false, MAX_DB_SIZE_BYTES);
    await this.db.init();

    // Create connection
    this.connection = new Connection(this.db);
    await this.connection.init();

    // Create schema
    await this.createSchema();

    this.initialized = true;
  }

  /**
   * Create graph schema (node and edge tables)
   */
  private async createSchema(): Promise<void> {
    if (!this.connection) {
      throw new Error('Database not initialized');
    }

    // Create adapter node table
    await this.connection.query(`
      CREATE NODE TABLE IF NOT EXISTS Adapter(
        key STRING PRIMARY KEY,
        type STRING,
        slug STRING,
        version STRING,
        title STRING,
        created_at STRING,
        updated_at STRING,
        frontmatter STRING,
        layer_count INT64,
        contract_types STRING,
        space STRING,
        tags STRING,
        metadata STRING
      )
    `);

    // Create concept node table
    await this.connection.query(`
      CREATE NODE TABLE IF NOT EXISTS Concept(
        key STRING PRIMARY KEY,
        type STRING,
        name STRING,
        definition STRING,
        created_at STRING,
        updated_at STRING,
        baseline_attributes STRING,
        tags STRING,
        metadata STRING
      )
    `);

    // Create inheritance edge table
    await this.connection.query(`
      CREATE REL TABLE IF NOT EXISTS Inherits(
        FROM Adapter TO Adapter,
        relationship STRING,
        inherited_fields STRING,
        override_fields STRING,
        created_at STRING,
        metadata STRING
      )
    `);

    // Create specialized_by edge table (inverse of inherits)
    await this.connection.query(`
      CREATE REL TABLE IF NOT EXISTS SpecializedBy(
        FROM Adapter TO Adapter,
        relationship STRING,
        specialization_type STRING,
        created_at STRING,
        metadata STRING
      )
    `);

    // Create anomaly node table (Touchpoint 4: reward failure bookkeeping).
    // Proposal-only: anomalies never rewrite an Adapter node — see createAnomaly.
    await this.connection.query(`
      CREATE NODE TABLE IF NOT EXISTS Anomaly(
        key STRING PRIMARY KEY,
        type STRING,
        discovered_by STRING,
        routes_to STRING,
        description STRING,
        created_at STRING,
        severity STRING,
        anomaly_type STRING,
        status STRING,
        metadata STRING
      )
    `);
  }

  /**
   * Create an adapter node
   */
  async createAdapterNode(adapter: AdapterNode): Promise<void> {
    if (!this.connection) {
      throw new Error('Database not initialized');
    }

    const query = `
      CREATE (a:Adapter {
        key: $key,
        type: $type,
        slug: $slug,
        version: $version,
        title: $title,
        created_at: $created_at,
        updated_at: $updated_at,
        frontmatter: $frontmatter,
        layer_count: $layer_count,
        contract_types: $contract_types,
        space: $space,
        tags: $tags,
        metadata: $metadata
      })
    `;

    const preparedStatement = await this.connection.prepare(query);
    await this.connection.execute(preparedStatement, {
      key: adapter.key,
      type: adapter.type,
      slug: adapter.slug,
      version: adapter.version,
      title: adapter.title,
      created_at: adapter.created_at,
      updated_at: adapter.updated_at,
      frontmatter: JSON.stringify(adapter.frontmatter || null),
      layer_count: adapter.layer_count || 0,
      contract_types: JSON.stringify(adapter.contract_types || []),
      space: adapter.space || 'personal',
      tags: JSON.stringify(adapter.tags || []),
      metadata: JSON.stringify(adapter.metadata || {})
    });
  }

  /**
   * Create an anomaly node (Touchpoint 4: reward failure bookkeeping).
   *
   * PROPOSAL-ONLY INVARIANT: this method writes an `Anomaly` node and nothing
   * else. It MUST NOT rewrite, upsert, or otherwise mutate any `Adapter` node —
   * the anomaly is a proposal for later triage, not an applied parent update.
   * Ownership of the anomaly -> parent-update write is deferred until an ADR
   * assigns it (see docs/specs/ontological-knowledge-system.md, "Back-Propagation"
   * and the deferred anomaly-backpropagation ADR).
   */
  async createAnomaly(anomaly: AnomalyNode): Promise<void> {
    if (!this.connection) {
      throw new Error('Database not initialized');
    }

    const query = `
      CREATE (n:Anomaly {
        key: $key,
        type: $type,
        discovered_by: $discovered_by,
        routes_to: $routes_to,
        description: $description,
        created_at: $created_at,
        severity: $severity,
        anomaly_type: $anomaly_type,
        status: $status,
        metadata: $metadata
      })
    `;

    const preparedStatement = await this.connection.prepare(query);
    await this.connection.execute(preparedStatement, {
      key: anomaly.key,
      type: anomaly.type,
      discovered_by: anomaly.discovered_by,
      routes_to: anomaly.routes_to,
      description: anomaly.description,
      created_at: anomaly.created_at,
      severity: anomaly.severity || 'medium',
      anomaly_type: anomaly.anomaly_type || 'failure',
      status: anomaly.status || 'open',
      metadata: JSON.stringify(anomaly.metadata || {})
    });
  }

  /**
   * Create inheritance edge (child -> parent)
   */
  async createInheritanceEdge(edge: InheritanceEdge): Promise<void> {
    if (!this.connection) {
      throw new Error('Database not initialized');
    }

    const query = `
      MATCH (child:Adapter {key: $from}), (parent:Adapter {key: $to})
      CREATE (child)-[e:Inherits {
        relationship: $relationship,
        inherited_fields: $inherited_fields,
        override_fields: $override_fields,
        created_at: $created_at,
        metadata: $metadata
      }]->(parent)
    `;

    const preparedStatement = await this.connection.prepare(query);
    await this.connection.execute(preparedStatement, {
      from: edge.from,
      to: edge.to,
      relationship: edge.relationship,
      inherited_fields: JSON.stringify(edge.inherited_fields || []),
      override_fields: JSON.stringify(edge.override_fields || []),
      created_at: edge.created_at,
      metadata: JSON.stringify(edge.metadata || {})
    });

    // Also create inverse edge (specialized_by)
    const inverseQuery = `
      MATCH (parent:Adapter {key: $to}), (child:Adapter {key: $from})
      CREATE (parent)-[e:SpecializedBy {
        relationship: 'specialized_by',
        specialization_type: 'override',
        created_at: $created_at,
        metadata: $metadata
      }]->(child)
    `;

    const inversePreparedStatement = await this.connection.prepare(inverseQuery);
    await this.connection.execute(inversePreparedStatement, {
      from: edge.from,
      to: edge.to,
      created_at: edge.created_at,
      metadata: JSON.stringify(edge.metadata || {})
    });
  }

  /**
   * Path-to-root query: find all ancestors of an adapter
   */
  async findPathToRoot(adapterKey: string): Promise<PathToRootResult[]> {
    if (!this.connection) {
      throw new Error('Database not initialized');
    }

    const query = `
      MATCH path = (child:Adapter {key: $adapterKey})-[:Inherits*1..10]->(ancestor)
      RETURN 
        ancestor.key as key,
        ancestor.type as type,
        ancestor.slug as slug,
        ancestor.version as version,
        ancestor.title as title,
        ancestor.created_at as created_at,
        ancestor.updated_at as updated_at,
        ancestor.frontmatter as frontmatter,
        ancestor.layer_count as layer_count,
        ancestor.contract_types as contract_types,
        ancestor.space as space,
        ancestor.tags as tags,
        ancestor.metadata as metadata,
        length(path) as depth
    `;

    const preparedStatement = await this.connection.prepare(query);
    const result = await this.connection.execute(preparedStatement, { adapterKey });
    
    const queryResult = Array.isArray(result) ? result[0] : result;
    if (!queryResult) {
      return [];
    }
    const rows = await queryResult.getAll();

    return rows.map((row: any) => ({
      ancestor: {
        key: row.key,
        type: row.type,
        slug: row.slug,
        version: row.version,
        title: row.title,
        created_at: row.created_at,
        updated_at: row.updated_at,
        frontmatter: JSON.parse(row.frontmatter || '{}'),
        layer_count: row.layer_count,
        contract_types: JSON.parse(row.contract_types || '[]'),
        space: row.space,
        tags: JSON.parse(row.tags || '[]'),
        metadata: JSON.parse(row.metadata || '{}')
      } as AdapterNode,
      edge: {
        from: adapterKey,
        to: row.key,
        relationship: 'inherits' as const,
        created_at: new Date().toISOString()
      },
      depth: row.depth
    }));
  }

  /**
   * Resolve inheritance: materialize full adapter content (parent + delta)
   */
  async resolveInheritance(adapterKey: string): Promise<ResolvedInheritance | null> {
    if (!this.connection) {
      throw new Error('Database not initialized');
    }

    // Get the adapter
    const adapterQuery = `
      MATCH (a:Adapter {key: $adapterKey})
      RETURN a
    `;

    const adapterPreparedStatement = await this.connection.prepare(adapterQuery);
    const adapterResult = await this.connection.execute(adapterPreparedStatement, { adapterKey });
    
    const adapterQueryResult = Array.isArray(adapterResult) ? adapterResult[0] : adapterResult;
    if (!adapterQueryResult) {
      return null;
    }
    const adapterRows = await adapterQueryResult.getAll();

    if (adapterRows.length === 0) {
      return null;
    }

    const adapter = (adapterRows[0] && adapterRows[0]['a']) as any;
    const adapterNode: AdapterNode = {
      key: adapter.key,
      type: 'adapter',
      slug: adapter.slug,
      version: adapter.version,
      title: adapter.title,
      created_at: adapter.created_at,
      updated_at: adapter.updated_at,
      frontmatter: JSON.parse(adapter.frontmatter || '{}'),
      layer_count: adapter.layer_count,
      contract_types: JSON.parse(adapter.contract_types || '[]'),
      space: adapter.space,
      tags: JSON.parse(adapter.tags || '[]'),
      metadata: JSON.parse(adapter.metadata || '{}')
    };

    // Get inheritance chain
    const pathToRoot = await this.findPathToRoot(adapterKey);

    // Start with adapter properties
    const resolvedProperties: Record<string, any> = { ...adapterNode };

    // Apply parent properties (if inherits exists)
    if (pathToRoot.length > 0) {
      // Sort by depth (deepest first)
      pathToRoot.sort((a, b) => b.depth - a.depth);

      for (const { ancestor } of pathToRoot) {
        const parentProps = ancestor as any;
        
        // Merge parent properties (child wins for explicitly-set fields).
        // createAdapterNode stores zero-value defaults (0, [], null) for fields the
        // caller did not supply; those must be treated as "unset" so the parent value
        // flows through.  Non-empty / non-zero child values always win.
        for (const [key, value] of Object.entries(parentProps)) {
          if (isInheritable(resolvedProperties[key])) {
            resolvedProperties[key] = value;
          }
        }
      }
    }

    return {
      adapter: adapterNode,
      resolved_properties: resolvedProperties,
      inheritance_chain: pathToRoot.map(p => p.ancestor)
    };
  }

  /**
   * Get adapter by key
   */
  async getAdapter(adapterKey: string): Promise<AdapterNode | null> {
    if (!this.connection) {
      throw new Error('Database not initialized');
    }

    const query = `
      MATCH (a:Adapter {key: $adapterKey})
      RETURN a
    `;

    const preparedStatement = await this.connection.prepare(query);
    const result = await this.connection.execute(preparedStatement, { adapterKey });
    
    const queryResult = Array.isArray(result) ? result[0] : result;
    if (!queryResult) {
      return null;
    }
    const rows = await queryResult.getAll();

    if (rows.length === 0) {
      return null;
    }

    const adapter = rows[0]!['a'] as any;
    return {
      key: adapter.key,
      type: 'adapter',
      slug: adapter.slug,
      version: adapter.version,
      title: adapter.title,
      created_at: adapter.created_at,
      updated_at: adapter.updated_at,
      frontmatter: JSON.parse(adapter.frontmatter || '{}'),
      layer_count: adapter.layer_count,
      contract_types: JSON.parse(adapter.contract_types || '[]'),
      space: adapter.space,
      tags: JSON.parse(adapter.tags || '[]'),
      metadata: JSON.parse(adapter.metadata || '{}')
    };
  }

  /**
   * Get all adapters
   */
  async getAllAdapters(): Promise<AdapterNode[]> {
    if (!this.connection) {
      throw new Error('Database not initialized');
    }

    const query = `
      MATCH (a:Adapter)
      RETURN a
    `;

    const preparedStatement = await this.connection.prepare(query);
    const result = await this.connection.execute(preparedStatement);
    
    const queryResult = Array.isArray(result) ? result[0] : result;
    if (!queryResult) {
      return [];
    }
    const rows = await queryResult.getAll();

    return rows.map((row: any) => {
      const adapter = row['a'];
      return {
        key: adapter.key,
        type: 'adapter' as const,
        slug: adapter.slug,
        version: adapter.version,
        title: adapter.title,
        created_at: adapter.created_at,
        updated_at: adapter.updated_at,
        frontmatter: JSON.parse(adapter.frontmatter || '{}'),
        layer_count: adapter.layer_count,
        contract_types: JSON.parse(adapter.contract_types || '[]'),
        space: adapter.space,
        tags: JSON.parse(adapter.tags || '[]'),
        metadata: JSON.parse(adapter.metadata || '{}')
      };
    });
  }


  /**
   * Upsert an adapter node: create if absent, update if present.
   * Uses MERGE semantics so partial writes never leak.
   */
  async upsertAdapterNode(adapter: AdapterNode): Promise<void> {
    if (!this.connection) {
      throw new Error('Database not initialized');
    }

    // Try to match existing node first
    const matchQuery = `
      MATCH (a:Adapter {key: $key})
      RETURN a.key
    `;
    const matchStmt = await this.connection.prepare(matchQuery);
    const matchResult = await this.connection.execute(matchStmt, { key: adapter.key });
    const matchQueryResult = Array.isArray(matchResult) ? matchResult[0] : matchResult;
    const existingRows = matchQueryResult ? await matchQueryResult.getAll() : [];

    if (existingRows.length > 0) {
      // Update existing node
      const updateQuery = `
        MATCH (a:Adapter {key: $key})
        SET a.version = $version,
            a.title = $title,
            a.updated_at = $updated_at,
            a.frontmatter = $frontmatter,
            a.layer_count = $layer_count,
            a.contract_types = $contract_types,
            a.space = $space,
            a.tags = $tags,
            a.metadata = $metadata
      `;
      const updateStmt = await this.connection.prepare(updateQuery);
      await this.connection.execute(updateStmt, {
        key: adapter.key,
        version: adapter.version,
        title: adapter.title,
        updated_at: adapter.updated_at,
        frontmatter: JSON.stringify(adapter.frontmatter || null),
        layer_count: adapter.layer_count || 0,
        contract_types: JSON.stringify(adapter.contract_types || []),
        space: adapter.space || 'personal',
        tags: JSON.stringify(adapter.tags || []),
        metadata: JSON.stringify(adapter.metadata || {})
      });
    } else {
      // Create new node
      await this.createAdapterNode(adapter);
    }
  }

  /**
   * Write an adapter node and its inheritance edges from parsed frontmatter.
   *
   * Performs: upsert Adapter node → create/update Inherits edge (child→parent) →
   * create reciprocal SpecializedBy edge (parent→child).
   *
   * If the parent adapter node does not exist in the graph, the edges are skipped
   * (the caller receives a warning from validateInheritanceFrontmatter beforehand).
   *
   * @param slug - Adapter slug
   * @param version - Adapter version string
   * @param frontmatter - Parsed frontmatter fields including inherits/override
   * @param opts - Additional options (title, tags, etc.)
   */
  async writeAdapterFromFrontmatter(
    slug: string,
    version: string,
    frontmatter: InheritanceFrontmatter,
    opts?: {
      title?: string;
      layerCount?: number;
      contractTypes?: string[];
      space?: string;
      tags?: string[];
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    if (!this.connection) {
      throw new Error('Database not initialized');
    }

    const now = new Date().toISOString();
    const adapterKey = `adapter:${slug}`;

    // Build the adapter node
    const adapterNode: AdapterNode = {
      key: adapterKey,
      type: 'adapter',
      slug,
      version,
      title: opts?.title || slug,
      created_at: now,
      updated_at: now,
      frontmatter: {
        slug,
        version,
        ...(frontmatter.inherits && { inherits: frontmatter.inherits }),
        ...(frontmatter.chain_root && { chain_root: frontmatter.chain_root }),
        ...(frontmatter.override && frontmatter.override.length > 0 && { override: frontmatter.override }),
        ...(frontmatter.protocol_version && { protocol_version: frontmatter.protocol_version })
      },
      layer_count: opts?.layerCount || 0,
      contract_types: opts?.contractTypes || [],
      space: opts?.space || 'personal',
      tags: opts?.tags || [],
      metadata: opts?.metadata || {}
    };

    // Upsert the adapter node
    await this.upsertAdapterNode(adapterNode);

    // Create inheritance edges if inherits is set
    const parentSlug = frontmatter.inherits;
    if (parentSlug) {
      const parentKey = `adapter:${parentSlug}`;

      // Check if parent exists in graph
      const parentExists = await this.getAdapter(parentKey);
      if (parentExists) {
        // Remove existing inheritance edges for this child (idempotent re-train)
        await this.removeInheritanceEdges(adapterKey);

        // Create Inherits edge (child → parent)
        const edge: InheritanceEdge = {
          from: adapterKey,
          to: parentKey,
          relationship: 'inherits',
          override_fields: frontmatter.override || [],
          created_at: now
        };
        await this.createInheritanceEdge(edge);
      }
    }
  }

  /**
   * Remove all Inherits and SpecializedBy edges involving the given adapter key as child.
   * Used before re-creating edges on adapter update (idempotent re-train).
   */
  private async removeInheritanceEdges(childKey: string): Promise<void> {
    if (!this.connection) return;

    try {
      const deleteInheritsQuery = `
        MATCH (child:Adapter {key: $childKey})-[e:Inherits]->(parent:Adapter)
        DELETE e
      `;
      const deleteStmt = await this.connection.prepare(deleteInheritsQuery);
      await this.connection.execute(deleteStmt, { childKey });

      const deleteSpecializedByQuery = `
        MATCH (parent:Adapter)-[e:SpecializedBy]->(child:Adapter {key: $childKey})
        DELETE e
      `;
      const deleteSbStmt = await this.connection.prepare(deleteSpecializedByQuery);
      await this.connection.execute(deleteSbStmt, { childKey });
    } catch {
      // Edge deletion is best-effort; if the edges do not exist, this is a no-op.
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }

    if (this.db) {
      await this.db.close();
      this.db = null;
    }

    this.initialized = false;
  }

  /**
   * Check if database is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get database path
   */
  getDatabasePath(): string {
    return this.dbPath;
  }
}
