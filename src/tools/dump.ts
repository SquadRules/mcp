// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import type { MemoryQdrantStore } from '../services/memory/store.js';
import type { QdrantService } from '../services/qdrant/service.js';
import type { InferenceContractDefinition, Memory } from '../types/memory.js';
import { getInferenceContract } from '../services/memory/memory-accessors.js';
import { extractMemoryBody } from '../utils/memory-body.js';
import { buildProtocolYamlFrontmatter, stripRedundantStepH2 } from '../utils/dump-markdown.js';
import { slugifyFromTitle } from '../utils/protocol-slug.js';
import { buildChallengeShapeForDisplay } from './next-pow-helpers.js';
import { resolveAdapterFirstLayer } from '../services/adapter-navigation.js';
import { redisCacheService } from '../services/redis-cache.js';
import { buildLayerUri } from './kairos-uri.js';

const LAYER_UUID_RE = /^[0-9a-f-]{36}$/i;

/** Older ambiguous surface that identified a layer row; still accepted on dump input only. */
const OLDER_LAYER_ROW_PREFIX = ['kairos', '://', 'me', 'm', '/'].join('');

/**
 * Resolve dump input to a layer UUID and canonical `kairos://layer/{uuid}`.
 * The UUID is always a **layer** (stored row / head layer), never an adapter id.
 */
function normalizeUri(value: string): { uuid: string; uri: string } {
  const normalized = (value || '').trim();
  const layerPrefix = 'kairos://layer/';
  if (normalized.toLowerCase().startsWith(layerPrefix.toLowerCase())) {
    const rest = normalized.slice(layerPrefix.length).split('?')[0] ?? '';
    const uuid = rest.split('/')[0] ?? '';
    if (LAYER_UUID_RE.test(uuid)) {
      return { uuid, uri: buildLayerUri(uuid) };
    }
  }
  if (normalized.startsWith(OLDER_LAYER_ROW_PREFIX)) {
    const rest = normalized.slice(OLDER_LAYER_ROW_PREFIX.length).split('?')[0] ?? '';
    const uuid = rest.split('/')[0] ?? '';
    if (LAYER_UUID_RE.test(uuid)) {
      return { uuid, uri: buildLayerUri(uuid) };
    }
  }
  const last = normalized.split('/').pop()?.split('?')[0];
  if (last && LAYER_UUID_RE.test(last)) {
    return { uuid: last, uri: buildLayerUri(last) };
  }
  throw new Error('Invalid dump URI: expected kairos://layer/{layer-uuid}');
}

async function loadMemory(memoryStore: MemoryQdrantStore, uuid: string): Promise<Memory | null> {
  const cached = await redisCacheService.getMemoryResource(uuid);
  if (cached) return cached;
  const memory = await memoryStore.getMemory(uuid);
  if (memory) await redisCacheService.setMemoryResource(memory);
  return memory;
}

/**
 * Append ```json for a stored layer contract. Train / validateProtocolStructure require
 * `{"contract": ...}` (contract shape train expects); `{ challenge: ... }` breaks fork-from-source re-train (#278).
 */
function inferenceContractFence(contract: InferenceContractDefinition | undefined): string {
  if (!contract) return '';
  return `\n\n\`\`\`json\n${JSON.stringify({ contract })}\n\`\`\``;
}

function buildMarkdownDocSingle(memory: Memory): string {
  const body = extractMemoryBody(memory.text);
  return body + inferenceContractFence(getInferenceContract(memory));
}

function includesRewardHeading(markdown: string): boolean {
  return /^##\s+Reward Signal\s*(?:\r?\n|$)/im.test(markdown);
}

function resolveStoredRewardSection(memories: Memory[]): string | null {
  for (const memory of memories) {
    const rewardSignal = memory.adapter?.reward_signal;
    if (typeof rewardSignal === 'string' && rewardSignal.trim().length > 0) {
      return rewardSignal.trim();
    }
  }
  return null;
}

function buildMarkdownDocProtocol(memories: Memory[]): string {
  if (memories.length === 0) return '';
  const adapterName = memories[0]!.adapter?.name ?? memories[0]!.label ?? 'Protocol';
  const parts: string[] = [`# ${adapterName}`];
  for (const memory of memories) {
    const body = extractMemoryBody(memory.text);
    const bodyStripped = stripRedundantStepH2(body, memory.label);
    parts.push(`## ${memory.label}\n\n${bodyStripped}${inferenceContractFence(getInferenceContract(memory))}`);
  }
  const rewardSection = resolveStoredRewardSection(memories);
  if (rewardSection) {
    const rewardAlreadyPresent = memories.some((memory) => includesRewardHeading(extractMemoryBody(memory.text)));
    if (!rewardAlreadyPresent) {
      parts.push(rewardSection);
    }
  }
  return parts.join('\n\n');
}

export interface DumpParams {
  uri: string;
  protocol?: boolean;
}

/** Execute dump logic; used by MCP tool and HTTP API. */
export async function executeDump(
  memoryStore: MemoryQdrantStore,
  qdrantService: QdrantService | undefined,
  params: DumpParams
): Promise<Record<string, unknown>> {
  const { uri, protocol = false } = params;
  const { uuid, uri: normalizedUri } = normalizeUri(uri);

  let memory = await loadMemory(memoryStore, uuid);
  if (!memory && qdrantService && typeof qdrantService.getAdapterLayers === 'function') {
    const adapterLayers = await qdrantService.getAdapterLayers(uuid);
    const firstUuid = adapterLayers[0]?.uuid;
    if (firstUuid) memory = await loadMemory(memoryStore, firstUuid);
  }
  if (!memory) {
    const error = new Error('Memory not found');
    (error as Error & { statusCode?: number }).statusCode = 404;
    throw error;
  }

  if (protocol && memory.adapter) {
    const firstLayer = await resolveAdapterFirstLayer(memory, qdrantService);
    if (!firstLayer?.uuid) {
      return {
        content: buildMarkdownDocSingle(memory),
        uri: normalizedUri,
        label: memory.label,
        adapter_name: memory.adapter.name,
        layer_count: 1,
        ...(memory.adapter.protocol_version && { adapter_version: memory.adapter.protocol_version })
      };
    }
    const chainId = memory.adapter.id;
    const chainLabel = memory.adapter.name;
    const stepCount = memory.adapter.layer_count;
    const protocolVersion = memory.adapter.protocol_version;
    const points = qdrantService && typeof qdrantService.getAdapterLayers === 'function'
      ? await qdrantService.getAdapterLayers(chainId, memory.space_id ? [memory.space_id] : undefined)
      : [];
    const memories: Memory[] = [];
    for (const point of points) {
      const currentMemory = await loadMemory(memoryStore, point.uuid);
      if (currentMemory) memories.push(currentMemory);
    }
    memories.sort((left, right) => (left.adapter?.layer_index ?? 0) - (right.adapter?.layer_index ?? 0));
    const headUri = buildLayerUri(firstLayer.uuid);
    const headSlug = memories[0]?.slug?.trim();
    const slugForExport = headSlug && headSlug.length > 0 ? headSlug : slugifyFromTitle(chainLabel);
    const chainRootForExport = memories[0]?.adapter?.chain_root;
    const markdownBody = buildMarkdownDocProtocol(memories);
    const content = buildProtocolYamlFrontmatter(slugForExport, protocolVersion, chainRootForExport) + markdownBody;
    return {
      content,
      uri: headUri,
      label: chainLabel,
      adapter_name: chainLabel,
      layer_count: stepCount,
      slug: slugForExport,
      ...(protocolVersion && { adapter_version: protocolVersion })
    };
  }

  const output: Record<string, unknown> = {
    content: buildMarkdownDocSingle(memory),
    uri: normalizedUri,
    label: memory.label,
    adapter_name: memory.adapter?.name ?? null
  };
  if (memory.adapter) {
    output['position'] = {
      layer_index: memory.adapter.layer_index,
      layer_count: memory.adapter.layer_count
    };
    if (memory.adapter.protocol_version) {
      output['adapter_version'] = memory.adapter.protocol_version;
    }
  }
  const challenge = buildChallengeShapeForDisplay(getInferenceContract(memory));
  if (challenge && Object.keys(challenge).length > 0) {
    output['challenge'] = challenge;
  }
  return output;
}
