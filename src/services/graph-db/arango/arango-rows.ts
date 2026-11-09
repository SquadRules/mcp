/**
 * ArangoDB document → backend-neutral node mapping.
 *
 * ArangoDB uses `_key` as the physical primary key and stores JSON natively, so this
 * module is where the logical `key` is restored and where nested objects stop being
 * `unknown`.
 */
import type {
  AdapterNode,
  AnomalyNode,
  ConceptNode,
  EvolutionProposalNode,
  ProposalConfirmation,
  ProposalStatus,
  VersionNode
} from '../graph-types.js';

/** A stored document with ArangoDB's system attributes. */
export type ArangoDoc = Record<string, unknown> & { _key?: string };

export function docKey(doc: ArangoDoc): string {
  return String(doc['_key'] ?? '');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

export function adapterFromDoc(doc: ArangoDoc): AdapterNode {
  const node: AdapterNode = {
    key: docKey(doc),
    type: 'adapter',
    slug: String(doc['slug'] ?? ''),
    version: String(doc['version'] ?? ''),
    title: String(doc['title'] ?? ''),
    created_at: String(doc['created_at'] ?? ''),
    updated_at: String(doc['updated_at'] ?? ''),
    layer_count: Number(doc['layer_count'] ?? 0),
    contract_types: asStringArray(doc['contract_types']),
    tags: asStringArray(doc['tags']),
    metadata: asRecord(doc['metadata'])
  };
  const frontmatter = doc['frontmatter'];
  if (frontmatter && typeof frontmatter === 'object') {
    node.frontmatter = frontmatter as NonNullable<AdapterNode['frontmatter']>;
  }
  const space = optionalString(doc['space']);
  if (space) node.space = space;
  return node;
}

export function versionFromDoc(doc: ArangoDoc): VersionNode {
  const node: VersionNode = {
    key: docKey(doc),
    type: 'version',
    entity_key: String(doc['entity_key'] ?? ''),
    entity_uri: String(doc['entity_uri'] ?? ''),
    version_number: String(doc['version_number'] ?? doc['version_seq'] ?? ''),
    adapter_version: String(doc['adapter_version'] ?? ''),
    change_type: String(doc['change_type'] ?? 'updated') as VersionNode['change_type'],
    changed_at: String(doc['changed_at'] ?? ''),
    changed_by: String(doc['changed_by'] ?? ''),
    actor_source: String(doc['actor_source'] ?? ''),
    space: String(doc['space'] ?? ''),
    parent_version:
      doc['parent_version'] === null || doc['parent_version'] === undefined
        ? null
        : String(doc['parent_version']),
    reason: String(doc['reason'] ?? ''),
    content_digest: String(doc['content_digest'] ?? ''),
    content: String(doc['content'] ?? ''),
    metadata_snapshot: asRecord(doc['metadata_snapshot'])
  };
  const metadata = doc['metadata'];
  if (metadata && typeof metadata === 'object') {
    node.metadata = metadata as Record<string, unknown>;
  }
  return node;
}

export function proposalFromDoc(doc: ArangoDoc): EvolutionProposalNode {
  const node: EvolutionProposalNode = {
    key: docKey(doc),
    type: 'proposal',
    target_key: String(doc['target_key'] ?? ''),
    target_slug: String(doc['target_slug'] ?? ''),
    space: String(doc['space'] ?? ''),
    change_type: String(doc['change_type'] ?? 'parent_update') as EvolutionProposalNode['change_type'],
    field: String(doc['field'] ?? ''),
    from_value:
      doc['from_value'] === null || doc['from_value'] === undefined
        ? null
        : String(doc['from_value']),
    to_value: String(doc['to_value'] ?? ''),
    reason: String(doc['reason'] ?? ''),
    source_child: String(doc['source_child'] ?? ''),
    evidence: asRecord(doc['evidence']),
    evidence_digest: String(doc['evidence_digest'] ?? ''),
    status: String(doc['status'] ?? 'proposed') as ProposalStatus,
    created_at: String(doc['created_at'] ?? ''),
    created_by: String(doc['created_by'] ?? ''),
    actor_source: String(doc['actor_source'] ?? ''),
    required_confirmations: Number(doc['required_confirmations'] ?? 1)
  };
  const anomaly = optionalString(doc['source_anomaly']);
  if (anomaly) node.source_anomaly = anomaly;
  const metadata = doc['metadata'];
  if (metadata && typeof metadata === 'object') {
    node.metadata = metadata as Record<string, unknown>;
  }
  return node;
}

export function confirmationFromDoc(doc: ArangoDoc): ProposalConfirmation {
  const node: ProposalConfirmation = {
    key: docKey(doc),
    type: 'confirmation',
    proposal_key: String(doc['proposal_key'] ?? ''),
    actor: String(doc['actor'] ?? ''),
    actor_kind: String(doc['actor_kind'] ?? 'agent') as ProposalConfirmation['actor_kind'],
    actor_source: String(doc['actor_source'] ?? ''),
    decision: String(doc['decision'] ?? 'confirm') as ProposalConfirmation['decision'],
    created_at: String(doc['created_at'] ?? '')
  };
  const distinctChild = optionalString(doc['distinct_child']);
  if (distinctChild) node.distinct_child = distinctChild;
  const evidence = doc['evidence'];
  if (evidence && typeof evidence === 'object') {
    node.evidence = evidence as Record<string, unknown>;
  }
  return node;
}

export function anomalyFromDoc(doc: ArangoDoc): AnomalyNode {
  const metadata = asRecord(doc['metadata']);
  const node: AnomalyNode = {
    key: docKey(doc),
    type: 'Anomaly',
    discovered_by: String(doc['discovered_by'] ?? ''),
    routes_to: String(doc['routes_to'] ?? ''),
    description: String(doc['description'] ?? ''),
    created_at: String(doc['created_at'] ?? ''),
    metadata
  };
  const severity = optionalString(doc['severity']);
  if (severity) node.severity = severity;
  const anomalyType = optionalString(doc['anomaly_type']);
  if (anomalyType) node.anomaly_type = anomalyType;
  const status = optionalString(doc['status']);
  if (status) node.status = status;
  const sourceChild = optionalString(metadata['source_child']);
  if (sourceChild) node.source_child = sourceChild;
  return node;
}

export function conceptFromDoc(doc: ArangoDoc): ConceptNode {
  return {
    key: docKey(doc),
    type: 'concept',
    name: String(doc['name'] ?? ''),
    definition: String(doc['definition'] ?? ''),
    created_at: String(doc['created_at'] ?? ''),
    updated_at: String(doc['updated_at'] ?? ''),
    baseline_attributes: asRecord(doc['baseline_attributes']),
    tags: asStringArray(doc['tags']),
    metadata: asRecord(doc['metadata'])
  };
}
