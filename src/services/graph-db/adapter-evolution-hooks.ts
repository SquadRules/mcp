/**
 * Derived graph facts for a successful adapter write (ADR 0045 / ADR 0046).
 *
 * Called after `train`/`tune` has persisted an adapter and projected its topology.
 * It records, in one place:
 *
 *   1. an immutable version snapshot of the exact stored markdown,
 *   2. an `Anomaly` node when the document declared `anomaly:` frontmatter,
 *   3. an evolution proposal for every **deterministic** child/parent contradiction.
 *
 * All three are bookkeeping over a write that already succeeded: a graph failure
 * never fails the write. Nothing here mutates the parent adapter — proposals are
 * records and the parent change happens through a later normal `tune`.
 */
import { randomUUID } from 'node:crypto';
import type { Memory } from '../../types/memory.js';
import type { AdapterRecordSource } from './adapter-graph-records.js';
import {
  resolveStoredAdapterLayers,
  resolveStoredParentSnapshot,
  snapshotFromStoredMemory
} from './adapter-graph-records.js';
import { adapterGraphKey, storedAdapterScope } from './adapter-scope.js';
import { getGraphDb } from './graph-owner.js';
import { recordAdapterVersion } from './graph-history.service.js';
import { detectContradictions, factsFromMarkdown, parsePrimitive } from './evolution/detection.js';
import { proposeChange } from './evolution/evolution.service.js';
import type { GraphRepository } from './graph-repository.js';
import type { AnomalyNode } from './graph-types.js';
import { parseFrontmatter } from '../../utils/frontmatter.js';
import { sha256Hex } from '../../utils/sha256.js';
import { structuredLogger } from '../../utils/structured-logger.js';

/** Outcome of the derived-fact pass. Every field is best-effort and reportable. */
export interface AdapterEvolutionReport {
  version: string | null;
  anomaly_key: string | null;
  proposal_keys: string[];
  skipped: string | null;
}

export interface AdapterEvolutionParams {
  /** Store the graph is attached to (`getGraphDb` owner). */
  owner: object;
  /** Stored head layer of the adapter that was just written. */
  head: Memory;
  /** Exact markdown that was persisted. */
  markdown: string;
  /** Record-enumerating surface used to read the parent, when one exists. */
  source?: AdapterRecordSource | null;
  changeType: 'created' | 'updated' | 'restored';
  reason: string;
}

const EMPTY: AdapterEvolutionReport = { version: null, anomaly_key: null, proposal_keys: [], skipped: null };

function anomalyNode(
  parsedAnomaly: Record<string, string>,
  discoveredBy: string,
  routesTo: string,
  scope: string
): AnomalyNode {
  const description =
    parsedAnomaly['reason']?.trim() ||
    parsedAnomaly['description']?.trim() ||
    `agent-declared ${parsedAnomaly['type']?.trim() || 'anomaly'} on ${discoveredBy}`;
  const node: AnomalyNode = {
    key: `anomaly:${randomUUID()}`,
    type: 'Anomaly',
    discovered_by: discoveredBy,
    routes_to: routesTo,
    description,
    created_at: new Date().toISOString(),
    severity: parsedAnomaly['severity']?.trim() || 'medium',
    anomaly_type: parsedAnomaly['type']?.trim() || 'contradiction',
    status: parsedAnomaly['status']?.trim() || 'open'
  };
  node.metadata = {
    scope_space_id: scope,
    scope_source: 'stored-record',
    source: 'frontmatter',
    field: parsedAnomaly['field'] ?? null,
    observed: parsedAnomaly['observed'] ?? null,
    expected: parsedAnomaly['expected'] ?? null
  };
  return node;
}

/** Child key of a stored adapter, used as the proposal's unique source child. */
function childKey(spaceId: string, slug: string): string {
  return adapterGraphKey(spaceId, slug);
}

/**
 * Earlier snapshot whose bytes equal this write, if any.
 *
 * Only used to label a restore honestly; a digest match proves byte identity, not
 * that the caller intended a restore, so the label names the source snapshot.
 */
async function findRestoredFrom(
  graphDb: GraphRepository,
  key: string,
  headVersion: string,
  markdown: string
): Promise<string | null> {
  try {
    const digest = sha256Hex(markdown);
    const versions = await graphDb.listVersions(key, { limit: 50 });
    const match = versions.find(
      (v) => v.version_number !== headVersion && v.content_digest === digest
    );
    return match?.version_number ?? null;
  } catch {
    return null;
  }
}

/**
 * Record the version snapshot and any derived evolution facts.
 *
 * Returns a report instead of throwing: the caller's write already succeeded, and a
 * missing graph is a documented degradation, not a failure.
 */
export async function recordAdapterEvolution(params: AdapterEvolutionParams): Promise<AdapterEvolutionReport> {
  const graphDb = getGraphDb(params.owner);
  if (!graphDb || !graphDb.isInitialized()) {
    return { ...EMPTY, skipped: 'no graph repository for this store' };
  }

  const scope = storedAdapterScope(params.head.space_id, `evolution:${params.changeType}`);
  const snapshot = snapshotFromStoredMemory(params.head, scope);
  if (!snapshot) {
    return { ...EMPTY, skipped: 'stored head has no adapter identity' };
  }

  const report: AdapterEvolutionReport = { ...EMPTY };
  const key = childKey(scope.spaceId, snapshot.slug);

  // First successful write of an adapter is `created`; every later one is `updated`
  // even when the caller (train) cannot tell the two apart before the write.
  const head = await graphDb.getLatestVersion(key);
  let changeType: 'created' | 'updated' | 'restored' = head
    ? params.changeType === 'created'
      ? 'updated'
      : params.changeType
    : 'created';
  let reason = params.reason;
  if (head && changeType === 'updated') {
    // A restore is an ordinary `train`/`tune` whose bytes equal an *earlier* snapshot.
    // The digest proves those bytes; the restored-from number names the source.
    const restoredFrom = await findRestoredFrom(graphDb, key, head.version_number, params.markdown);
    if (restoredFrom) {
      changeType = 'restored';
      reason = `${reason}; restored from snapshot ${restoredFrom}`;
    }
  }

  const version = await recordAdapterVersion(graphDb, {
    adapterKey: key,
    slug: snapshot.slug,
    adapterVersion: snapshot.version,
    space: scope.spaceId,
    changeType,
    reason,
    content: params.markdown,
    metadataSnapshot: {
      slug: snapshot.slug,
      version: snapshot.version,
      title: snapshot.title ?? null,
      layer_count: snapshot.layerCount ?? null,
      inherits: snapshot.frontmatter.inherits ?? null,
      scope_source: scope.source
    }
  });
  report.version = version?.version_number ?? null;

  const parsed = parseFrontmatter(params.markdown);
  if (parsed.anomaly) {
    report.anomaly_key = await recordDeclaredAnomaly(graphDb, parsed.anomaly, snapshot.slug, scope.spaceId, key);
  }

  try {
    report.proposal_keys = await recordProposals(graphDb, params, snapshot, key, scope.spaceId);
  } catch (err) {
    structuredLogger.warn(
      `evolution: proposal pass failed for ${key} — ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return report;
}

async function recordDeclaredAnomaly(
  graphDb: GraphRepository,
  parsedAnomaly: Record<string, string>,
  slug: string,
  spaceId: string,
  sourceChild: string
): Promise<string | null> {
  try {
    const node = anomalyNode(parsedAnomaly, slug, parsedAnomaly['routes_to']?.trim() || slug, spaceId);
    node.source_child = sourceChild;
    await graphDb.createAnomaly(node);
    return node.key;
  } catch (err) {
    structuredLogger.warn(
      `evolution: declared anomaly write failed for ${slug} — ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

interface ResolvedContradictions {
  parentKey: string;
  parentSpaceId: string;
  parentVersion: string;
  contradictions: ReturnType<typeof detectContradictions>;
  frequency: Map<string, string[]>;
}

/**
 * Resolve the parent and every deterministic contradiction to it.
 *
 * Returns `null` when the child declares no parent, the parent cannot be read from
 * any candidate scope, or nothing deterministic contradicts it. Semantic ("this
 * means something different") judgements are intentionally excluded.
 */
async function resolveContradictions(
  params: AdapterEvolutionParams,
  graphDb: GraphRepository,
  scopeSpaceId: string
): Promise<ResolvedContradictions | null> {
  const declaredParent = params.head.adapter?.frontmatter?.inherits;
  const parentSlug = typeof declaredParent === 'string' ? declaredParent.trim() : '';
  if (!parentSlug || !params.source) return null;

  const resolved = await resolveStoredParentSnapshot(params.source, parentSlug, scopeSpaceId);
  if (!resolved) return null;

  const parentLayers = await resolveStoredAdapterLayers(params.source, parentSlug, resolved.spaceId);
  const parentHead = parentLayers?.find((layer) => (layer.adapter?.layer_index ?? 1) === 1) ?? parentLayers?.[0];
  const parentFields: Record<string, string> = {};
  for (const [name, value] of Object.entries(resolved.snapshot.frontmatter)) {
    if (value === undefined || value === null) continue;
    parentFields[name] = String(value);
  }
  const contradictions = detectContradictions(factsFromMarkdown(params.markdown), {
    fields: parentFields,
    body: parentHead?.text ?? ''
  });
  if (contradictions.length === 0) return null;

  const parentKey = adapterGraphKey(resolved.spaceId, resolved.snapshot.slug);
  const frequency = new Map<string, string[]>();
  for (const contradiction of contradictions) {
    const children = await distinctReportingChildren(graphDb, resolved.snapshot.slug, contradiction.field);
    frequency.set(contradiction.field, children);
  }

  return {
    parentKey,
    parentSpaceId: resolved.spaceId,
    parentVersion: resolved.snapshot.version,
    contradictions,
    frequency
  };
}

/** Distinct children already reporting an anomaly for this parent + field. */
async function distinctReportingChildren(
  graphDb: GraphRepository,
  parentSlug: string,
  field: string
): Promise<string[]> {
  const anomalies = await graphDb.listAnomalies({ routesTo: parentSlug, limit: 500 });
  const children = new Set<string>();
  for (const anomaly of anomalies) {
    if (anomaly.metadata?.['field'] !== field) continue;
    const child = (anomaly.source_child ?? '').trim();
    if (child.length > 0) children.add(child);
  }
  return [...children];
}

async function recordProposals(
  graphDb: GraphRepository,
  params: AdapterEvolutionParams,
  snapshot: ReturnType<typeof snapshotFromStoredMemory>,
  sourceChild: string,
  scopeSpaceId: string
): Promise<string[]> {
  if (!snapshot) return [];
  const resolved = await resolveContradictions(params, graphDb, scopeSpaceId);
  if (!resolved) return [];

  const keys: string[] = [];
  for (const contradiction of resolved.contradictions) {
    const reporting = resolved.frequency.get(contradiction.field) ?? [];
    const frequencyMet = new Set([...reporting, sourceChild]).size >= 3;
    const proposed = await proposeChange(graphDb, {
      targetKey: resolved.parentKey,
      targetSlug: snapshot.frontmatter.inherits ?? snapshot.slug,
      space: resolved.parentSpaceId,
      changeType: 'parent_update',
      field: contradiction.field,
      fromValue: contradiction.parent_value,
      toValue: childPrimitive(snapshot.frontmatter, params.markdown, contradiction.field, contradiction.child_value),
      reason: contradiction.summary,
      sourceChild,
      evidence: {
        kind: 'deterministic-contradiction',
        contradiction_kind: contradiction.kind,
        parent_value: contradiction.parent_value,
        child_value: contradiction.child_value,
        // Both names are recorded on purpose: `parent_adapter_version` describes the
        // observation, and `target_adapter_version` is what `buildApplyPlan` turns into
        // the `expected_version` of the normal `tune` that applies the change.
        parent_adapter_version: resolved.parentVersion,
        target_adapter_version: resolved.parentVersion,
        supporting_children: [...new Set([...reporting, sourceChild])].sort(),
        frequency_met: frequencyMet,
        detected_from: 'frontmatter-primitives-and-rule-statements'
      },
      requiredConfirmations: frequencyMet ? 3 : 1
    });
    keys.push(proposed.proposal.key);
  }
  return keys;
}

/** Child's declared value for the contested field, falling back to the observed literal. */
function childPrimitive(
  frontmatter: Record<string, unknown>,
  markdown: string,
  field: string,
  fallback: string
): string {
  const declared = frontmatter[field];
  if (typeof declared === 'string' || typeof declared === 'number' || typeof declared === 'boolean') {
    return String(declared);
  }
  const parsed = parsePrimitive(parseFrontmatter(markdown).fields[field] ?? '');
  return parsed === undefined ? fallback : String(parsed);
}
