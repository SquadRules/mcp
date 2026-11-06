/**
 * LadybugDB Graph Database Service for SquadRules 6
 * 
 * Embedded graph database for ontological knowledge system.
 * Implements adapter inheritance, concept relationships, and anomaly tracking.
 * 
 * @see docs/specs/graph-schema.md
 */

import { Database, Connection } from '@ladybugdb/core';
import * as path from 'path';
import * as fs from 'fs';

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

    // Create database instance (embedded mode)
    this.db = new Database(this.dbPath);
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
        frontmatter: JSON.parse(row.frontmatter || '{}')
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
        
        // Merge parent properties (child wins for overridden fields)
        for (const [key, value] of Object.entries(parentProps)) {
          if (!(key in resolvedProperties) || resolvedProperties[key] === undefined) {
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
