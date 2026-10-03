// squadrules-compat-surface: imports/references a retained prior-brand-named module or path (source filenames are an explicit non-goal)
import type { MemoryQdrantStore } from '../services/memory/store.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { getAdapterId } from '../services/memory/memory-accessors.js';
import { parseSquadrulesUri } from './kairos-uri.js';

export async function resolveExportAdapter(
  memoryStore: MemoryQdrantStore,
  qdrantService: QdrantService | undefined,
  uri: string
): Promise<{ adapterId: string; layerId: string }> {
  const parsed = parseSquadrulesUri(uri);
  if (parsed.kind === 'adapter') {
    if (parsed.idKind === 'slug') {
      if (!qdrantService) {
        throw new Error('Adapter slug lookup is unavailable');
      }
      const outcome = await qdrantService.findFirstStepMemoryUuidBySlug(parsed.id);
      if (!outcome.layerUuid) {
        throw new Error('Adapter not found');
      }
      const firstLayer = await memoryStore.getMemory(outcome.layerUuid);
      const adapterId = firstLayer ? getAdapterId(firstLayer) : outcome.layerUuid;
      const layers = await qdrantService.getAdapterLayers(adapterId);
      const firstLayerId = layers[0]?.uuid ?? adapterId;
      return { adapterId, layerId: firstLayerId };
    }
    if (qdrantService) {
      const layers = await qdrantService.getAdapterLayers(parsed.id);
      const firstLayerId = layers[0]?.uuid;
      if (firstLayerId) {
        return { adapterId: parsed.id, layerId: firstLayerId };
      }
    }
    const layer = await memoryStore.getMemory(parsed.id);
    if (layer) {
      return { adapterId: parsed.id, layerId: layer.memory_uuid };
    }
    throw new Error('Adapter not found');
  }

  const memory = await memoryStore.getMemory(parsed.id);
  const adapterId = memory ? getAdapterId(memory) : parsed.id;
  return { adapterId, layerId: parsed.id };
}
