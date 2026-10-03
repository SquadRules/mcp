// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import type { Memory } from '../types/memory.js';
import type { MemoryQdrantStore } from '../services/memory/store.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { resolveToolDoc } from '../utils/mcp-tool-doc-runtime.js';
import { getTenantId, getSpaceContextFromStorage, runWithSpaceContextAsync } from '../utils/tenant-context.js';
import { resolveSpaceParamForContext } from '../utils/resolve-space-param.js';
import { executeTrainStore, TrainError } from './train-store.js';
import { executeDump } from './dump.js';
import { KAIROS_CREATION_PROTOCOL_SLUG } from '../constants/builtin-search-meta.js';
import { assertWireAdapterUri, buildAdapterUri, buildLayerUri, parseSquadrulesUri } from './kairos-uri.js';
import { normalizeArtifactRelativePath } from './artifact-relative-path.js';
import { resolveTrainOutputAdapterUri } from './train-output-adapter-uri.js';
import { resolveTrainMime } from './train-mime.js';
import {
  trainInputSchema,
  trainOutputSchema,
  type TrainInput,
  type TrainOutput,
  type TrainStoreInput
} from './train_schema.js';
import { kairosTrainSimilarAdapterFound, mcpToolCalls, mcpToolDuration, mcpToolErrors, mcpToolInputSize, mcpToolOutputSize } from '../services/metrics/mcp-metrics.js';
import { mcpLooseToolInput } from './mcp-loose-input-schema.js';
import { mcpToolInputValidationErrorResult } from './mcp-tool-input-teaching.js';
import { mcpRateLimitErrorResult } from './mcp-runtime-error.js';
import { resolveCanonicalAdapterUriForArtifact } from './train-artifact-adapter-uri.js';
import { assertReviewEvidencePassed } from './review-evidence-check.js';
interface RegisterTrainOptions {
  toolName?: string;
  qdrantService?: QdrantService;
}

function creationAdapterUri(): string {
  return buildAdapterUri(KAIROS_CREATION_PROTOCOL_SLUG);
}

const TRAIN_ERROR_DETAIL_KEYS = new Set([
  'missing',
  'must_obey',
  'next_action',
  'existing_memory',
  'similarity_score',
  'content_preview',
  'adapter_id',
  'items'
]);

function sanitizeTrainDetails(details?: Record<string, unknown>): Record<string, unknown> {
  if (!details) return {};
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (!TRAIN_ERROR_DETAIL_KEYS.has(key)) continue;
    output[key] = value;
  }
  return output;
}

function formatTrainErrorPayload(error: { code?: string; details?: Record<string, unknown>; message?: string }) {
  const normalizedCode = error.code === 'DUPLICATE_KEY' ? 'DUPLICATE_ADAPTER' : error.code;
  if (normalizedCode === 'DUPLICATE_ADAPTER') {
    return {
      error: 'DUPLICATE_ADAPTER',
      message: 'Adapter with this label already exists. Use force_update: true to overwrite.',
      ...sanitizeTrainDetails(error.details)
    };
  }
  if (normalizedCode === 'SIMILAR_MEMORY_FOUND') {
    const details = sanitizeTrainDetails(error.details);
    return {
      error: 'SIMILAR_MEMORY_FOUND',
      message: typeof details['next_action'] === 'string'
        ? 'Adapter title is very similar to an existing one. Inspect the match; use force_update: true with the same adapter id to replace.'
        : 'Adapter title is very similar to an existing one.',
      ...details
    };
  }
  return {
    error: normalizedCode ?? 'PROTOCOL_STRUCTURE_INVALID',
    message: (error.message ?? 'Adapter validation failed')
      .replaceAll('Protocol', 'Adapter')
      .replaceAll('protocol', 'adapter'),
    ...sanitizeTrainDetails(error.details),
    next_action: `call forward with ${creationAdapterUri()} to open the guided adapter creation flow`
  };
}

async function resolveContentForTrain(
  memoryStore: MemoryQdrantStore,
  qdrantService: QdrantService | undefined,
  input: TrainInput
): Promise<string> {
  const fromInput = typeof input.content === 'string' ? input.content.trim() : '';
  const sourceUri = input.source_adapter_uri?.trim();
  if (!sourceUri) {
    return fromInput;
  }
  if (!qdrantService) {
    throw new TrainError(
      'SOURCE_ADAPTER_UNAVAILABLE',
      'Forking from source_adapter_uri requires the adapter store; try again or pass content only.',
      { must_obey: true }
    );
  }
  let adapterId = '';
  try {
    const canonicalAdapterUri = assertWireAdapterUri(sourceUri);
    const parsed = parseSquadrulesUri(canonicalAdapterUri);
    const resolved = await qdrantService.findFirstStepMemoryUuidBySlug(parsed.id);
    if (!resolved.layerUuid) {
      throw new TrainError('SOURCE_ADAPTER_NOT_FOUND', `source_adapter_uri adapter slug "${parsed.id}" was not found.`, {
        must_obey: true
      });
    }
    adapterId = resolved.layerUuid;
  } catch (error) {
    if (error instanceof TrainError) throw error;
    throw new TrainError('INVALID_SOURCE_URI', 'source_adapter_uri must be kairos://adapter/{slug}', {
      must_obey: true
    });
  }
  const layers = await qdrantService.getAdapterLayers(adapterId);
  const headUuid = layers[0]?.uuid ?? adapterId;
  const dump = await executeDump(memoryStore, qdrantService, {
    uri: buildLayerUri(headUuid),
    protocol: true
  });
  const dumped = typeof dump['content'] === 'string' ? dump['content'].trim() : '';
  if (!dumped) {
    throw new TrainError('SOURCE_EXPORT_EMPTY', 'Could not export markdown from the source adapter.', {
      must_obey: true
    });
  }
  return fromInput.length > 0 ? fromInput : dumped;
}

export async function executeTrain(
  memoryStore: MemoryQdrantStore,
  input: TrainInput,
  runStore: <T>(fn: () => Promise<T>) => Promise<T>,
  qdrantService?: QdrantService
): Promise<TrainOutput> {
  const content = await resolveContentForTrain(memoryStore, qdrantService, input);
  if (!content || content.length < 1) {
    throw new TrainError('CONTENT_REQUIRED', 'Provide content and/or source_adapter_uri.', {
      must_obey: true
    });
  }
  const resolvedMime = resolveTrainMime(input);
  const isArtifactTrain = typeof resolvedMime === 'string' && resolvedMime !== 'text/markdown';
  const isForkTrain = typeof input.source_adapter_uri === 'string' && input.source_adapter_uri.trim().length > 0;
  if (!isArtifactTrain && !isForkTrain) assertReviewEvidencePassed(input.review_evidence);

  const canonicalAdapterUri = isArtifactTrain
    ? await resolveCanonicalAdapterUriForArtifact(input.adapter_uri, qdrantService)
    : input.adapter_uri;
  const forkedFromSource = typeof input.source_adapter_uri === 'string' && input.source_adapter_uri.trim().length > 0;
  const normalizedArtifactRelativePath =
    typeof input.relative_path === 'string' && input.relative_path.trim().length > 0
      ? normalizeArtifactRelativePath(input.relative_path.trim())
      : undefined;
  const storePayload = {
    content,
    llm_model_id: input.llm_model_id,
    force_update: input.force_update,
    ...(input.protocol_version !== undefined && { protocol_version: input.protocol_version }),
    ...(input.space !== undefined && { space: input.space }),
    ...(resolvedMime !== undefined && { mime: resolvedMime }),
    ...(input.artifact_name !== undefined && { artifact_name: input.artifact_name }),
    ...(canonicalAdapterUri !== undefined && { adapter_uri: canonicalAdapterUri }),
    ...(forkedFromSource && { fork_new_adapter: true }),
    ...(normalizedArtifactRelativePath !== undefined && normalizedArtifactRelativePath !== null && {
      relative_path: normalizedArtifactRelativePath
    })
  };
  const result = await executeTrainStore(
    memoryStore,
    storePayload as TrainStoreInput,
    runStore as (fn: () => Promise<Memory[]>) => Promise<Memory[]>
  );
  const items = await Promise.all(
    result.items.map(async (item) => {
      const storedId = item.layer_uuid ?? item.artifact_uuid;
      const memory = storedId ? await memoryStore.getMemory(storedId) : null;
      const isArtifactRow =
        Boolean(item.artifact_uuid) ||
        (typeof item.content_type === 'string' && item.content_type !== 'text/markdown');

      let adapterId = memory?.adapter?.id;
      if (!adapterId && typeof item.adapter_uri === 'string' && item.adapter_uri.trim().length > 0) {
        try {
          const parsed = parseSquadrulesUri(item.adapter_uri.trim());
          if (parsed.kind === 'adapter') adapterId = parsed.id;
        } catch {
          /* ignore invalid uri */
        }
      }
      if (!adapterId && isArtifactRow && typeof canonicalAdapterUri === 'string' && canonicalAdapterUri.trim().length > 0) {
        try {
          const parsed = parseSquadrulesUri(canonicalAdapterUri.trim());
          if (parsed.kind === 'adapter') adapterId = parsed.id;
        } catch {
          /* ignore invalid uri */
        }
      }
      if (!adapterId && !isArtifactRow && storedId) {
        adapterId = storedId;
      }
      const outputAdapterUri = resolveTrainOutputAdapterUri({
        memorySlug: memory?.slug,
        memoryAdapterName: memory?.adapter?.name,
        itemAdapterUri: item.adapter_uri,
        inputAdapterUri: input.adapter_uri,
        adapterId
      });

      const tagSlug = Array.isArray(item.tags)
        ? item.tags.find((tag) => typeof tag === 'string' && tag.startsWith('artifact:'))?.slice('artifact:'.length)
        : undefined;
      const artifactSlug = typeof memory?.artifact?.slug === 'string'
        ? memory.artifact.slug.trim()
        : (typeof tagSlug === 'string' ? tagSlug.trim() : '');
      const artifactUri = artifactSlug.length > 0
        ? `kairos://artifact/${artifactSlug}`
        : `kairos://artifact/${storedId}`;

      return {
        uri: item.content_type && item.content_type !== 'text/markdown'
          ? artifactUri
          : buildLayerUri(storedId || ''),
        ...(item.layer_uuid && { layer_uuid: item.layer_uuid }),
        ...(item.artifact_uuid && { artifact_uuid: item.artifact_uuid }),
        ...(outputAdapterUri && { adapter_uri: outputAdapterUri }),
        label: item.label,
        tags: item.tags,
        ...(item.content_type && { content_type: item.content_type })
      };
    })
  );
  return {
    items,
    status: 'stored'
  };
}

export function registerTrainTool(server: any, memoryStore: MemoryQdrantStore, options: RegisterTrainOptions = {}) {
  const toolName = options.toolName || 'train';
  const qdrantService = options.qdrantService;

  server.registerTool(
    toolName,
    {
      title: 'Register a new adapter',
      description: resolveToolDoc('train') || 'Store a new adapter from markdown.',
      inputSchema: mcpLooseToolInput(trainInputSchema),
      outputSchema: trainOutputSchema
    },
    async (params: unknown) => {
      const tenantId = getTenantId();
      const ctx = getSpaceContextFromStorage();
      const rawSpace = typeof (params as any)?.space === 'string' ? (params as any).space.trim() : '';
      const spaceParam = rawSpace.toLowerCase();
      let resolvedSpaceId: string;

      if ((params as any)?.space === undefined || rawSpace === '') {
        resolvedSpaceId = ctx.defaultWriteSpaceId || ctx.allowedSpaceIds[0] || '';
      } else if (spaceParam === 'personal') {
        const r = resolveSpaceParamForContext(ctx, rawSpace);
        if (!r.ok) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'SPACE_NOT_FOUND', message: r.message }) }]
          };
        }
        resolvedSpaceId = r.spaceId;
      } else {
        const r = resolveSpaceParamForContext(ctx, rawSpace);
        if (!r.ok) {
          const errKey = r.code === 'SPACE_READ_ONLY' ? 'SPACE_READ_ONLY' : 'SPACE_NOT_FOUND';
          return {
            isError: true,
            content: [{ type: 'text' as const, text: JSON.stringify({ error: errKey, message: r.message }) }]
          };
        }
        resolvedSpaceId = r.spaceId;
      }

      mcpToolInputSize.observe({ tool: toolName, tenant_id: tenantId }, JSON.stringify(params).length);
      const timer = mcpToolDuration.startTimer({ tool: toolName, tenant_id: tenantId });
      const narrowedContext = {
        ...ctx,
        defaultWriteSpaceId: resolvedSpaceId
      };

      const parsedInput = trainInputSchema.safeParse(params);
      if (!parsedInput.success) {
        mcpToolCalls.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        mcpToolErrors.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        timer({ tool: toolName, status: 'error', tenant_id: tenantId });
        return mcpToolInputValidationErrorResult('train', parsedInput.error, params);
      }
      const input = parsedInput.data;
      try {
        const output = await executeTrain(memoryStore, input, (fn) => runWithSpaceContextAsync(narrowedContext, fn), qdrantService);
        mcpToolCalls.inc({ tool: toolName, status: 'success', tenant_id: tenantId });
        mcpToolOutputSize.observe({ tool: toolName, tenant_id: tenantId }, JSON.stringify(output).length);
        timer({ tool: toolName, status: 'success', tenant_id: tenantId });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(output) }],
          structuredContent: output
        };
      } catch (error) {
        const err = error as { code?: string; details?: Record<string, unknown>; message?: string };
        if (error instanceof TrainError) {
          mcpToolCalls.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
          mcpToolErrors.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
          timer({ tool: toolName, status: 'error', tenant_id: tenantId });
          return {
            isError: true,
            content: [{
              type: 'text' as const,
              text: JSON.stringify(formatTrainErrorPayload({
                code: error.code,
                ...(error.details ? { details: error.details } : {}),
                message: error.message
              }))
            }]
          };
        }
        if (err.code === 'SIMILAR_MEMORY_FOUND') {
          kairosTrainSimilarAdapterFound.inc({ transport: 'mcp', tenant_id: tenantId });
        }
        if (err.code === 'DUPLICATE_ADAPTER' || err.code === 'DUPLICATE_KEY' || err.code === 'SIMILAR_MEMORY_FOUND') {
          mcpToolCalls.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
          mcpToolErrors.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
          timer({ tool: toolName, status: 'error', tenant_id: tenantId });
          return {
            isError: true,
            content: [{ type: 'text' as const, text: JSON.stringify(formatTrainErrorPayload(err)) }]
          };
        }
        mcpToolCalls.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        mcpToolErrors.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        timer({ tool: toolName, status: 'error', tenant_id: tenantId });
        const rateLimitResult = mcpRateLimitErrorResult(error);
        if (rateLimitResult) return rateLimitResult;
        throw error;
      }
    }
  );
}