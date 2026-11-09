/**
 * Scoped evidence + filter resolution for the activate ontology context (ADR 0047).
 *
 * Every read is addressed by the activated adapter's scoped key, its slug, or its
 * resolved space. `human` and `org` come from the runtime space context; `task` and
 * `domain` are caller-declared additions. No value here widens a search.
 */
import type { GraphRepository } from '../graph-repository.js';
import type { AnomalyNode, EvolutionProposalNode, VersionNode } from '../graph-types.js';
import { getSpaceContextFromStorage } from '../../../utils/tenant-context.js';
import type {
  AppliedEvolutionRow,
  ContextAdapterFacts,
  ExplicitActivationContext,
  OntologyContextFilters,
  OntologyEvidence,
  OntologyEvidenceRow,
  OntologyScopeInfo
} from './types.js';

const EVIDENCE_CAP = 5;

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Permitted group space for this request, or null. Never a global lookup. */
function permittedOrgSpace(): string | null {
  const ctx = getSpaceContextFromStorage();
  if (ctx.defaultWriteSpaceId.startsWith('group:')) return ctx.defaultWriteSpaceId;
  return ctx.allowedSpaceIds.find((id: string) => id.startsWith('group:')) ?? null;
}

/** Resolve the explicit filters, recording where each value came from. */
export function resolveFilters(
  explicit: ExplicitActivationContext | undefined,
  adapter: ContextAdapterFacts | null
): OntologyContextFilters {
  const ctx = getSpaceContextFromStorage();
  const actor = trimmed(ctx.userId);
  const human = actor ? `human://${actor}` : null;
  const org = permittedOrgSpace();
  const callerDomain = trimmed(explicit?.domain);
  const declaredDomain = callerDomain || trimmed(adapter?.frontmatter?.['domain']) || trimmed(adapter?.metadata?.['domain']);
  const task = trimmed(explicit?.task);
  const sources: Record<string, string> = {};
  if (task) sources['task'] = 'caller-declared';
  if (declaredDomain) sources['domain'] = callerDomain ? 'caller-declared' : 'stored-adapter-frontmatter';
  if (human) sources['human'] = 'runtime-actor';
  if (org) sources['org'] = 'permitted-space';
  return {
    task: task || null,
    domain: declaredDomain || null,
    human,
    org,
    sources
  };
}

/** An anomaly belongs to this projection only when it carries the same scope. */
function anomalyInScope(anomaly: AnomalyNode, spaceId: string): boolean {
  const scopedChild = trimmed(anomaly.source_child);
  if (scopedChild.length > 0) return scopedChild.startsWith(`adapter:${spaceId}:`);
  const metadataScope = trimmed(anomaly.metadata?.['scope_space_id']);
  return metadataScope.length > 0 && metadataScope === spaceId;
}

function isOpen(anomaly: AnomalyNode): boolean {
  const status = trimmed(anomaly.status).toLowerCase();
  return status.length === 0 || (status !== 'resolved' && status !== 'closed' && status !== 'rejected');
}

/** Empty evidence, used when the adapter node is not in the graph yet. */
export function emptyEvidence(): OntologyEvidence {
  return {
    open_anomalies: 0,
    pending_proposals: 0,
    accepted_proposals: 0,
    version_snapshots: 0,
    anomalies: [],
    proposals: []
  };
}

export interface EvidenceReadResult {
  evidence: OntologyEvidence;
  versions: VersionNode[];
  proposals: EvolutionProposalNode[];
  degraded: string | null;
}

/**
 * Read anomalies, proposals and history for one scoped adapter.
 *
 * Partial reads degrade honestly: a failed read is reported and its contribution is
 * zero, never invented.
 */
export async function readEvidence(
  graphDb: GraphRepository,
  scope: OntologyScopeInfo,
  slug: string,
  adapterKey: string
): Promise<EvidenceReadResult> {
  const notes: string[] = [];
  let anomalies: AnomalyNode[] = [];
  let proposals: EvolutionProposalNode[] = [];
  let versions: VersionNode[] = [];

  try {
    anomalies = (await graphDb.listAnomalies({ routesTo: slug, limit: 200 })).filter((a) =>
      anomalyInScope(a, scope.space_id)
    );
  } catch (err) {
    notes.push(`anomalies unreadable: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    proposals = await graphDb.listProposals({ targetKey: adapterKey, space: scope.space_id, limit: 50 });
  } catch (err) {
    notes.push(`proposals unreadable: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    versions = await graphDb.listVersions(adapterKey, { limit: 20 });
  } catch (err) {
    notes.push(`history unreadable: ${err instanceof Error ? err.message : String(err)}`);
  }

  const open = anomalies.filter(isOpen);
  const pending = proposals.filter((p) => p.status === 'proposed');
  const accepted = proposals.filter((p) => p.status === 'accepted');
  const anomalyRows: OntologyEvidenceRow[] = open.slice(0, EVIDENCE_CAP).map((a) => ({
    key: a.key,
    detail: `${a.severity ?? 'unspecified severity'}: ${a.description}`
  }));
  const proposalRows: OntologyEvidenceRow[] = pending.slice(0, EVIDENCE_CAP).map((p) => ({
    key: p.key,
    detail: `${p.change_type} ${p.field}: ${p.from_value ?? 'null'} -> ${p.to_value} (status ${p.status})`
  }));

  return {
    evidence: {
      open_anomalies: open.length,
      pending_proposals: pending.length,
      accepted_proposals: accepted.length,
      version_snapshots: versions.length,
      anomalies: anomalyRows,
      proposals: proposalRows
    },
    versions,
    proposals,
    degraded: notes.length ? notes.join('; ') : null
  };
}

export function appliedRow(version: VersionNode): AppliedEvolutionRow {
  return {
    version_number: version.version_number,
    adapter_version: version.adapter_version,
    change_type: version.change_type,
    changed_at: version.changed_at,
    changed_by: version.changed_by,
    reason: version.reason,
    content_digest: version.content_digest
  };
}

/** Explain which snapshot is current and what accepted evolution is reflected. */
export function explainEvolution(
  latest: VersionNode | null,
  applied: AppliedEvolutionRow[],
  accepted: EvolutionProposalNode[]
): string {
  if (!latest) return 'No graph-native snapshot is recorded for this adapter yet.';
  const head = `Snapshot ${latest.version_number} (adapter version ${latest.adapter_version}) is ${latest.change_type} by ${latest.changed_by} at ${latest.changed_at}: ${latest.reason}`;
  const history = applied.length > 1 ? ` ${applied.length - 1} earlier snapshot(s) are retained immutably.` : '';
  const resolved = accepted.length
    ? ` Accepted evolution: ${accepted.map((p) => `${p.field} on ${p.target_slug}`).join(', ')}.`
    : '';
  return `${head}.${history}${resolved}`;
}
