import type { AdapterInfo, InferenceContractDefinition, Memory } from '../../types/memory.js';

export function getAdapterInfo(memory: Pick<Memory, 'adapter' | 'memory_uuid' | 'label'>): AdapterInfo | undefined {
  return memory.adapter;
}

export function getAdapterId(memory: Pick<Memory, 'adapter' | 'memory_uuid' | 'label'>): string {
  return getAdapterInfo(memory)?.id ?? memory.memory_uuid;
}

export function getAdapterName(memory: Pick<Memory, 'adapter' | 'memory_uuid' | 'label'>): string {
  return getAdapterInfo(memory)?.name ?? memory.label;
}

export function getActivationPatterns(memory: Pick<Memory, 'adapter' | 'memory_uuid' | 'label'>): string[] {
  return getAdapterInfo(memory)?.activation_patterns ?? [];
}

export function getLayerIndex(memory: Pick<Memory, 'adapter' | 'memory_uuid' | 'label'>): number {
  return getAdapterInfo(memory)?.layer_index ?? 1;
}

export function getLayerCount(memory: Pick<Memory, 'adapter' | 'memory_uuid' | 'label'>): number {
  return getAdapterInfo(memory)?.layer_count ?? 1;
}

export function getInferenceContract(memory: Pick<Memory, 'inference_contract'>): InferenceContractDefinition | undefined {
  return memory.inference_contract;
}

/** Normalized slug for activate/search tool output; null when missing or blank. */
export function getAdapterSlugForSearchOutput(memory: Pick<Memory, 'slug'>): string | null {
  const raw = memory.slug;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

/** Chain root slug from adapter metadata; null when missing or blank. */
export function getChainRoot(memory: Pick<Memory, 'adapter' | 'memory_uuid' | 'label'>): string | null {
  const raw = getAdapterInfo(memory)?.chain_root;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

/**
 * Adapter protocol version out of a *stored raw payload* (the JSON blob persisted
 * by both backends), not a hydrated `Memory`. This is the single home for the
 * nesting invariant: writers store the version at `payload.adapter.protocol_version`
 * (and promote it to the LanceDB `protocol_version` column), while older rows may
 * carry a top-level `payload.protocol_version`. Read the nested path first and fall
 * back to the top level so the boot-injection reuse skip (issue #24, ADR 0002)
 * resolves the version that was actually written instead of always `undefined`.
 */
export function getPayloadAdapterVersion(payload: Record<string, unknown> | undefined | null): string | undefined {
  if (!payload) return undefined;
  const adapter = payload['adapter'] as { protocol_version?: unknown } | undefined;
  const nested = adapter?.protocol_version;
  if (typeof nested === 'string' && nested.trim().length > 0) return nested;
  const top = payload['protocol_version'];
  return typeof top === 'string' && top.trim().length > 0 ? top : undefined;
}
