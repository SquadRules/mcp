/**
 * Export a historical adapter snapshot (ADR 0045).
 *
 * The selector is additive: a normal export is unchanged, and `version` asks the
 * graph for one immutable snapshot instead of the current stored head. The snapshot
 * is read back through `readVerifiedVersion`, so a content byte that no longer
 * hashes to its recorded digest fails the export instead of returning unverified
 * markdown.
 *
 * Restore is deliberately *not* a write in this module: the exported markdown is
 * submitted through the normal `train`/`tune` validators, which keeps one write
 * path and one set of structural checks.
 */
import type { MemoryQdrantStore } from '../services/memory/store.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { getGraphDb } from '../services/graph-db/graph-owner.js';
import { adapterGraphKey, storedAdapterScope } from '../services/graph-db/adapter-scope.js';
import {
  HistoryDigestMismatchError,
  readAdapterHistory,
  readVerifiedVersion
} from '../services/graph-db/graph-history.service.js';
import { sha256Hex } from '../utils/sha256.js';
import type { Memory } from '../types/memory.js';
import { resolveExportAdapter } from './export-resolve-adapter.js';
import type { ExportInput, ExportOutput } from './export_schema.js';

/** Graph repository for an export, whichever surface the runtime attached it to. */
function exportGraph(memoryStore: MemoryQdrantStore, qdrantService?: QdrantService) {
  return getGraphDb(memoryStore) ?? (qdrantService ? getGraphDb(qdrantService) : null);
}

function adapterIdentity(head: Memory): { slug: string; spaceId: string } | null {
  const slug = (head.slug ?? head.adapter?.name ?? '').trim();
  if (!slug) return null;
  return { slug, spaceId: storedAdapterScope(head.space_id, 'export:version').spaceId };
}

/**
 * Return one historical snapshot as `markdown` output.
 *
 * Throws (never degrades) when the graph is unavailable, the adapter has no such
 * version, or the stored bytes no longer match their digest — each with a message
 * the caller can act on.
 */
export async function executeExportVersion(
  memoryStore: MemoryQdrantStore,
  qdrantService: QdrantService | undefined,
  input: ExportInput
): Promise<ExportOutput> {
  const versionNumber = (input.version ?? '').trim();
  if (!input.uri) {
    throw new Error('export with `version` requires a single `uri` (adapter or layer).');
  }
  const graphDb = exportGraph(memoryStore, qdrantService);
  if (!graphDb || !graphDb.isInitialized()) {
    // Name the switches that actually exist: a hint naming the wrong variable sends the
    // operator to a knob that changes nothing.
    throw new Error(
      'export with `version` requires an initialized graph backend; enable the embedded store with `SQUADRULES_GRAPH_DB_ENABLED=true`, or select the shared backend with `SQUADRULES_GRAPH_BACKEND=arango` plus `SQUADRULES_ARANGO_URL` and `SQUADRULES_ARANGO_DATABASE`.'
    );
  }

  const { layerId } = await resolveExportAdapter(memoryStore, qdrantService, input.uri);
  const head = await memoryStore.getMemory(layerId);
  if (!head) throw new Error(`export: layer ${layerId} is not readable`);
  const identity = adapterIdentity(head);
  if (!identity) throw new Error(`export: layer ${layerId} carries no adapter slug`);

  const adapterKey = adapterGraphKey(identity.spaceId, identity.slug);
  let snapshot;
  try {
    snapshot = await readVerifiedVersion(graphDb, adapterKey, versionNumber);
  } catch (err) {
    if (err instanceof HistoryDigestMismatchError) {
      throw new Error(
        `export: version ${versionNumber} of ${identity.slug} failed digest verification (${err.expected} != ${err.actual}); refusing to return unverified bytes.`
      );
    }
    throw err;
  }

  const history = await readAdapterHistory(graphDb, adapterKey);
  return {
    uri: input.uri,
    format: 'markdown',
    content_type: 'text/markdown',
    content: snapshot.content,
    item_count: 1,
    adapter_name: identity.slug,
    adapter_version: snapshot.adapter_version,
    history_version: snapshot.version_number,
    history_versions: history.length,
    snapshot_sha256: sha256Hex(snapshot.content),
    snapshot_changed_at: snapshot.changed_at,
    snapshot_changed_by: snapshot.changed_by,
    space_id: identity.spaceId
  };
}
