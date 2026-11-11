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

/**
 * Bounded read windows for the evidence counts.
 *
 * Each read asks for one row past its window. That extra row is the only way a
 * capped read can tell "there are exactly this many" from "there are at least this
 * many": a count that fills the window is a floor, and the caller is told so instead
 * of being handed an array length that looks exhaustive.
 */
const ANOMALY_WINDOW = 200;
const PROPOSAL_WINDOW = 50;
const VERSION_WINDOW = 20;
/** Retained snapshots `applied` lists before the evolution explanation stops. */
export const APPLIED_EVOLUTION_WINDOW = 5;

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

function isOpen(anomaly: AnomalyNode): boolean {
  const status = trimmed(anomaly.status).toLowerCase();
  return status.length === 0 || (status !== 'resolved' && status !== 'closed' && status !== 'rejected');
}

/** A window read fills the window when the sentinel row past it came back. */
function windowFilled(rowCount: number, window: number): boolean {
  return rowCount > window;
}

/** Empty evidence, used when the adapter node is not in the graph yet. */
export function emptyEvidence(): OntologyEvidence {
  return {
    open_anomalies: 0,
    open_anomalies_truncated: false,
    anomaly_window: ANOMALY_WINDOW,
    pending_proposals: 0,
    pending_proposals_truncated: false,
    accepted_proposals: 0,
    accepted_proposals_truncated: false,
    proposal_window: PROPOSAL_WINDOW,
    version_snapshots: 0,
    version_snapshots_truncated: false,
    version_window: VERSION_WINDOW,
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
 * zero, never invented. Capped reads report their window: a count that filled it is a
 * floor, and `*_truncated` says so rather than letting an array length look total.
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
  let anomalyTruncated = false;
  let proposalTruncated = false;
  let versionTruncated = false;

  try {
    // The scope travels into the query: filtering a capped read afterwards would let
    // foreign-scope rows crowd the local evidence out of its own window.
    const rows = await graphDb.listAnomalies({
      routesTo: slug,
      scopeSpaceId: scope.space_id,
      limit: ANOMALY_WINDOW + 1
    });
    anomalyTruncated = windowFilled(rows.length, ANOMALY_WINDOW);
    anomalies = rows.slice(0, ANOMALY_WINDOW);
  } catch (err) {
    notes.push(`anomalies unreadable: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    const rows = await graphDb.listProposals({
      targetKey: adapterKey,
      space: scope.space_id,
      limit: PROPOSAL_WINDOW + 1
    });
    proposalTruncated = windowFilled(rows.length, PROPOSAL_WINDOW);
    proposals = rows.slice(0, PROPOSAL_WINDOW);
  } catch (err) {
    notes.push(`proposals unreadable: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    const rows = await graphDb.listVersions(adapterKey, { limit: VERSION_WINDOW + 1 });
    versionTruncated = windowFilled(rows.length, VERSION_WINDOW);
    versions = rows.slice(0, VERSION_WINDOW);
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
      open_anomalies_truncated: anomalyTruncated,
      anomaly_window: ANOMALY_WINDOW,
      pending_proposals: pending.length,
      pending_proposals_truncated: proposalTruncated,
      accepted_proposals: accepted.length,
      accepted_proposals_truncated: proposalTruncated,
      proposal_window: PROPOSAL_WINDOW,
      version_snapshots: versions.length,
      version_snapshots_truncated: versionTruncated,
      version_window: VERSION_WINDOW,
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

/**
 * Explain which snapshot is current and what accepted evolution is reflected.
 *
 * `appliedTruncated` reaches the prose too: an `applied` list that stopped at its window
 * cannot say how many older snapshots exist, so the sentence says "at least" instead of
 * asserting a count the read never established.
 */
export function explainEvolution(
  latest: VersionNode | null,
  applied: AppliedEvolutionRow[],
  accepted: EvolutionProposalNode[],
  appliedTruncated = false
): string {
  if (!latest) return 'No graph-native snapshot is recorded for this adapter yet.';
  const head = `Snapshot ${latest.version_number} (adapter version ${latest.adapter_version}) is ${latest.change_type} by ${latest.changed_by} at ${latest.changed_at}: ${latest.reason}`;
  const earlier = applied.length - 1;
  const history = applied.length > 1
    ? ` ${appliedTruncated ? 'at least ' : ''}${earlier} earlier snapshot(s) are retained immutably.`
    : '';
  const resolved = accepted.length
    ? ` Accepted evolution: ${accepted.map((p) => `${p.field} on ${p.target_slug}`).join(', ')}.`
    : '';
  return `${head}.${history}${resolved}`;
}
