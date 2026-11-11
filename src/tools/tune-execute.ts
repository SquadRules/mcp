/**
 * `tune` dispatcher.
 *
 * Three request shapes reach this entry point and each has its own write path:
 *
 *   1. `content` for an adapter URI → `tuneAdapterMarkdownInPlace` (own module: the
 *      gate-heavy path).
 *   2. `content`/`updates` for a layer URI → `executeUpdate`, unchanged.
 *   3. `space` only → reassign the adapter's layers, no content write.
 *
 * Keeping the dispatcher thin is deliberate: it is the file that decides *which*
 * path runs, and a reader must be able to see that decision without scrolling past
 * the markdown rewrite's validators.
 */
import type { QdrantService } from '../services/qdrant/service.js';
import { getSpaceContextFromStorage } from '../utils/tenant-context.js';
import { resolveSpaceParamForContext } from '../utils/resolve-space-param.js';
import { executeUpdate } from './update.js';
import { type TuneInput, type TuneOutput } from './tune_schema.js';
import { parseSquadrulesUri, buildLayerUri } from './squadrules-uri.js';
import { buildTuneResultMessage } from './tune-messages.js';
import { assertReviewEvidencePassed } from './review-evidence-check.js';
import type { MemoryQdrantStore } from '../services/memory/store.js';
import { tuneAdapterMarkdownInPlace } from './tune-adapter-markdown.js';
import { versionGuardPayload } from './version-cas.js';
import { InheritanceValidationUnavailableError } from '../services/graph-db/inheritance-write-validation.js';
import {
  assertTuneExpectedVersionForTarget,
  collectLayerMemoryUuidsForTune,
  normalizeTuneUri,
  readAdapterRecordsByUuid,
  reassignAdapterLayersToSpace
} from './tune-uri-resolution.js';
import {
  finalizeAdapterMutation,
  type AdapterMutationReport
} from '../services/graph-db/adapter-write-finalize.js';
import { adapterIdentityLockKey, withAdapterWriteLock } from '../services/graph-db/adapter-write-lock.js';

/**
 * A failed row, keeping a failed version guard machine-readable.
 *
 * The prose `message` stays as it was (callers match on `VERSION_CONFLICT`), but the code
 * and the compared versions travel as fields so a transport never has to parse them back
 * out of a sentence.
 */
function failureRow(
  uri: string,
  error: unknown,
  prefix: string
): TuneOutput['results'][number] {
  const detail = error instanceof Error ? error.message : String(error);
  const row: TuneOutput['results'][number] = { uri, status: 'error', message: `${prefix}${detail}` };
  const guard = versionGuardPayload(error);
  if (guard) row.error = guard;
  else if (error instanceof InheritanceValidationUnavailableError) {
    row.error = { code: error.code, status: error.status, details: error.details };
  }
  return row;
}

/**
 * Row suffix describing a derived pass that did not complete.
 *
 * Appended, never raised: the content write already succeeded, and a caller that saw an
 * error here would retry a write that is already durable. Empty on the normal path, so
 * the successful message stays byte-identical for callers that match on it.
 */
function graphNote(graph: AdapterMutationReport | null): string {
  if (!graph || !graph.graph_degraded) return '';
  const reasons = graph.degradations.length > 0 ? graph.degradations.join('; ') : 'derived pass incomplete';
  return ` (graph bookkeeping incomplete: ${reasons})`;
}

export async function executeTune(
  qdrantService: QdrantService,
  input: TuneInput,
  memoryStore?: MemoryQdrantStore
): Promise<TuneOutput> {
  const ctx = getSpaceContextFromStorage();
  const rawSpace = typeof input.space === 'string' ? input.space.trim() : '';
  let targetSpaceId: string | undefined;
  if (rawSpace.length > 0) {
    const r = resolveSpaceParamForContext(ctx, rawSpace);
    if (!r.ok) {
      throw new Error(r.message);
    }
    targetSpaceId = r.spaceId;
    if (!ctx.allowedSpaceIds.includes(targetSpaceId)) {
      throw new Error('Target space is not in your allowed spaces');
    }
  }

  const hasContent = Array.isArray(input.content) && input.content.some((s) => typeof s === 'string' && s.trim().length > 0);
  const hasUpdates = input.updates && Object.keys(input.updates).length > 0;
  const hasPayload = Boolean(hasContent || hasUpdates);
  if (!hasPayload && !targetSpaceId) {
    throw new Error('Provide content, updates, or space');
  }
  // Validate review_evidence for content updates
  if (hasContent) assertReviewEvidencePassed(input.review_evidence);

  if (!hasPayload && targetSpaceId) {
    const results: TuneOutput['results'] = [];
    let total_updated = 0;
    let total_failed = 0;
    for (const originalUri of input.uris) {
      try {
        // A move-only tune still writes stored layers, so a requested guard is checked here.
        await assertTuneExpectedVersionForTarget(qdrantService, originalUri, input.expected_version);
        const layerUuids = await collectLayerMemoryUuidsForTune(qdrantService, originalUri);
        const head = layerUuids[0];
        if (!head) throw new Error(`Adapter not found: ${originalUri}`);

        // The pre-move read names the adapter the write serializes on and the scope the
        // graph must stop claiming. A move changes `space_id`, which is half of the key
        // the projection and the history are stamped with, so it is a topology change,
        // not a metadata edit — the derived pass has to run afterwards.
        const before = await readAdapterRecordsByUuid(qdrantService, layerUuids);
        const graph = await withAdapterWriteLock(
          adapterIdentityLockKey(before?.adapterId ?? originalUri),
          async () => {
            for (const uuid of layerUuids) {
              await qdrantService.updateMemory(uuid, { space_id: targetSpaceId });
            }
            const after = await readAdapterRecordsByUuid(qdrantService, layerUuids);
            if (!after) return null;
            return finalizeAdapterMutation({
              owner: qdrantService,
              source: memoryStore ?? null,
              head: after.head,
              layers: after.layers,
              changeType: 'updated',
              movedFromSpaceId: before?.spaceId ?? null,
              reason: `tune: adapter moved to ${targetSpaceId}`
            });
          }
        );
        results.push({
          uri: buildLayerUri(head),
          status: 'updated',
          message: `Adapter layers reassigned to target space${graphNote(graph)}`
        });
        total_updated++;
      } catch (error) {
        results.push(failureRow(originalUri, error, 'Space move failed: '));
        total_failed++;
      }
    }
    return { results, total_updated, total_failed };
  }

  const results: TuneOutput['results'] = [];
  let total_updated = 0;
  let total_failed = 0;

  for (let i = 0; i < input.uris.length; i++) {
    const originalUri = input.uris[i]!;
    const contentAtIndex = Array.isArray(input.content) ? input.content[i] : undefined;
    const parsedUri = parseSquadrulesUri(originalUri);
    let layerGraph: AdapterMutationReport | null = null;
    try {
      if (parsedUri.kind === 'adapter' && typeof contentAtIndex === 'string' && contentAtIndex.trim().length > 0) {
        const outcome = await tuneAdapterMarkdownInPlace(
          qdrantService,
          originalUri,
          contentAtIndex,
          memoryStore,
          input.expected_version
        );
        results.push({
          uri: outcome.layerUri,
          status: 'updated',
          message: `Adapter layer ${outcome.layerUri} updated successfully${graphNote(outcome.graph)}`
        });
        total_updated++;
        continue;
      }

      // Every remaining path writes stored layers directly (a layer URI, or an adapter URI
      // with `updates` instead of `content`). The markdown rewrite above owns its own guard,
      // so this is the one place the other paths inherit it. No `expected_version` is a
      // no-op: an ordinary tune behaves exactly as before.
      await assertTuneExpectedVersionForTarget(qdrantService, originalUri, input.expected_version);

      const normalizedUri = await normalizeTuneUri(qdrantService, originalUri);
      const perUriUpdate = await executeUpdate(
        qdrantService,
        {
          uris: [normalizedUri] as any,
          content: typeof contentAtIndex === 'string' ? [contentAtIndex] : undefined,
          updates: input.updates
        },
        {
          source: memoryStore ?? null,
          // The layer write itself is `update.ts`'s; it reports the derived pass back here
          // so this row can disclose a projection that did not complete.
          onAdapterMutation: (mutation) => {
            layerGraph = mutation;
          }
        }
      );
      const entry = perUriUpdate.results[0];
      const layerUri = buildLayerUri((entry?.uri ?? normalizedUri).split('/').pop() ?? '');
      const row = {
        uri: layerUri,
        status: entry?.status ?? 'error',
        message:
          buildTuneResultMessage(
            entry ?? { status: 'error', message: 'Failed to update memory: Unknown update failure' },
            layerUri
          ) + (entry?.status === 'updated' ? graphNote(layerGraph) : '')
      } as TuneOutput['results'][number];
      results.push(row);
      if (row.status === 'updated') total_updated++;
      else total_failed++;
    } catch (error) {
      results.push(failureRow(originalUri, error, 'Failed to update adapter layer: '));
      total_failed++;
    }
  }

  if (targetSpaceId) {
    for (let i = 0; i < input.uris.length; i++) {
      const originalUri = input.uris[i]!;
      const row = results[i];
      if (!row || row.status !== 'updated') continue;
      try {
        // A content write followed by a move is still one adapter mutation, but the
        // content pass above ran in the *old* scope: the graph node and the history key
        // both embed `space_id`. The derived pass therefore runs again over the
        // destination, and the pre-move read tells it which scope to stop claiming. The
        // durable bytes did not change, so history records a snapshot only under the new
        // key — re-recording identical bytes under the old one is suppressed upstream.
        const layerUuids = await collectLayerMemoryUuidsForTune(qdrantService, originalUri);
        const before = await readAdapterRecordsByUuid(qdrantService, layerUuids);
        const graph = await withAdapterWriteLock(
          adapterIdentityLockKey(before?.adapterId ?? originalUri),
          async () => {
            await reassignAdapterLayersToSpace(qdrantService, originalUri, targetSpaceId);
            if (!before) return null;
            const after = await readAdapterRecordsByUuid(qdrantService, layerUuids);
            if (!after) return null;
            return finalizeAdapterMutation({
              owner: qdrantService,
              source: memoryStore ?? null,
              head: after.head,
              layers: after.layers,
              changeType: 'updated',
              movedFromSpaceId: before.spaceId,
              reason: `tune: adapter moved to ${targetSpaceId}`
            });
          }
        );
        row.message = `${row.message} Reassigned to target space.${graphNote(graph)}`;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results[i] = {
          uri: row.uri,
          status: 'error',
          message: `Content updated but space reassignment failed: ${errorMessage}`
        };
        total_failed++;
        total_updated--;
      }
    }
  }

  return {
    results,
    total_updated,
    total_failed
  };
}
