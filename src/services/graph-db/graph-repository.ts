/**
 * Narrow graph repository port.
 *
 * The port names exactly the operations the runtime uses. It deliberately does
 * not expose the backend query language: no tool and no adapter can issue raw
 * graph queries (see docs/specs/ontological-knowledge-system.md, "Mode
 * agnosticism principle" — "query" means activate-time retrieval, not a tool).
 *
 * Two implementations satisfy it:
 *
 *   - `GraphDatabaseService` (LadybugDB, embedded, MIT)
 *   - `ArangoGraphRepository` (ArangoDB <= 3.11, shared, Apache-2.0)
 *
 * @see docs/adr/0044-graph-repository-port-and-arango-shared-backend.md
 */
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
  ResolvedInheritance,
  VersionAppendInput,
  VersionNode
} from './graph-types.js';

/**
 * Operations the runtime performs on the adapter ontology graph.
 *
 * Contract notes:
 * - Every write resolves its own scope from the caller-supplied `spaceId`; the
 *   implementation never invents one.
 * - `upsertAdapterFromFrontmatter` returns the scoped adapter key it wrote.
 * - `writeInheritanceEdges` returns the parent key it linked, or `null`.
 * - `appendVersion` is append-only: an existing `(entity_key, version_number)`
 *   is never overwritten. A failed optimistic check raises
 *   `GraphVersionConflictError`.
 */
export interface GraphRepository {
  /** Open/verify the backend. Idempotent; a configuration error must throw. */
  initialize(): Promise<void>;
  /** True when the backend finished initializing and is usable. */
  isInitialized(): boolean;
  /** Release the backend handle. Idempotent. */
  close(): Promise<void>;

  // --- Adapter topology (derived projection) -------------------------------
  getAdapter(adapterKey: string): Promise<AdapterNode | null>;
  /**
   * Every projected adapter, for whole-graph invariants (projection completeness,
   * rebuild reconciliation). Both backends already answered this before the port
   * existed; naming it here is what lets a rebuild or a parity check assert
   * completeness without reaching into a concrete backend class.
   */
  getAllAdapters(): Promise<AdapterNode[]>;
  upsertAdapterFromFrontmatter(
    slug: string,
    version: string,
    frontmatter: Record<string, unknown>,
    opts: AdapterNodeWriteOptions
  ): Promise<string>;
  writeInheritanceEdges(
    childKey: string,
    frontmatter: Record<string, unknown>,
    opts: { parentSpaceId: string; now?: string }
  ): Promise<string | null>;
  clearInheritanceEdges(childKey: string): Promise<void>;
  getChildren(spaceId: string, slug: string): Promise<string[]>;
  resolveInheritance(adapterKey: string): Promise<ResolvedInheritance | null>;

  // --- Ontology records ----------------------------------------------------
  createAnomaly(anomaly: AnomalyNode): Promise<void>;
  listAnomalies(filter?: AnomalyFilter): Promise<AnomalyNode[]>;

  // --- Graph-native history (immutable, append-only) -----------------------
  appendVersion(input: VersionAppendInput): Promise<VersionNode>;
  getVersion(entityKey: string, versionNumber: string): Promise<VersionNode | null>;
  getLatestVersion(entityKey: string): Promise<VersionNode | null>;
  listVersions(entityKey: string, filter?: HistoryFilter): Promise<VersionNode[]>;

  // --- Evidence-gated evolution -------------------------------------------
  createProposal(proposal: EvolutionProposalNode): Promise<void>;
  getProposal(proposalKey: string): Promise<EvolutionProposalNode | null>;
  listProposals(filter?: ProposalFilter): Promise<EvolutionProposalNode[]>;
  updateProposalStatus(
    proposalKey: string,
    status: EvolutionProposalNode['status'],
    metadata?: Record<string, unknown>
  ): Promise<void>;
  recordConfirmation(confirmation: ProposalConfirmation): Promise<void>;
  listConfirmations(proposalKey: string): Promise<ProposalConfirmation[]>;

  // --- Concept / instance ontology (retrieval inputs) ---------------------
  upsertConcept(concept: ConceptNode): Promise<void>;
  getConcept(conceptKey: string): Promise<ConceptNode | null>;
  /** Ancestors of an adapter, nearest-first or root-first. */
  findPathToRoot(
    adapterKey: string,
    order?: 'nearest-first' | 'root-first'
  ): Promise<PathToRootResult[]>;
}
