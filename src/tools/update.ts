import type { QdrantService } from '../services/qdrant/service.js';
import type { UpdateInput, UpdateOutput } from './update_schema.js';
import { extractMemoryBody, hasMemoryBodyMarkers } from '../utils/memory-body.js';
import { validateAdapterMarkdownSize } from '../services/memory/validate-adapter-markdown-size.js';
import { buildLayerUri, parseSquadrulesUriOrThrow } from './squadrules-uri.js';
import {
  finalizeAdapterMutation,
  type AdapterMutationReport
} from '../services/graph-db/adapter-write-finalize.js';
import { adapterIdentityLockKey, withAdapterWriteLock } from '../services/graph-db/adapter-write-lock.js';
import type { AdapterRecordSource } from '../services/graph-db/adapter-graph-records.js';
import { readAdapterRecordsByUuid, resolveLayerAdapterAssociation } from './tune-uri-resolution.js';

/**
 * Work that follows a layer write.
 *
 * The write itself is unconditional. These options exist because editing one layer
 * changes derived state of the adapter that layer belongs to — its graph topology and
 * its history — and that pass is driven by whoever owns the record source, not by the
 * store. A layer that is not an adapter member never runs the pass.
 */
export interface ExecuteUpdateOptions {
  /** Record-enumerating surface used by the derived pass. */
  source?: AdapterRecordSource | null;
  /** Receives the derived pass for each adapter layer that was written. */
  onAdapterMutation?: (report: AdapterMutationReport) => void;
}

/**
 * Read the adapter back and run the one derived pass over the state just written.
 *
 * Returns `null` when the layers cannot be read back: the write is already durable, so
 * the honest outcome is an unreported pass rather than a failed write.
 */
async function finalizeLayerEdit(
  qdrantService: QdrantService,
  layerUuids: string[],
  editedUuid: string,
  options: ExecuteUpdateOptions
): Promise<AdapterMutationReport | null> {
  const stored = await readAdapterRecordsByUuid(qdrantService, layerUuids);
  if (!stored) return null;
  return finalizeAdapterMutation({
    owner: qdrantService,
    source: options.source ?? null,
    head: stored.head,
    layers: stored.layers,
    changeType: 'updated',
    reason: `update: layer ${editedUuid} edited`
  });
}

/** Shared execute: update memories by URIs. Used by MCP tool and HTTP route. */
export async function executeUpdate(
  qdrantService: QdrantService,
  input: UpdateInput,
  options: ExecuteUpdateOptions = {}
): Promise<UpdateOutput> {
  const { uris, content, updates } = input;
  if (content && content.length !== uris.length) {
    throw new Error('content array length must match uris array length');
  }
  const results: UpdateOutput['results'] = [];
  let totalUpdated = 0;
  let totalFailed = 0;

  for (let index = 0; index < uris.length; index++) {
    const uri = uris[index]!;
    try {
      const parsed = parseSquadrulesUriOrThrow(uri);
      if (parsed.kind !== 'layer') {
        throw new Error('update requires a layer URI (stored layer row), not an adapter or artifact URI');
      }
      const uuid = parsed.id;
      const valueAtIndex = Array.isArray(content) ? content[index] : undefined;

      // Proven before the write so the read → write → derived-pass window for one
      // adapter can be one critical section. `null` for a plain memory, which then
      // behaves exactly as it did before.
      const { association } = await resolveLayerAdapterAssociation(qdrantService, uuid);

      const applyWrite = async (): Promise<AdapterMutationReport | null> => {
        if (typeof valueAtIndex === 'string' && valueAtIndex.trim().length > 0) {
          const layerCheck = validateAdapterMarkdownSize(valueAtIndex, { enforceMaxLineCount: false });
          if (!layerCheck.ok) {
            throw new Error(`${layerCheck.message} (${layerCheck.code})`);
          }
          const body = extractMemoryBody(valueAtIndex);
          await qdrantService.updateMemory(uuid, { text: body });
        } else if (updates && Object.keys(updates).length > 0) {
          if (typeof updates['text'] === 'string' && hasMemoryBodyMarkers(updates['text'])) {
            const layerCheck = validateAdapterMarkdownSize(updates['text'], { enforceMaxLineCount: false });
            if (!layerCheck.ok) {
              throw new Error(`${layerCheck.message} (${layerCheck.code})`);
            }
            const body = extractMemoryBody(updates['text']);
            await qdrantService.updateMemory(uuid, { text: body });
          } else {
            await qdrantService.updateMemory(uuid, updates);
          }
        } else {
          throw new Error('Provide content or updates');
        }

        // Every branch above is a real write, so the derived pass runs for all of them:
        // an edit that changes only a label or a layer body still changes the adapter a
        // later read will reconstruct.
        return association
          ? finalizeLayerEdit(
              qdrantService,
              association.layers.map((layer) => layer.uuid),
              uuid,
              options
            )
          : null;
      };

      const mutation = await withAdapterWriteLock(
        adapterIdentityLockKey(association?.adapterId ?? uuid),
        applyWrite
      );
      if (mutation) options.onAdapterMutation?.(mutation);

      results.push({
        uri: buildLayerUri(uuid, parsed.executionId),
        status: 'updated',
        message: `Adapter layer ${buildLayerUri(uuid, parsed.executionId)} updated successfully`
      });
      totalUpdated++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.push({
        uri,
        status: 'error',
        message: `Failed to update memory: ${errorMessage}`
      });
      totalFailed++;
    }
  }

  return {
    results,
    total_updated: totalUpdated,
    total_failed: totalFailed
  };
}
