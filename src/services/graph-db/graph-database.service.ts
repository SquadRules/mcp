/**
 * LadybugDB graph repository (embedded, MIT).
 *
 * The class is a thin facade: schema creation and every read/write live in
 * `./ladybug/*` so each module stays small and reviewable. It satisfies the
 * backend-neutral `GraphRepository` port, which is the type `getGraphDb()` hands
 * to the runtime (docs/adr/0044-graph-repository-port-and-arango-shared-backend.md).
 *
 * @see docs/specs/graph-schema.md
 */
import { Database, Connection } from '@ladybugdb/core';
import * as path from 'path';
import * as fs from 'fs';
import type { InheritanceFrontmatter } from './adapter-inheritance.js';
import type { GraphRepository } from './graph-repository.js';
import type {
  AdapterChildRef,
  AdapterNode,
  AdapterNodeWriteOptions,
  AnomalyFilter,
  AnomalyNode,
  ConceptNode,
  EvolutionProposalNode,
  HistoryFilter,
  PathToRootResult,
  ProposalConfirmation,
  ProposalFilter,
  ProposalStatus,
  ResolvedInheritance,
  VersionAppendInput,
  VersionNode
} from './graph-types.js';
import { MAX_DB_SIZE_BYTES, createSchema } from './ladybug/ladybug-schema.js';
import {
  findPathToRoot,
  getAdapter,
  getAllAdapters,
  getChildren,
  getConcept,
  resolveInheritance
} from './ladybug/ladybug-adapter-reads.js';
import {
  clearInheritanceEdges,
  createAdapterNode,
  createInheritanceEdge as createInheritanceEdgeRow,
  upsertAdapterFromFrontmatter,
  upsertAdapterNode,
  upsertConcept,
  writeInheritanceEdges
} from './ladybug/ladybug-adapter-writes.js';
import { createAnomaly, listAnomalies } from './ladybug/ladybug-anomaly-store.js';
import {
  appendVersion,
  getLatestVersion,
  getVersion,
  listVersions
} from './ladybug/ladybug-history-store.js';
import {
  createProposal,
  getProposal,
  listConfirmations,
  listProposals,
  recordConfirmation,
  updateProposalStatus
} from './ladybug/ladybug-proposal-store.js';

export type {
  AdapterChildRef,
  AdapterNode,
  AdapterNodeWriteOptions,
  AnomalyFilter,
  AnomalyNode,
  ConceptNode,
  EvolutionProposalNode,
  HistoryFilter,
  PathToRootResult,
  ProposalConfirmation,
  ProposalFilter,
  ProposalStatus,
  ResolvedInheritance,
  VersionAppendInput,
  VersionNode
} from './graph-types.js';

/**
 * Embedded graph repository backed by LadybugDB.
 *
 * A single instance owns one `Database` handle; `initialize` is idempotent and
 * `close` releases the handle so a reopen reads the same file.
 */
export class GraphDatabaseService implements GraphRepository {
  private db: Database | null = null;
  private connection: Connection | null = null;
  private readonly dbPath: string;
  private initialized = false;

  constructor(databasePath?: string) {
    this.dbPath = databasePath || path.join(process.cwd(), '.squadrules-graph-db');
  }

  /** Open the embedded database and ensure every table exists. */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (!fs.existsSync(this.dbPath)) {
      fs.mkdirSync(this.dbPath, { recursive: true });
    }

    const dbFilePath = path.join(this.dbPath, 'squadrules-graph.lbug');
    this.db = new Database(dbFilePath, 0, true, false, MAX_DB_SIZE_BYTES);
    await this.db.init();

    this.connection = new Connection(this.db);
    await this.connection.init();
    await createSchema(this.connection);

    this.initialized = true;
  }

  private requireConnection(): Connection {
    if (!this.connection) {
      throw new Error('Database not initialized');
    }
    return this.connection;
  }

  // --- Adapter topology -----------------------------------------------------

  async getAdapter(adapterKey: string): Promise<AdapterNode | null> {
    return getAdapter(this.requireConnection(), adapterKey);
  }

  /** Every adapter node (diagnostics and boot reconciliation). */
  async getAllAdapters(): Promise<AdapterNode[]> {
    return getAllAdapters(this.requireConnection());
  }

  async findPathToRoot(
    adapterKey: string,
    order: 'nearest-first' | 'root-first' = 'nearest-first'
  ): Promise<PathToRootResult[]> {
    return findPathToRoot(this.requireConnection(), adapterKey, order);
  }

  async resolveInheritance(adapterKey: string): Promise<ResolvedInheritance | null> {
    return resolveInheritance(this.requireConnection(), adapterKey);
  }

  async getChildren(spaceId: string, slug: string): Promise<AdapterChildRef[]> {
    return getChildren(this.requireConnection(), spaceId, slug);
  }

  async createAdapterNode(adapter: AdapterNode): Promise<void> {
    return createAdapterNode(this.requireConnection(), adapter);
  }

  async upsertAdapterNode(adapter: AdapterNode): Promise<void> {
    return upsertAdapterNode(this.requireConnection(), adapter);
  }

  async createInheritanceEdge(edge: {
    from: string;
    to: string;
    created_at: string;
    override_fields?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    return createInheritanceEdgeRow(this.requireConnection(), edge);
  }

  async upsertAdapterFromFrontmatter(
    slug: string,
    version: string,
    frontmatter: InheritanceFrontmatter,
    opts: AdapterNodeWriteOptions
  ): Promise<string> {
    return upsertAdapterFromFrontmatter(
      this.requireConnection(),
      slug,
      version,
      frontmatter as Record<string, unknown>,
      opts
    );
  }

  /** Write the node and its inheritance edge in one call. */
  async writeAdapterFromFrontmatter(
    slug: string,
    version: string,
    frontmatter: InheritanceFrontmatter,
    opts: AdapterNodeWriteOptions
  ): Promise<void> {
    const adapterKey = await this.upsertAdapterFromFrontmatter(slug, version, frontmatter, opts);
    await this.writeInheritanceEdges(adapterKey, frontmatter, {
      parentSpaceId: opts.parentSpaceId ?? opts.spaceId
    });
  }

  async writeInheritanceEdges(
    childKey: string,
    frontmatter: InheritanceFrontmatter,
    opts: { parentSpaceId: string; now?: string }
  ): Promise<string | null> {
    return writeInheritanceEdges(
      this.requireConnection(),
      childKey,
      frontmatter as Record<string, unknown>,
      opts
    );
  }

  async clearInheritanceEdges(childKey: string): Promise<void> {
    return clearInheritanceEdges(this.requireConnection(), childKey);
  }

  // --- Ontology records -----------------------------------------------------

  async createAnomaly(anomaly: AnomalyNode): Promise<void> {
    return createAnomaly(this.requireConnection(), anomaly);
  }

  async listAnomalies(filter?: AnomalyFilter): Promise<AnomalyNode[]> {
    return listAnomalies(this.requireConnection(), filter);
  }

  async upsertConcept(concept: ConceptNode): Promise<void> {
    return upsertConcept(this.requireConnection(), concept);
  }

  async getConcept(conceptKey: string): Promise<ConceptNode | null> {
    return getConcept(this.requireConnection(), conceptKey);
  }

  // --- Graph-native history -------------------------------------------------

  async appendVersion(input: VersionAppendInput): Promise<VersionNode> {
    return appendVersion(this.requireConnection(), input);
  }

  async getVersion(entityKey: string, versionNumber: string): Promise<VersionNode | null> {
    return getVersion(this.requireConnection(), entityKey, versionNumber);
  }

  async getLatestVersion(entityKey: string): Promise<VersionNode | null> {
    return getLatestVersion(this.requireConnection(), entityKey);
  }

  async listVersions(entityKey: string, filter?: HistoryFilter): Promise<VersionNode[]> {
    return listVersions(this.requireConnection(), entityKey, filter);
  }

  // --- Evidence-gated evolution --------------------------------------------

  async createProposal(proposal: EvolutionProposalNode): Promise<void> {
    return createProposal(this.requireConnection(), proposal);
  }

  async getProposal(proposalKey: string): Promise<EvolutionProposalNode | null> {
    return getProposal(this.requireConnection(), proposalKey);
  }

  async listProposals(filter?: ProposalFilter): Promise<EvolutionProposalNode[]> {
    return listProposals(this.requireConnection(), filter);
  }

  async updateProposalStatus(
    proposalKey: string,
    status: ProposalStatus,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    return updateProposalStatus(this.requireConnection(), proposalKey, status, metadata);
  }

  async recordConfirmation(confirmation: ProposalConfirmation): Promise<void> {
    return recordConfirmation(this.requireConnection(), confirmation);
  }

  async listConfirmations(proposalKey: string): Promise<ProposalConfirmation[]> {
    return listConfirmations(this.requireConnection(), proposalKey);
  }

  // --- Lifecycle ------------------------------------------------------------

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

  isInitialized(): boolean {
    return this.initialized;
  }

  getDatabasePath(): string {
    return this.dbPath;
  }
}
