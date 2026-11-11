/**
 * Derived graph facts for a successful adapter write (ADR 0045 / ADR 0046).
 *
 * Called after `train`/`tune` has persisted an adapter and projected its topology.
 * It records, in one place:
 *
 *   1. an immutable version snapshot of the durable stored state,
 *   2. an `Anomaly` node when the authored document declared `anomaly:` frontmatter,
 *   3. an evolution proposal for every **deterministic** child/parent contradiction.
 *
 * All three are bookkeeping over a write that already succeeded: a graph failure
 * never fails the write. Nothing here mutates the parent adapter — proposals are
 * records and the parent change happens through a later normal `tune`.
 *
 * SNAPSHOT VS SUBMISSION
 * `markdown` is the durable state, reconstructed from the stored records by
 * `adapter-stored-markdown.ts`. `submittedMarkdown` is the bytes the caller sent and
 * is recorded as provenance in `metadata_snapshot` only. The distinction matters:
 * `tune` preserves the stored `inference_contract` on purpose, so snapshotting the
 * submitted document would record a contract change that never became active, and a
 * later restore of that snapshot would activate behaviour the original write did not.
 *
 * DETECTION READS THE AUTHORED DOCUMENT
 * Contradictions and `anomaly:` declarations are the author's claims about a
 * document, not properties of the reconstructed bytes, so they are detected from the
 * submitted document.
 *
 * CONTRACT: nothing exported here throws.
 * Every leg reports its own failure through `AdapterEvolutionReport.degraded`, so a
 * partly-failing pass still records the legs that worked.
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
import { anomalyTargetMetadata, countScopedReportingChildren } from './evolution/scoped-frequency.js';
import type { SnapshotSource } from './adapter-stored-markdown.js';
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
  /** Why no snapshot was appended, or `null` when one was. */
  skipped: string | null;
  /**
   * True when the pass appended nothing because the durable bytes are already the head
   * snapshot. Distinct from `skipped`: nothing is missing, so it is not a degradation.
   */
  no_change: boolean;
  /** The classification the snapshot actually received. */
  change_type: 'created' | 'updated' | 'restored' | null;
  /** How the snapshotted document was obtained. */
  snapshot_source: SnapshotSource | null;
  /** Digest of the snapshotted bytes — what a restore would reproduce. */
  content_digest: string | null;
  /** Non-fatal failures inside the pass, reported instead of thrown. */
  degraded: string[];
}

export interface AdapterEvolutionParams {
  /** Store the graph is attached to (`getGraphDb` owner). */
  owner: object;
  /** Stored head layer of the adapter that was just written. */
  head: Memory;
  /** Durable stored-state document to snapshot. */
  markdown: string;
  /** Exact bytes the caller submitted; provenance only. */
  submittedMarkdown?: string | null;
  /** How `markdown` was obtained. `stored-state` unless a caller had to fall back. */
  snapshotSource?: SnapshotSource;
  /** Record-enumerating surface used to read the parent, when one exists. */
  source?: AdapterRecordSource | null;
  changeType: 'created' | 'updated' | 'restored';
  reason: string;
}

/**
 * A fresh report. Deliberately a factory: the two array fields are appended to during a
 * pass, so a shared literal would leak one write's degradations into the next write's
 * report — a spread copies the array reference, not the array.
 */
function emptyReport(): AdapterEvolutionReport {
  return {
    version: null,
    anomaly_key: null,
    proposal_keys: [],
    skipped: null,
    no_change: false,
    change_type: null,
    snapshot_source: null,
    content_digest: null,
    degraded: []
  };
}

/** Newest snapshots scanned to classify a write as a restore. */
const RESTORE_SCAN_WINDOW = 1000;

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

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

/** Result of looking for an earlier snapshot with identical durable bytes. */
interface RestoreLookup {
  /** Earlier snapshot number whose durable bytes match, or `null`. */
  versionNumber: string | null;
  /** True when the scan hit its window without examining the whole retained set. */
  windowBounded: boolean;
  window: number;
}

/**
 * Earlier snapshot whose durable bytes equal this write, if any.
 *
 * Only used to label a restore honestly; a digest match proves byte identity, not
 * that the caller intended a restore, so the label names the source snapshot.
 *
 * The scan is bounded, and a bounded scan is DISCLOSED rather than presented as
 * exhaustive. The history port pages newest-first only, so "older than the window"
 * is not reachable; when the window fills without a match the caller records that
 * the classification covered the newest `window` snapshots, which keeps an older
 * restore from being silently mislabelled `updated`.
 */
async function findRestoredFrom(
  graphDb: GraphRepository,
  key: string,
  headVersion: string,
  markdown: string
): Promise<RestoreLookup> {
  try {
    const digest = sha256Hex(markdown);
    const versions = await graphDb.listVersions(key, { limit: RESTORE_SCAN_WINDOW });
    const match = versions.find(
      (v) => v.version_number !== headVersion && v.content_digest === digest
    );
    return {
      versionNumber: match?.version_number ?? null,
      windowBounded: !match && versions.length >= RESTORE_SCAN_WINDOW,
      window: RESTORE_SCAN_WINDOW
    };
  } catch {
    return { versionNumber: null, windowBounded: false, window: RESTORE_SCAN_WINDOW };
  }
}

/**
 * Record the version snapshot and any derived evolution facts.
 *
 * Returns a report instead of throwing: the caller's write already succeeded, and a
 * missing graph is a documented degradation, not a failure.
 */
export async function recordAdapterEvolution(
  params: AdapterEvolutionParams
): Promise<AdapterEvolutionReport> {
  const report: AdapterEvolutionReport = emptyReport();
  try {
    return await recordAdapterEvolutionGuarded(params, report);
  } catch (err) {
    // Reached only if the guarded body regresses. The caller's write is already
    // durable, so the honest answer is a degraded report, never an exception.
    structuredLogger.warn(
      `evolution: pass failed unexpectedly for ${params.head.slug ?? '(no slug)'} — ${describe(err)}`
    );
    report.degraded.push(`evolution pass failed — ${describe(err)}`);
    report.skipped = describe(err);
    return report;
  }
}

async function recordAdapterEvolutionGuarded(
  params: AdapterEvolutionParams,
  report: AdapterEvolutionReport
): Promise<AdapterEvolutionReport> {
  const graphDb = getGraphDb(params.owner);
  if (!graphDb || !graphDb.isInitialized()) {
    return { ...report, skipped: 'no graph repository for this store' };
  }

  const scope = storedAdapterScope(params.head.space_id, `evolution:${params.changeType}`);
  const snapshot = snapshotFromStoredMemory(params.head, scope);
  if (!snapshot) {
    return { ...report, skipped: 'stored head has no adapter identity' };
  }

  const key = childKey(scope.spaceId, snapshot.slug);
  const authored = params.submittedMarkdown && params.submittedMarkdown.trim().length > 0
    ? params.submittedMarkdown
    : params.markdown;

  // First successful write of an adapter is `created`; every later one is `updated`
  // even when the caller (train) cannot tell the two apart before the write.
  let head: Awaited<ReturnType<GraphRepository['getLatestVersion']>> = null;
  let headReadFailed = false;
  try {
    head = await graphDb.getLatestVersion(key);
  } catch (err) {
    // A history-head read failure must not fail the write and must not be reported as
    // "no history" either: say the classification could not be established.
    headReadFailed = true;
    report.degraded.push(`history head unreadable for ${key} — ${describe(err)}`);
  }

  // Nothing durable changed, so there is nothing to version. This is what makes a second
  // derived pass over the same stored bytes idempotent — a post-move re-projection, or a
  // repeated `updates` that writes what is already stored — instead of inventing a
  // history row that records no change.
  const contentDigest = sha256Hex(params.markdown);
  if (head && head.content_digest === contentDigest) {
    report.no_change = true;
    report.skipped = `durable bytes already match snapshot ${head.version_number}`;
    return report;
  }

  let changeType: 'created' | 'updated' | 'restored' = head
    ? params.changeType === 'created'
      ? 'updated'
      : params.changeType
    : 'created';
  let reason = params.reason;
  if (head && changeType === 'updated') {
    // A restore is an ordinary `train`/`tune` whose durable bytes equal an *earlier*
    // snapshot. The digest proves those bytes; the restored-from number names the source.
    const restore = await findRestoredFrom(graphDb, key, head.version_number, params.markdown);
    if (restore.versionNumber) {
      changeType = 'restored';
      reason = `${reason}; restored from snapshot ${restore.versionNumber}`;
    } else if (restore.windowBounded) {
      reason = `${reason}; restore classification covered the newest ${restore.window} snapshots, so an identical snapshot older than that would be labelled updated`;
    }
  }

  let version: Awaited<ReturnType<typeof recordAdapterVersion>> = null;
  try {
    version = await recordAdapterVersion(graphDb, {
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
        scope_source: scope.source,
        // The two histories are recorded together but never conflated: `content` is
        // the durable state, these fields are what the caller asked for.
        snapshot_source: params.snapshotSource ?? 'submitted',
        submitted_digest:
          params.submittedMarkdown && params.submittedMarkdown.length > 0
            ? sha256Hex(params.submittedMarkdown)
            : null,
        content_digest: contentDigest,
        ...(headReadFailed && { head_read_failed: true })
      },
      // The head observed at the start of this pass is the durable CAS token: a
      // concurrent append that lands between this read and this write conflicts here
      // instead of silently adding a snapshot the caller never saw.
      expectedParentVersion: head ? head.version_number : null,
      ...(head?.adapter_version ? { expectedAdapterVersion: head.adapter_version } : {})
    });
  } catch (err) {
    // `recordAdapterVersion` swallows its own append errors, so reaching here means
    // something outside that contract failed (a conflict surfaces as a `null` append,
    // not a throw). Report it and keep going with the remaining legs.
    report.degraded.push(`history append failed for ${key} — ${describe(err)}`);
  }
  report.version = version?.version_number ?? null;
  report.change_type = version ? changeType : null;
  report.snapshot_source = version ? (params.snapshotSource ?? 'submitted') : null;
  report.content_digest = version ? contentDigest : null;
  if (!version) report.skipped = 'history append did not produce a snapshot';

  const parsed = parseFrontmatter(authored);
  if (parsed.anomaly) {
    report.anomaly_key = await recordDeclaredAnomaly(
      graphDb,
      parsed.anomaly,
      snapshot.slug,
      scope.spaceId,
      key
    );
  }

  report.proposal_keys = await recordProposals(graphDb, params, snapshot, key, scope.spaceId, authored, report);
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
    const routesTo = parsedAnomaly['routes_to']?.trim() || slug;
    const node = anomalyNode(parsedAnomaly, slug, routesTo, spaceId);
    node.source_child = sourceChild;
    // Target identity is recorded only where it is unambiguous. A self-routing anomaly
    // targets this adapter in this scope. A parent-routed one may target an app-space
    // parent, and guessing "this scope" here would make the row unmatchable by a
    // frequency count that resolves the parent's real scope — so that case records no
    // target and relies on the shared helper's documented legacy rule.
    if (routesTo === slug) {
      Object.assign(node.metadata ?? {}, anomalyTargetMetadata({ targetKey: sourceChild, spaceId }));
    }
    await graphDb.createAnomaly(node);
    return node.key;
  } catch (err) {
    structuredLogger.warn(
      `evolution: declared anomaly write failed for ${slug} — ${describe(err)}`
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
  /** Fields whose frequency read filled its window, so the count is a floor. */
  frequencyTruncated: Set<string>;
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
  scopeSpaceId: string,
  authored: string
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
  const contradictions = detectContradictions(factsFromMarkdown(authored), {
    fields: parentFields,
    body: parentHead?.text ?? ''
  });
  if (contradictions.length === 0) return null;

  const parentKey = adapterGraphKey(resolved.spaceId, resolved.snapshot.slug);
  const frequency = new Map<string, string[]>();
  const frequencyTruncated = new Set<string>();
  for (const contradiction of contradictions) {
    const counted = await distinctReportingChildren(
      graphDb,
      parentKey,
      resolved.snapshot.slug,
      resolved.spaceId,
      contradiction.field
    );
    frequency.set(contradiction.field, counted.children);
    if (counted.truncated) frequencyTruncated.add(contradiction.field);
  }

  return {
    parentKey,
    parentSpaceId: resolved.spaceId,
    parentVersion: resolved.snapshot.version,
    contradictions,
    frequency,
    frequencyTruncated
  };
}

/**
 * Distinct children already reporting this exact scoped claim against the parent.
 *
 * Delegated to `evolution/scoped-frequency.ts` so this producer and the reward
 * producer count the same set. The previous routing-slug query let another space, or
 * an unrelated contested field on the same slug, move `frequency_met`.
 */
async function distinctReportingChildren(
  graphDb: GraphRepository,
  parentKey: string,
  parentSlug: string,
  spaceId: string,
  field: string
): Promise<{ children: string[]; truncated: boolean }> {
  const counted = await countScopedReportingChildren(graphDb, {
    targetKey: parentKey,
    spaceId,
    slug: parentSlug,
    field
  });
  return { children: counted.children, truncated: counted.truncated };
}

async function recordProposals(
  graphDb: GraphRepository,
  params: AdapterEvolutionParams,
  snapshot: ReturnType<typeof snapshotFromStoredMemory>,
  sourceChild: string,
  scopeSpaceId: string,
  authored: string,
  report: AdapterEvolutionReport
): Promise<string[]> {
  if (!snapshot) return [];
  try {
    const resolved = await resolveContradictions(params, graphDb, scopeSpaceId, authored);
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
        toValue: childPrimitive(
          snapshot.frontmatter,
          authored,
          contradiction.field,
          contradiction.child_value
        ),
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
          // A filled window makes the count a floor, so the threshold it supported is
          // recorded as provisional rather than presented as a population.
          frequency_truncated: resolved.frequencyTruncated.has(contradiction.field),
          detected_from: 'frontmatter-primitives-and-rule-statements'
        },
        requiredConfirmations: frequencyMet ? 3 : 1
      });
      keys.push(proposed.proposal.key);
    }
    return keys;
  } catch (err) {
    structuredLogger.warn(
      `evolution: proposal pass failed for ${sourceChild} — ${describe(err)}`
    );
    report.degraded.push(`proposal pass failed — ${describe(err)}`);
    return [];
  }
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
