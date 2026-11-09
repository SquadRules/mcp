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
  reassignAdapterLayersToSpace
} from './tune-uri-resolution.js';

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
        for (const uuid of layerUuids) {
          await qdrantService.updateMemory(uuid, { space_id: targetSpaceId });
        }
        const head = layerUuids[0];
        results.push({
          uri: head ? buildLayerUri(head) : originalUri,
          status: 'updated',
          message: 'Adapter layers reassigned to target space'
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
    try {
      if (parsedUri.kind === 'adapter' && typeof contentAtIndex === 'string' && contentAtIndex.trim().length > 0) {
        const layerUri = await tuneAdapterMarkdownInPlace(
          qdrantService,
          originalUri,
          contentAtIndex,
          memoryStore,
          input.expected_version
        );
        results.push({
          uri: layerUri,
          status: 'updated',
          message: `Adapter layer ${layerUri} updated successfully`
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
      const perUriUpdate = await executeUpdate(qdrantService, {
        uris: [normalizedUri] as any,
        content: typeof contentAtIndex === 'string' ? [contentAtIndex] : undefined,
        updates: input.updates
      });
      const entry = perUriUpdate.results[0];
      const layerUri = buildLayerUri((entry?.uri ?? normalizedUri).split('/').pop() ?? '');
      const row = {
        uri: layerUri,
        status: entry?.status ?? 'error',
        message: buildTuneResultMessage(
          entry ?? { status: 'error', message: 'Failed to update memory: Unknown update failure' },
          layerUri
        )
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
        await reassignAdapterLayersToSpace(qdrantService, originalUri, targetSpaceId);
        row.message = `${row.message} Reassigned to target space.`;
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
