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
 * Protocol version on a **stored record payload** (Qdrant point payload or the LanceDB row's
 * payload JSON), used by the boot-injection reuse rule. Writers nest it under `adapter`
 * (`store-adapter-default-handler.ts`, `lance-records-writes.ts`); the payload root has no
 * `protocol_version` key, so reading the root always yields undefined. Both store backends
 * resolve the version through here so the depth rule has one home (docs/adr/0002).
 */
export function getPayloadAdapterVersion(payload: unknown): string | undefined {
  const raw = (payload as { adapter?: { protocol_version?: unknown } } | undefined)?.adapter?.protocol_version;
  return typeof raw === 'string' ? raw : undefined;
}
