/**
 * Canonical graph model shared by every backend.
 *
 * The logical names here are backend-neutral (`key`, `from`, `to`). A backend maps
 * them to its own physical storage (`_key`/`_from`/`_to` in ArangoDB) but never
 * leaks those physical names into this module — see docs/specs/graph-schema.md §
 * "Physical key mapping".
 *
 * @see docs/specs/graph-schema.md
 * @see docs/adr/0044-graph-repository-port-and-arango-shared-backend.md
 */

/** Identity of the actor that wrote a graph record, resolved by the runtime. */
export interface GraphActor {
  /** Authenticated subject, or the runtime sentinel when auth is disabled. */
  actor: string;
  /** Where the identity came from — never a value supplied by the document. */
  actor_source: 'auth-subject' | 'runtime-local';
}

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
    /** Author-declared domain properties, preserved verbatim (ADR 0043). */
    [key: string]: unknown;
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

export interface InstanceNode {
  key: string;
  type: 'instance';
  concept: string;
  instance_id: string;
  created_at: string;
  attributes?: Record<string, any>;
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
  severity?: string;
  anomaly_type?: string;
  status?: string;
  /** Scoped key of the child adapter that reported it, when the report is scoped. */
  source_child?: string;
  metadata?: Record<string, any>;
}

/**
 * Immutable graph-native version record.
 *
 * `version_number` is a monotonic per-entity sequence (1, 2, 3 …) so repeated
 * trains of the same semantic version still produce distinct, orderable history.
 * `content` is the full stored document, which is what makes restoration through
 * normal `train` possible — a digest alone cannot restore source content.
 */
export interface VersionNode {
  key: string;
  type: 'version';
  /** Scoped adapter key (`adapter:<spaceId>:<slug>`). */
  entity_key: string;
  /** Logical entity URI (`adapter://<slug>`). */
  entity_uri: string;
  /** Monotonic sequence, string-encoded so both backends store it identically. */
  version_number: string;
  /** Semantic adapter version at snapshot time. */
  adapter_version: string;
  change_type: 'created' | 'updated' | 'restored' | 'deprecated' | 'deleted';
  changed_at: string;
  changed_by: string;
  actor_source: string;
  space: string;
  /** Previous monotonic number, or null for the first snapshot. */
  parent_version: string | null;
  reason: string;
  /** SHA-256 of the exact `content` bytes. Proves the bytes, not the claim. */
  content_digest: string;
  /** Full stored markdown document, byte-exact. */
  content: string;
  /** Metadata observed at snapshot time (title, layer counts, topology). */
  metadata_snapshot: Record<string, unknown>;
  metadata?: Record<string, any>;
}

export type ProposalStatus = 'proposed' | 'accepted' | 'rejected' | 'branched';

/**
 * Evidence-gated evolution proposal.
 *
 * A proposal never mutates its target adapter node. It records what should change,
 * from/to, the evidence, and the unique source child that produced it. Consensus
 * is evaluated by `evaluateProposalConsensus` from confirmations and evidence —
 * never from execution counts.
 */
export interface EvolutionProposalNode {
  key: string;
  type: 'proposal';
  /** Scoped key of the parent adapter/concept this proposal targets. */
  target_key: string;
  target_slug: string;
  space: string;
  change_type: 'parent_update' | 'subcategory_split';
  /** Field to change: a domain property name, `must_always`, or `must_never`. */
  field: string;
  from_value: string | null;
  to_value: string;
  reason: string;
  /** Scoped child key that raised the proposal — unique proposal source. */
  source_child: string;
  source_anomaly?: string;
  /** Deterministic evidence payload; hashed for integrity only. */
  evidence: Record<string, unknown>;
  /** SHA-256 over the serialized evidence. Integrity, not truth. */
  evidence_digest: string;
  status: ProposalStatus;
  created_at: string;
  created_by: string;
  actor_source: string;
  /** 1 for a core contradiction (auto), 3 for frequency-based proposals. */
  required_confirmations: number;
  metadata?: Record<string, any>;
}

export interface ProposalConfirmation {
  key: string;
  type: 'confirmation';
  proposal_key: string;
  actor: string;
  actor_kind: 'agent' | 'human_expert';
  actor_source: string;
  /** Distinct child that supplies the observation, used for frequency evidence. */
  distinct_child?: string;
  decision: 'confirm' | 'reject';
  evidence?: Record<string, unknown>;
  created_at: string;
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

/**
 * Scope options for a graph write. `spaceId` is required because the graph never
 * invents a scope: the node key is `adapter:<spaceId>:<slug>` and the same slug in
 * two spaces must produce two independent nodes.
 */
export interface AdapterNodeWriteOptions {
  spaceId: string;
  parentSpaceId?: string;
  title?: string;
  layerCount?: number;
  contractTypes?: string[];
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface ResolvedInheritance {
  adapter: AdapterNode;
  resolved_properties: Record<string, any>;
  inheritance_chain: (AdapterNode | ConceptNode)[];
}

/** Input for appending an immutable version record. */
export interface VersionAppendInput {
  adapterKey: string;
  slug: string;
  adapterVersion: string;
  space: string;
  changeType: VersionNode['change_type'];
  reason: string;
  content: string;
  metadataSnapshot: Record<string, unknown>;
  actor: GraphActor;
  /** When set, the write fails closed unless it equals the current head sequence. */
  expectedParentVersion?: string | null;
  /**
   * When set, the write fails closed unless the current head's semantic version
   * equals this value. This is the CAS used by "restore to version N" flows.
   */
  expectedAdapterVersion?: string;
}

export interface HistoryFilter {
  /** Cap on returned rows (newest first). */
  limit?: number;
  /** Only rows after this monotonic version number (exclusive). */
  afterVersion?: string;
}

export interface ProposalFilter {
  targetKey?: string;
  space?: string;
  status?: ProposalStatus;
  sourceChild?: string;
  limit?: number;
}

export interface AnomalyFilter {
  routesTo?: string;
  status?: string;
  sourceChild?: string;
  limit?: number;
}

/** Raised when an optimistic version check loses a race. */
export class GraphVersionConflictError extends Error {
  constructor(
    message: string,
    public readonly details: {
      entity_key: string;
      expected: string | null;
      actual: string | null;
    }
  ) {
    super(message);
    this.name = 'GraphVersionConflictError';
  }
}
