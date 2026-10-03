import { qdrantService as globalQdrantService } from './qdrant/index.js';
import type { Memory } from '../types/memory.js';
import { getAdapterInfo, getAdapterId } from './memory/memory-accessors.js';
import { buildAdapterUri } from '../tools/squadrules-uri.js';

export interface ResolvedAdapterLayer {
    uuid: string;
    label?: string;
    layer_index?: number;
    layer_count?: number;
}

function pointLayerIndex(point: any): number {
    const adapterLayerIndex = point?.payload?.adapter?.layer_index;
    return typeof adapterLayerIndex === 'number' ? adapterLayerIndex : Number.MAX_SAFE_INTEGER;
}

async function getAdapterLayerPoints(adapterId: string, qdrantService?: any): Promise<any[]> {
    const svc = qdrantService || globalQdrantService;
    if (!svc || typeof (svc as any).getAdapterLayers !== 'function') return [];
    try {
        return await (svc as any).getAdapterLayers(adapterId);
    } catch {
        return [];
    }
}

export async function resolveAdapterEntry(
    memory: Memory,
    qdrantService?: any
): Promise<{ uri: string; label: string } | undefined> {
    const adapter = getAdapterInfo(memory);
    const adapterId = getAdapterId(memory);
    const adapterUri = buildAdapterUri(adapterId);
    if (!adapter || adapter.layer_index === 1) {
        return { uri: adapterUri, label: String(memory.label || 'Memory') };
    }

    const points: any[] = await getAdapterLayerPoints(adapter.id, qdrantService);
    if (!Array.isArray(points) || points.length === 0) return { uri: adapterUri, label: String(memory.label || 'Memory') };

    const head = points
        .map(pt => ({
            uuid: (pt as any)?.uuid || (pt as any)?.id?.toString?.() || '',
            label: (pt as any)?.payload?.label || 'Memory',
            layer_index: pointLayerIndex(pt)
        }))
        .sort((a, b) => (a.layer_index ?? Number.MAX_SAFE_INTEGER) - (b.layer_index ?? Number.MAX_SAFE_INTEGER))[0];

    if (head && head.uuid) return { uri: adapterUri, label: String(head.label || memory.label || 'Memory') };
    return { uri: adapterUri, label: String(memory.label || 'Memory') };
}

export async function resolveAdapterFirstLayer(
    memory: Memory,
    qdrantService?: any
): Promise<ResolvedAdapterLayer | undefined> {
    const adapter = getAdapterInfo(memory);
    if (!adapter) return undefined;
    const points: any[] = await getAdapterLayerPoints(adapter.id, qdrantService);
    if (!Array.isArray(points) || points.length === 0) return undefined;
    const first = points
        .map(pt => ({
            uuid: (pt as any)?.uuid || (pt as any)?.id?.toString?.() || '',
            label: (pt as any)?.payload?.label || undefined,
            layer_index: pointLayerIndex(pt)
        }))
        .find(p => p.layer_index === 1);
    if (first && first.uuid) {
        return { uuid: first.uuid, label: first.label, layer_index: first.layer_index, layer_count: adapter.layer_count };
    }
    return undefined;
}

export async function resolveAdapterNextLayer(
    memory: Memory,
    qdrantService?: any
): Promise<ResolvedAdapterLayer | undefined> {
    const adapter = getAdapterInfo(memory);
    if (!adapter) return undefined;
    const { id: adapterId, layer_index: currentLayerIndex, layer_count: layerCount } = adapter;
    if (currentLayerIndex >= layerCount) return undefined;
    const points: any[] = await getAdapterLayerPoints(adapterId, qdrantService);
    if (!Array.isArray(points) || points.length === 0) return undefined;
    const next = points
        .map(pt => ({
            uuid: (pt as any)?.uuid || (pt as any)?.id?.toString?.() || '',
            label: (pt as any)?.payload?.label || undefined,
            layer_index: pointLayerIndex(pt)
        }))
        .find(p => p.layer_index === currentLayerIndex + 1);
    if (next && next.uuid) return { uuid: next.uuid, label: next.label, layer_index: next.layer_index, layer_count: layerCount };
    return undefined;
}

export async function resolveAdapterPreviousLayer(
    memory: Memory,
    qdrantService?: any
): Promise<ResolvedAdapterLayer | undefined> {
    const adapter = getAdapterInfo(memory);
    if (!adapter) return undefined;
    const { id: adapterId, layer_index: currentLayerIndex, layer_count: layerCount } = adapter;
    if (currentLayerIndex <= 1) return undefined;
    const points: any[] = await getAdapterLayerPoints(adapterId, qdrantService);
    if (!Array.isArray(points) || points.length === 0) return undefined;
    const previous = points
        .map(pt => ({
            uuid: (pt as any)?.uuid || (pt as any)?.id?.toString?.() || '',
            label: (pt as any)?.payload?.label || undefined,
            layer_index: pointLayerIndex(pt)
        }))
        .find(p => p.layer_index === currentLayerIndex - 1);
    if (previous && previous.uuid) {
        return { uuid: previous.uuid, label: previous.label, layer_index: previous.layer_index, layer_count: layerCount };
    }
    return undefined;
}
