/**
 * ArangoDB implementation of the `GraphRepository` port (shared, Apache-2.0).
 *
 * The class owns no local file: it connects to the configured server, verifies the
 * supported series and stream-transaction capability, and then delegates to the
 * focused `arango-*` modules. A remote failure propagates — no embedded fallback is
 * attempted here (that decision belongs to the factory, and it does not fall back
 * either when `arango` was selected).
 *
 * @see docs/adr/0044-graph-repository-port-and-arango-shared-backend.md
 */
import {
  resolveArangoConnectionConfig,
  type ArangoConnectionConfig
} from '../../../config/graph-backend.js';
import type { GraphRepository } from '../graph-repository.js';
import type {
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
} from '../graph-types.js';
import type { ArangoHttpClient } from './arango-http.js';
import { connectArango, type ArangoCapabilities } from './arango-schema.js';
import {
  clearInheritanceEdges,
  createAdapterNode,
  createInheritanceEdge,
  findPathToRoot,
  getAdapter,
  getAllAdapters,
  getChildren,
  resolveInheritance,
  upsertAdapterFromFrontmatter,
  upsertAdapterNode,
  writeInheritanceEdges
} from './arango-adapter-store.js';
import { getConcept, upsertConcept } from './arango-concept-store.js';
import { createAnomaly, listAnomalies } from './arango-anomaly-store.js';
import {
  appendVersion,
  getLatestVersion,
  getVersion,
  listVersions
} from './arango-history-store.js';
import {
  createProposal,
  getProposal,
  listConfirmations,
  listProposals,
  recordConfirmation,
  updateProposalStatus
} from './arango-proposal-store.js';

export class ArangoGraphRepository implements GraphRepository {
  private client: ArangoHttpClient | null = null;
  private capabilities: ArangoCapabilities | null = null;
  private initialized = false;

  constructor(private readonly config?: ArangoConnectionConfig) {}

  /** Connect, verify the version/capabilities, and bootstrap the schema. */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    const connection = await connectArango(this.config ?? resolveArangoConnectionConfig());
    this.client = connection.client;
    this.capabilities = connection.capabilities;
    this.initialized = true;
  }

  /** Verified capabilities of the connected server (null before initialize). */
  getCapabilities(): ArangoCapabilities | null {
    return this.capabilities;
  }

  private requireClient(): ArangoHttpClient {
    if (!this.client) {
      throw new Error('ArangoGraphRepository is not initialized');
    }
    return this.client;
  }

  // --- Adapter topology -----------------------------------------------------

  async getAdapter(adapterKey: string): Promise<AdapterNode | null> {
    return getAdapter(this.requireClient(), adapterKey);
  }

  async getAllAdapters(): Promise<AdapterNode[]> {
    return getAllAdapters(this.requireClient());
  }

  async findPathToRoot(
    adapterKey: string,
    order: 'nearest-first' | 'root-first' = 'nearest-first'
  ): Promise<PathToRootResult[]> {
    return findPathToRoot(this.requireClient(), adapterKey, order);
  }

  async resolveInheritance(adapterKey: string): Promise<ResolvedInheritance | null> {
    return resolveInheritance(this.requireClient(), adapterKey);
  }

  async getChildren(spaceId: string, slug: string): Promise<string[]> {
    return getChildren(this.requireClient(), spaceId, slug);
  }

  async createAdapterNode(adapter: AdapterNode): Promise<void> {
    return createAdapterNode(this.requireClient(), adapter);
  }

  async upsertAdapterNode(adapter: AdapterNode): Promise<void> {
    return upsertAdapterNode(this.requireClient(), adapter);
  }

  async createInheritanceEdge(edge: {
    from: string;
    to: string;
    created_at: string;
    override_fields?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    return createInheritanceEdge(this.requireClient(), edge);
  }

  async upsertAdapterFromFrontmatter(
    slug: string,
    version: string,
    frontmatter: Record<string, unknown>,
    opts: AdapterNodeWriteOptions
  ): Promise<string> {
    return upsertAdapterFromFrontmatter(this.requireClient(), slug, version, frontmatter, opts);
  }

  /** Write the node and its inheritance edge in one call. */
  async writeAdapterFromFrontmatter(
    slug: string,
    version: string,
    frontmatter: Record<string, unknown>,
    opts: AdapterNodeWriteOptions
  ): Promise<void> {
    const adapterKey = await this.upsertAdapterFromFrontmatter(slug, version, frontmatter, opts);
    await this.writeInheritanceEdges(adapterKey, frontmatter, {
      parentSpaceId: opts.parentSpaceId ?? opts.spaceId
    });
  }

  async writeInheritanceEdges(
    childKey: string,
    frontmatter: Record<string, unknown>,
    opts: { parentSpaceId: string; now?: string }
  ): Promise<string | null> {
    return writeInheritanceEdges(this.requireClient(), childKey, frontmatter, opts);
  }

  async clearInheritanceEdges(childKey: string): Promise<void> {
    return clearInheritanceEdges(this.requireClient(), childKey);
  }

  // --- Ontology records -----------------------------------------------------

  async createAnomaly(anomaly: AnomalyNode): Promise<void> {
    return createAnomaly(this.requireClient(), anomaly);
  }

  async listAnomalies(filter?: AnomalyFilter): Promise<AnomalyNode[]> {
    return listAnomalies(this.requireClient(), filter);
  }

  async upsertConcept(concept: ConceptNode): Promise<void> {
    return upsertConcept(this.requireClient(), concept);
  }

  async getConcept(conceptKey: string): Promise<ConceptNode | null> {
    return getConcept(this.requireClient(), conceptKey);
  }

  // --- Graph-native history -------------------------------------------------

  async appendVersion(input: VersionAppendInput): Promise<VersionNode> {
    return appendVersion(this.requireClient(), input);
  }

  async getVersion(entityKey: string, versionNumber: string): Promise<VersionNode | null> {
    return getVersion(this.requireClient(), entityKey, versionNumber);
  }

  async getLatestVersion(entityKey: string): Promise<VersionNode | null> {
    return getLatestVersion(this.requireClient(), entityKey);
  }

  async listVersions(entityKey: string, filter?: HistoryFilter): Promise<VersionNode[]> {
    return listVersions(this.requireClient(), entityKey, filter);
  }

  // --- Evidence-gated evolution --------------------------------------------

  async createProposal(proposal: EvolutionProposalNode): Promise<void> {
    return createProposal(this.requireClient(), proposal);
  }

  async getProposal(proposalKey: string): Promise<EvolutionProposalNode | null> {
    return getProposal(this.requireClient(), proposalKey);
  }

  async listProposals(filter?: ProposalFilter): Promise<EvolutionProposalNode[]> {
    return listProposals(this.requireClient(), filter);
  }

  async updateProposalStatus(
    proposalKey: string,
    status: ProposalStatus,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    return updateProposalStatus(this.requireClient(), proposalKey, status, metadata);
  }

  async recordConfirmation(confirmation: ProposalConfirmation): Promise<void> {
    return recordConfirmation(this.requireClient(), confirmation);
  }

  async listConfirmations(proposalKey: string): Promise<ProposalConfirmation[]> {
    return listConfirmations(this.requireClient(), proposalKey);
  }

  // --- Lifecycle ------------------------------------------------------------

  /** There is no pooled handle to release; mark the repository unusable. */
  async close(): Promise<void> {
    this.client = null;
    this.capabilities = null;
    this.initialized = false;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
