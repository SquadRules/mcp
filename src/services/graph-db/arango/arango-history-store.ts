/**
 * ArangoDB graph-native history.
 *
 * Writes are append-only by construction: the document `_key` embeds the monotonic
 * sequence (`version:<entity>@<n>`), so a replayed or racing write hits ArangoDB's
 * unique-key constraint instead of overwriting a snapshot. The optimistic check is
 * still evaluated first so the caller receives the actionable
 * `GraphVersionConflictError` with the head it lost to.
 */
import { ArangoHttpError, type ArangoHttpClient } from './arango-http.js';
import {
  GraphVersionConflictError,
  type GraphActor,
  type HistoryFilter,
  type VersionAppendInput,
  type VersionNode
} from '../graph-types.js';
import { sha256Hex } from '../../../utils/sha256.js';
import { versionFromDoc, type ArangoDoc } from './arango-rows.js';

const DUPLICATE_KEY_ERROR_NUM = 1210;

interface HeadRow {
  entity_key?: string;
  version_number?: string;
  version_seq?: number;
  adapter_version?: string;
}

const HEAD_AQL = `FOR v IN Version
       FILTER v.entity_key == @entityKey
       SORT v.version_seq DESC
       LIMIT 1
       RETURN { entity_key: v.entity_key, version_number: v.version_number, version_seq: v.version_seq, adapter_version: v.adapter_version }`;

async function readHead(
  client: ArangoHttpClient,
  entityKey: string,
  transactionId?: string
): Promise<HeadRow | null> {
  const rows = transactionId
    ? await client.queryInTransaction<HeadRow>(transactionId, HEAD_AQL, { entityKey })
    : await client.query<HeadRow>(HEAD_AQL, { entityKey });
  return rows[0] ?? null;
}

/** Newest snapshot for an entity, or `null` when no history exists yet. */
export async function getLatestVersion(
  client: ArangoHttpClient,
  entityKey: string
): Promise<VersionNode | null> {
  const rows = await client.query<ArangoDoc>(
    `FOR v IN Version FILTER v.entity_key == @entityKey
       SORT v.version_seq DESC LIMIT 1 RETURN v`,
    { entityKey }
  );
  return rows[0] ? versionFromDoc(rows[0]) : null;
}

/** One snapshot by entity and monotonic version number. */
export async function getVersion(
  client: ArangoHttpClient,
  entityKey: string,
  versionNumber: string
): Promise<VersionNode | null> {
  const rows = await client.query<ArangoDoc>(
    'FOR v IN Version FILTER v._key == @versionKey LIMIT 1 RETURN v',
    { versionKey: `version:${entityKey}@${versionNumber}` }
  );
  return rows[0] ? versionFromDoc(rows[0]) : null;
}

/** History for an entity, newest first. */
export async function listVersions(
  client: ArangoHttpClient,
  entityKey: string,
  filter: HistoryFilter = {}
): Promise<VersionNode[]> {
  const rows = await client.query<ArangoDoc>(
    `FOR v IN Version
       FILTER v.entity_key == @entityKey
       FILTER v.version_seq > @afterSeq
       SORT v.version_seq DESC
       LIMIT @limit
       RETURN v`,
    {
      entityKey,
      afterSeq: filter.afterVersion ? Number(filter.afterVersion) : 0,
      limit: filter.limit && filter.limit > 0 ? filter.limit : 100
    }
  );
  return rows.map(versionFromDoc);
}

function assertHeadMatches(head: HeadRow | null, input: VersionAppendInput): void {
  if (input.expectedParentVersion !== undefined) {
    const actual = head ? String(head.version_number ?? '') : null;
    if (actual !== input.expectedParentVersion) {
      throw new GraphVersionConflictError(
        `appendVersion: ${input.adapterKey} head is ${actual ?? 'none'}, expected ${input.expectedParentVersion ?? 'none'}`,
        { entity_key: input.adapterKey, expected: input.expectedParentVersion, actual }
      );
    }
  }
  if (input.expectedAdapterVersion !== undefined) {
    const actual = head ? String(head.adapter_version ?? '') : null;
    if (actual !== input.expectedAdapterVersion) {
      throw new GraphVersionConflictError(
        `appendVersion: ${input.adapterKey} adapter version is ${actual ?? 'none'}, expected ${input.expectedAdapterVersion}`,
        { entity_key: input.adapterKey, expected: input.expectedAdapterVersion, actual }
      );
    }
  }
}

const LINK_VERSION_OF_AQL = `FOR a IN Adapter
       FILTER a._key == @adapterKey
       LIMIT 1
       INSERT { _from: CONCAT('Version/', @versionKey), _to: CONCAT('Adapter/', @adapterKey),
                relationship: 'version_of', changed_at: @changedAt, metadata: @metadata }
       INTO VersionOf`;

async function linkVersionOf(
  client: ArangoHttpClient,
  versionKey: string,
  adapterKey: string,
  actor: GraphActor,
  changedAt: string,
  transactionId: string
): Promise<void> {
  const bindVars = {
    versionKey,
    adapterKey,
    changedAt,
    metadata: { actor: actor.actor, actor_source: actor.actor_source }
  };
  await client.queryInTransaction(transactionId, LINK_VERSION_OF_AQL, bindVars);
}

/**
 * Append one immutable snapshot.
 *
 * Fails closed when an optimistic expectation is supplied and does not match the
 * current head, and also when the unique `_key` already exists.
 */
export async function appendVersion(
  client: ArangoHttpClient,
  input: VersionAppendInput
): Promise<VersionNode> {
  if (!input.space || input.space.trim().length === 0) {
    throw new Error('appendVersion: space is required — history never guesses a scope');
  }
  if (!input.actor?.actor) {
    throw new Error('appendVersion: actor is required — history never invents an identity');
  }

  // One stream transaction: the snapshot insert and its `VersionOf` edge are one
  // unit, so a failed edge write cannot leave a snapshot the graph cannot reach.
  return client.withTransaction(
    { write: ['Version', 'VersionOf'], read: ['Adapter'] },
    async (transactionId) => {
      const head = await readHead(client, input.adapterKey, transactionId);
      assertHeadMatches(head, input);

      const nextSeq = head ? Number(head.version_seq ?? 0) + 1 : 1;
      const versionKey = `version:${input.adapterKey}@${nextSeq}`;
      const changedAt = new Date().toISOString();
      const contentDigest = sha256Hex(input.content);

      const doc: ArangoDoc = {
        _key: versionKey,
        type: 'version',
        entity_key: input.adapterKey,
        entity_uri: `adapter://${input.slug}`,
        version_number: String(nextSeq),
        version_seq: nextSeq,
        adapter_version: input.adapterVersion,
        change_type: input.changeType,
        changed_at: changedAt,
        changed_by: input.actor.actor,
        actor_source: input.actor.actor_source,
        space: input.space,
        parent_version: head ? String(head.version_number ?? '') : null,
        reason: input.reason,
        content_digest: contentDigest,
        content: input.content,
        metadata_snapshot: input.metadataSnapshot ?? {},
        metadata: { slug: input.slug }
      };

      try {
        await client.queryInTransaction(transactionId, 'INSERT @doc INTO Version', { doc });
      } catch (err) {
        if (err instanceof ArangoHttpError && err.errorNum === DUPLICATE_KEY_ERROR_NUM) {
          throw new GraphVersionConflictError(
            `appendVersion: ${input.adapterKey} already has snapshot ${nextSeq}`,
            {
              entity_key: input.adapterKey,
              expected: head ? String(head.version_number ?? '') : null,
              actual: String(nextSeq)
            }
          );
        }
        throw err;
      }

      await linkVersionOf(client, versionKey, input.adapterKey, input.actor, changedAt, transactionId);

      return {
        key: versionKey,
        type: 'version',
        entity_key: input.adapterKey,
        entity_uri: `adapter://${input.slug}`,
        version_number: String(nextSeq),
        adapter_version: input.adapterVersion,
        change_type: input.changeType,
        changed_at: changedAt,
        changed_by: input.actor.actor,
        actor_source: input.actor.actor_source,
        space: input.space,
        parent_version: head ? String(head.version_number ?? '') : null,
        reason: input.reason,
        content_digest: contentDigest,
        content: input.content,
        metadata_snapshot: input.metadataSnapshot ?? {},
        metadata: { slug: input.slug }
      } satisfies VersionNode;
    }
  );
}
