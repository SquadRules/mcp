/**
 * Graph-native history service used by the train / tune / export tools.
 *
 * Recording is a derived side effect: a graph failure never fails a successful
 * memory write, but the snapshot itself is immutable and complete. Storing the
 * full document (not only a digest) is what makes restore possible through the
 * normal `train`/`tune` validators (ADR 0045).
 */
import type { GraphRepository } from './graph-repository.js';
import type {
  GraphActor,
  HistoryFilter,
  VersionAppendInput,
  VersionNode
} from './graph-types.js';
import { resolveGraphActor } from './graph-actor.js';
import { sha256Hex } from '../../utils/sha256.js';
import { structuredLogger } from '../../utils/structured-logger.js';

export interface RecordVersionParams {
  adapterKey: string;
  slug: string;
  adapterVersion: string;
  space: string;
  changeType: VersionNode['change_type'];
  reason: string;
  content: string;
  metadataSnapshot: Record<string, unknown>;
  /** When supplied, the write fails closed unless the head matches. */
  expectedParentVersion?: string | null;
  expectedAdapterVersion?: string;
  /** Override the resolved actor (tests and replay tooling only). */
  actor?: GraphActor;
}

/** Raised when a stored snapshot's content no longer matches its digest. */
export class HistoryDigestMismatchError extends Error {
  constructor(
    public readonly versionKey: string,
    public readonly expected: string,
    public readonly actual: string
  ) {
    super(
      `history: snapshot ${versionKey} content digest ${actual} does not match recorded ${expected} — refusing to restore unverified bytes`
    );
    this.name = 'HistoryDigestMismatchError';
  }
}

/**
 * Append one immutable snapshot.
 *
 * Returns `null` when no graph is available (graceful degradation) or when the
 * append fails, because history bookkeeping must not break a stored adapter.
 */
export async function recordAdapterVersion(
  graphDb: GraphRepository | null | undefined,
  params: RecordVersionParams
): Promise<VersionNode | null> {
  if (!graphDb || !graphDb.isInitialized()) return null;

  const input: VersionAppendInput = {
    adapterKey: params.adapterKey,
    slug: params.slug,
    adapterVersion: params.adapterVersion,
    space: params.space,
    changeType: params.changeType,
    reason: params.reason,
    content: params.content,
    metadataSnapshot: params.metadataSnapshot,
    actor: params.actor ?? resolveGraphActor(),
    ...(params.expectedParentVersion !== undefined && {
      expectedParentVersion: params.expectedParentVersion
    }),
    ...(params.expectedAdapterVersion !== undefined && {
      expectedAdapterVersion: params.expectedAdapterVersion
    })
  };

  try {
    return await graphDb.appendVersion(input);
  } catch (err) {
    structuredLogger.warn(
      `graph history: append failed for ${params.adapterKey} — ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

/** Read one entity's history, newest first. Throws when the graph is unavailable. */
export async function readAdapterHistory(
  graphDb: GraphRepository | null | undefined,
  adapterKey: string,
  filter?: HistoryFilter
): Promise<VersionNode[]> {
  if (!graphDb || !graphDb.isInitialized()) {
    throw new Error('graph history: no graph repository is available for this store');
  }
  return graphDb.listVersions(adapterKey, filter);
}

/** Read one snapshot. Throws when the graph is unavailable. */
export async function readAdapterVersion(
  graphDb: GraphRepository | null | undefined,
  adapterKey: string,
  versionNumber: string
): Promise<VersionNode | null> {
  if (!graphDb || !graphDb.isInitialized()) {
    throw new Error('graph history: no graph repository is available for this store');
  }
  return graphDb.getVersion(adapterKey, versionNumber);
}

/**
 * Read a snapshot and verify that its bytes still hash to the recorded digest.
 *
 * The digest proves the bytes, not the truth of what they claim: a matching hash
 * means "this is exactly what was stored", never "this is correct".
 */
export async function readVerifiedVersion(
  graphDb: GraphRepository | null | undefined,
  adapterKey: string,
  versionNumber: string
): Promise<VersionNode> {
  const snapshot = await readAdapterVersion(graphDb, adapterKey, versionNumber);
  if (!snapshot) {
    throw new Error(`graph history: ${adapterKey} has no version ${versionNumber}`);
  }
  const actual = sha256Hex(snapshot.content);
  if (actual !== snapshot.content_digest) {
    throw new HistoryDigestMismatchError(snapshot.key, snapshot.content_digest, actual);
  }
  return snapshot;
}

/** Compact history row for tool output (no full document). */
export interface HistoryEntry {
  version: string;
  adapter_version: string;
  change_type: VersionNode['change_type'];
  changed_at: string;
  changed_by: string;
  actor_source: string;
  parent_version: string | null;
  reason: string;
  content_digest: string;
  content_bytes: number;
}

/** Map a snapshot to the compact row tools return. */
export function historyEntry(snapshot: VersionNode): HistoryEntry {
  return {
    version: snapshot.version_number,
    adapter_version: snapshot.adapter_version,
    change_type: snapshot.change_type,
    changed_at: snapshot.changed_at,
    changed_by: snapshot.changed_by,
    actor_source: snapshot.actor_source,
    parent_version: snapshot.parent_version,
    reason: snapshot.reason,
    content_digest: snapshot.content_digest,
    content_bytes: Buffer.byteLength(snapshot.content, 'utf8')
  };
}
