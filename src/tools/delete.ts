// squadrules-compat-surface: imports/references a retained prior-brand-named module or path (source filenames are an explicit non-goal)
import type { QdrantService } from '../services/qdrant/service.js';
import { qdrantService as qdrantServiceSingleton } from '../services/qdrant/index.js';
import { resolveToolDoc } from '../utils/mcp-tool-doc-runtime.js';
import { mcpToolCalls, mcpToolDuration, mcpToolErrors, mcpToolInputSize, mcpToolOutputSize } from '../services/metrics/mcp-metrics.js';
import { getTenantId } from '../utils/tenant-context.js';
import { deleteInputSchema, deleteOutputSchema, type DeleteInput, type DeleteOutput } from './delete_schema.js';
import { assertWireAdapterUri, parseSquadrulesUri } from './kairos-uri.js';
import { mcpLooseToolInput } from './mcp-loose-input-schema.js';
import { mcpToolInputValidationErrorResult } from './mcp-tool-input-teaching.js';

/** Shared execute: delete memories by URIs. Used by MCP tool and HTTP route. */
export async function executeDelete(
  qdrantService: QdrantService,
  input: DeleteInput
): Promise<DeleteOutput> {
  const { uris } = input;
  const results: DeleteOutput['results'] = [];
  let totalDeleted = 0;
  let totalFailed = 0;

  for (const uri of uris) {
    try {
      const parsed = parseSquadrulesUri(uri);
      if (parsed.kind === 'adapter') {
        const canonicalAdapterUri = assertWireAdapterUri(uri);
        const canonicalParsed = parseSquadrulesUri(canonicalAdapterUri);
        const slugOutcome = await qdrantService.findFirstStepMemoryUuidBySlug(canonicalParsed.id);
        if (!slugOutcome.layerUuid) {
          throw new Error(`Adapter not found: ${canonicalAdapterUri}`);
        }
        const firstLayer = await qdrantService.getMemoryByUUID(slugOutcome.layerUuid);
        const adapterId =
          typeof firstLayer?.adapter?.id === 'string' && firstLayer.adapter.id.trim().length > 0
            ? firstLayer.adapter.id
            : slugOutcome.layerUuid;
        const layers = await qdrantService.getAdapterLayers(adapterId);
        for (const layer of layers) {
          await qdrantService.deleteMemory(layer.uuid);
          totalDeleted++;
        }
        results.push({
          uri,
          status: 'deleted',
          message: `Adapter ${uri} deleted successfully`
        });
        continue;
      }
      await qdrantService.deleteMemory(parsed.id);
      results.push({
        uri,
        status: 'deleted',
        message: `Adapter layer ${uri} deleted successfully`
      });
      totalDeleted++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.push({
        uri,
        status: 'error',
        message: `Failed to delete adapter resource: ${errorMessage}`
      });
      totalFailed++;
    }
  }

  return {
    results,
    total_deleted: totalDeleted,
    total_failed: totalFailed
  };
}

export function registerDeleteTool(server: any, toolName = 'delete') {
  const qdrantService = qdrantServiceSingleton;
  server.registerTool(
    toolName,
    {
      title: 'Delete SQUADRULES adapter resource',
      description: resolveToolDoc('delete'),
      inputSchema: mcpLooseToolInput(deleteInputSchema),
      outputSchema: deleteOutputSchema
    },
    async (params: unknown) => {
      const tenantId = getTenantId();
      const inputSize = JSON.stringify(params).length;
      mcpToolInputSize.observe({ tool: toolName, tenant_id: tenantId }, inputSize);
      const timer = mcpToolDuration.startTimer({ tool: toolName, tenant_id: tenantId });

      const parsedInput = deleteInputSchema.safeParse(params);
      if (!parsedInput.success) {
        mcpToolCalls.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        mcpToolErrors.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        timer({ tool: toolName, status: 'error', tenant_id: tenantId });
        return mcpToolInputValidationErrorResult('delete', parsedInput.error, params);
      }
      const input = parsedInput.data;

      try {
        const result = await executeDelete(qdrantService, input);
        mcpToolCalls.inc({ tool: toolName, status: 'success', tenant_id: tenantId });
        mcpToolOutputSize.observe({ tool: toolName, tenant_id: tenantId }, JSON.stringify(result).length);
        timer({ tool: toolName, status: 'success', tenant_id: tenantId });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          structuredContent: result
        };
      } catch (error) {
        mcpToolCalls.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        mcpToolErrors.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        timer({ tool: toolName, status: 'error', tenant_id: tenantId });
        throw error;
      }
    }
  );
}
