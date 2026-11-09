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
  GraphActor,
  HistoryFilter,
  VersionAppendInput,
  VersionNode
} from '../graph-types.js';
import { GraphVersionConflictError } from '../graph-types.js';
import { sha256Hex } from '../../../utils/sha256.js';
import { executeStatement, parseJson, readRows } from './ladybug-exec.js';

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

/** Link the snapshot to its entity when that node exists; best-effort. */
async function linkVersionOf(
  connection: Connection,
  versionKey: string,
  adapterKey: string,
  actor: GraphActor,
  changedAt: string
): Promise<void> {
  const adapterRows = await readRows(
    connection,
    'MATCH (a:Adapter {key: $adapterKey}) RETURN a.key as key',
    { adapterKey }
  );
  if (adapterRows.length === 0) return;
  await executeStatement(
    connection,
    `MATCH (v:Version {key: $versionKey}), (a:Adapter {key: $adapterKey})
     CREATE (v)-[:VersionOf {relationship: 'version_of', changed_at: $changedAt, metadata: $metadata}]->(a)`,
    {
      versionKey,
      adapterKey,
      changedAt,
      metadata: JSON.stringify({ actor: actor.actor, actor_source: actor.actor_source })
    }
  );
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

  await executeStatement(
    connection,
    `CREATE (v:Version {
       key: $key, type: 'version', entity_key: $entityKey,
       entity_uri: $entityUri, version_number: $versionNumber, version_seq: $versionSeq,
       adapter_version: $adapterVersion, change_type: $changeType,
       changed_at: $changedAt, changed_by: $changedBy, actor_source: $actorSource,
       space: $space, parent_version: $parentVersion, reason: $reason,
       content_digest: $contentDigest, content: $content,
       metadata_snapshot: $metadataSnapshot, metadata: $metadata
     })`,
    {
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
      metadata: JSON.stringify({ slug: input.slug })
    }
  );

  await linkVersionOf(connection, versionKey, input.adapterKey, input.actor, changedAt);

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
