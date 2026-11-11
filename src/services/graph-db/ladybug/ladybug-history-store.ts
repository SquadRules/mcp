/**
 * LadybugDB graph-native history: immutable, append-only version snapshots.
 *
 * Each snapshot stores the full stored document plus its digest, actor, space,
 * parent sequence and reason. The digest proves the bytes; it does not prove the
 * claim inside them (see docs/adr/0045-graph-native-history-and-restore.md).
 *
 * Ordering uses `version_seq`, a monotonic INT64 per entity. `version_number` is
 * the same value rendered as text so both backends expose an identical reader
 * shape. A concurrent writer that loses the optimistic check raises
 * `GraphVersionConflictError` instead of overwriting history.
 */
import type { Connection } from '@ladybugdb/core';
import type {
  HistoryFilter,
  VersionAppendInput,
  VersionNode
} from '../graph-types.js';
import { GraphVersionConflictError } from '../graph-types.js';
import { sha256Hex } from '../../../utils/sha256.js';
import { executeStatement, parseJson, readRows, type QueryParams } from './ladybug-exec.js';

const VERSION_COLUMNS = `v.key as key, v.type as type, v.entity_key as entity_key,
  v.entity_uri as entity_uri, v.version_number as version_number,
  v.adapter_version as adapter_version, v.change_type as change_type,
  v.changed_at as changed_at, v.changed_by as changed_by,
  v.actor_source as actor_source, v.space as space,
  v.parent_version as parent_version, v.reason as reason,
  v.content_digest as content_digest, v.content as content,
  v.metadata_snapshot as metadata_snapshot, v.metadata as metadata`;

/** Map a flat `Version` row to the backend-neutral node. */
export function toVersionNode(row: Record<string, unknown>): VersionNode {
  return {
    key: String(row['key'] ?? ''),
    type: 'version',
    entity_key: String(row['entity_key'] ?? ''),
    entity_uri: String(row['entity_uri'] ?? ''),
    version_number: String(row['version_number'] ?? ''),
    adapter_version: String(row['adapter_version'] ?? ''),
    change_type: String(row['change_type'] ?? 'updated') as VersionNode['change_type'],
    changed_at: String(row['changed_at'] ?? ''),
    changed_by: String(row['changed_by'] ?? ''),
    actor_source: String(row['actor_source'] ?? ''),
    space: String(row['space'] ?? ''),
    parent_version:
      row['parent_version'] === null || row['parent_version'] === undefined
        ? null
        : String(row['parent_version']),
    reason: String(row['reason'] ?? ''),
    content_digest: String(row['content_digest'] ?? ''),
    content: String(row['content'] ?? ''),
    metadata_snapshot: parseJson<Record<string, unknown>>(row['metadata_snapshot'], {}),
    metadata: parseJson<Record<string, unknown>>(row['metadata'], {})
  };
}

/** Newest snapshot for an entity, or `null` when no history exists yet. */
export async function getLatestVersion(
  connection: Connection,
  entityKey: string
): Promise<VersionNode | null> {
  const rows = await readRows<Record<string, unknown>>(
    connection,
    `MATCH (v:Version {entity_key: $entityKey})
     RETURN ${VERSION_COLUMNS}
     ORDER BY v.version_seq DESC LIMIT 1`,
    { entityKey }
  );
  return rows[0] ? toVersionNode(rows[0]) : null;
}

/** One snapshot by entity and monotonic version number. */
export async function getVersion(
  connection: Connection,
  entityKey: string,
  versionNumber: string
): Promise<VersionNode | null> {
  const rows = await readRows<Record<string, unknown>>(
    connection,
    `MATCH (v:Version {key: $versionKey})
     RETURN ${VERSION_COLUMNS} LIMIT 1`,
    { versionKey: `version:${entityKey}@${versionNumber}` }
  );
  return rows[0] ? toVersionNode(rows[0]) : null;
}

/** History for an entity, newest first. */
export async function listVersions(
  connection: Connection,
  entityKey: string,
  filter: HistoryFilter = {}
): Promise<VersionNode[]> {
  const rows = await readRows<Record<string, unknown>>(
    connection,
    `MATCH (v:Version {entity_key: $entityKey})
     WHERE $afterVersion = '' OR v.version_seq > $afterSeq
     RETURN ${VERSION_COLUMNS}
     ORDER BY v.version_seq DESC
     LIMIT $limit`,
    {
      entityKey,
      afterVersion: filter.afterVersion ?? '',
      afterSeq: filter.afterVersion ? Number(filter.afterVersion) : 0,
      limit: filter.limit && filter.limit > 0 ? filter.limit : 100
    }
  );
  return rows.map(toVersionNode);
}

function assertHeadMatches(
  latest: VersionNode | null,
  input: VersionAppendInput,
  entityKey: string
): void {
  if (input.expectedParentVersion !== undefined) {
    const actual = latest ? latest.version_number : null;
    const expected = input.expectedParentVersion;
    if (actual !== expected) {
      throw new GraphVersionConflictError(
        `appendVersion: ${entityKey} head is ${actual ?? 'none'}, expected ${expected ?? 'none'}`,
        { entity_key: entityKey, expected, actual }
      );
    }
  }
  if (input.expectedAdapterVersion !== undefined) {
    const actual = latest ? latest.adapter_version : null;
    if (actual !== input.expectedAdapterVersion) {
      throw new GraphVersionConflictError(
        `appendVersion: ${entityKey} adapter version is ${actual ?? 'none'}, expected ${input.expectedAdapterVersion}`,
        { entity_key: entityKey, expected: input.expectedAdapterVersion, actual }
      );
    }
  }
}

/**
 * Property list of one `Version` row, shared by both create shapes below.
 *
 * Shared on purpose: the snapshot-with-edge statement and the snapshot-alone statement
 * must write byte-identical rows, or the two paths would produce different history
 * depending on whether a projection node happened to exist.
 */
const VERSION_CREATE_PROPS = `key: $key, type: 'version', entity_key: $entityKey,
  entity_uri: $entityUri, version_number: $versionNumber, version_seq: $versionSeq,
  adapter_version: $adapterVersion, change_type: $changeType,
  changed_at: $changedAt, changed_by: $changedBy, actor_source: $actorSource,
  space: $space, parent_version: $parentVersion, reason: $reason,
  content_digest: $contentDigest, content: $content,
  metadata_snapshot: $metadataSnapshot, metadata: $metadata`;

const ADAPTER_NODE_EXISTS = 'MATCH (a:Adapter {key: $adapterKey}) RETURN a.key as key';
const VERSION_NODE_EXISTS = 'MATCH (v:Version {key: $versionKey}) RETURN v.key as key';

/**
 * Create the snapshot and, when the adapter is projected, its `VersionOf` edge.
 *
 * WHY ONE STATEMENT
 * The snapshot row and the edge that makes it reachable from its adapter used to be two
 * statements. A failure between them left a version that `getLatestVersion` returns but
 * that no traversal reaches — a half-append that looked like history and behaved like a
 * hole. Creating the row and the edge in one statement means either both exist or
 * neither does; there is no window in which a reader can observe the half-state.
 *
 * The adapter node is a *projection* node while history is the durable record, so a
 * snapshot must be appendable without one. That is a complete state, not a partial one,
 * which is why the edge is only part of the statement when the adapter node is present.
 *
 * The combined statement re-matches the adapter node, so an adapter that disappears
 * between the probe and the write makes it create nothing; the version is then appended
 * alone rather than lost. Returns whether the edge was written.
 */
async function createVersion(
  connection: Connection,
  params: QueryParams,
  adapterKey: string,
  versionKey: string,
  changedAt: string
): Promise<boolean> {
  if ((await readRows(connection, ADAPTER_NODE_EXISTS, { adapterKey })).length > 0) {
    await executeStatement(
      connection,
      `MATCH (a:Adapter {key: $adapterKey})
       CREATE (v:Version {${VERSION_CREATE_PROPS}})-[:VersionOf {relationship: 'version_of', changed_at: $changedAt, metadata: $linkMetadata}]->(a)`,
      { ...params, adapterKey, changedAt }
    );
    if ((await readRows(connection, VERSION_NODE_EXISTS, { versionKey })).length > 0) return true;
  }
  await executeStatement(connection, `CREATE (v:Version {${VERSION_CREATE_PROPS}})`, params);
  return false;
}

/**
 * Append one immutable snapshot.
 *
 * Fails closed when an optimistic expectation is supplied and does not match the
 * current head. Never updates an existing `(entity_key, version_number)` node:
 * the key embeds the next sequence, so a replayed write either conflicts on the
 * expectation or creates the next distinct snapshot.
 */
export async function appendVersion(
  connection: Connection,
  input: VersionAppendInput
): Promise<VersionNode> {
  if (!input.space || input.space.trim().length === 0) {
    throw new Error('appendVersion: space is required — history never guesses a scope');
  }
  if (!input.actor?.actor) {
    throw new Error('appendVersion: actor is required — history never invents an identity');
  }

  const latest = await getLatestVersion(connection, input.adapterKey);
  assertHeadMatches(latest, input, input.adapterKey);

  const nextSeq = latest ? String(Number(latest.version_number) + 1) : '1';
  const versionKey = `version:${input.adapterKey}@${nextSeq}`;
  const changedAt = new Date().toISOString();
  const contentDigest = sha256Hex(input.content);

  const versionParams: QueryParams = {
    key: versionKey,
    entityKey: input.adapterKey,
    entityUri: `adapter://${input.slug}`,
    versionNumber: nextSeq,
    versionSeq: Number(nextSeq),
    adapterVersion: input.adapterVersion,
    changeType: input.changeType,
    changedAt,
    changedBy: input.actor.actor,
    actorSource: input.actor.actor_source,
    space: input.space,
    parentVersion: latest ? latest.version_number : null,
    reason: input.reason,
    contentDigest,
    content: input.content,
    metadataSnapshot: JSON.stringify(input.metadataSnapshot ?? {}),
    metadata: JSON.stringify({ slug: input.slug }),
    linkMetadata: JSON.stringify({
      actor: input.actor.actor,
      actor_source: input.actor.actor_source
    })
  };

  // Row and edge in one statement: see `createVersion` for why the half-state this
  // replaces was observable and why a snapshot without an adapter node is still whole.
  await createVersion(connection, versionParams, input.adapterKey, versionKey, changedAt);

  return {
    key: versionKey,
    type: 'version',
    entity_key: input.adapterKey,
    entity_uri: `adapter://${input.slug}`,
    version_number: nextSeq,
    adapter_version: input.adapterVersion,
    change_type: input.changeType,
    changed_at: changedAt,
    changed_by: input.actor.actor,
    actor_source: input.actor.actor_source,
    space: input.space,
    parent_version: latest ? latest.version_number : null,
    reason: input.reason,
    content_digest: contentDigest,
    content: input.content,
    metadata_snapshot: input.metadataSnapshot ?? {},
    metadata: { slug: input.slug }
  };
}
