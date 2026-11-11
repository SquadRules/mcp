import type { QdrantService } from '../services/qdrant/service.js';
import { qdrantService as qdrantServiceSingleton } from '../services/qdrant/index.js';
import { resolveToolDoc } from '../utils/mcp-tool-doc-runtime.js';
import { mcpToolCalls, mcpToolDuration, mcpToolErrors, mcpToolInputSize, mcpToolOutputSize } from '../services/metrics/mcp-metrics.js';
import { getTenantId } from '../utils/tenant-context.js';
import { deleteInputSchema, deleteOutputSchema, type DeleteInput, type DeleteOutput } from './delete_schema.js';
import { assertWireAdapterUri, parseSquadrulesUri } from './squadrules-uri.js';
import { mcpLooseToolInput } from './mcp-loose-input-schema.js';
import { mcpToolInputValidationErrorResult } from './mcp-tool-input-teaching.js';
import { TOOL_ANNOTATIONS } from './tool-annotations.js';
import { TOOL_ICONS } from './tool-icons.js';
import { getGraphDb } from '../services/graph-db/graph-owner.js';
import { storedAdapterScope } from '../services/graph-db/adapter-scope.js';
import type { AdapterChildRef } from '../services/graph-db/graph-types.js';
import { structuredLogger } from '../utils/structured-logger.js';

/**
 * Name the dependents of one adapter, saying when they do not all share its scope.
 *
 * A child stored in another space is a different adapter with the same slug, so its
 * scope is part of its identity here: without it the operator would look for it in
 * the adapter's own space and not find it.
 */
function describeDependents(
  children: AdapterChildRef[],
  parentSpaceId: string
): { list: string; crossScope: boolean } {
  const crossScope = children.some((child) => child.space !== parentSpaceId);
  const names = children.map((child) =>
    child.space === parentSpaceId ? child.slug : `${child.slug} (in ${child.space || 'unknown scope'})`
  );
  return { list: names.join(', '), crossScope };
}

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
        const slug = canonicalParsed.id;

        const slugOutcome = await qdrantService.findFirstStepMemoryUuidBySlug(slug);
        if (!slugOutcome.layerUuid) {
          throw new Error(`Adapter not found: ${canonicalAdapterUri}`);
        }
        const firstLayer = await qdrantService.getMemoryByUUID(slugOutcome.layerUuid);
        const adapterId =
          typeof firstLayer?.adapter?.id === 'string' && firstLayer.adapter.id.trim().length > 0
            ? firstLayer.adapter.id
            : slugOutcome.layerUuid;

        // Touchpoint 5: inheritance precondition check.
        // Refuse to delete when other adapters inherit from this one. The check runs
        // after the record is loaded because the node key is scoped by the space the
        // adapter is stored in — the same slug in another space is a different node.
        // Graceful degradation: if graph DB is unavailable or throws, log and continue.
        try {
          const graphDb = getGraphDb(qdrantService);
          if (graphDb) {
            const scope = storedAdapterScope(
              typeof firstLayer?.space_id === 'string' ? firstLayer.space_id : undefined,
              'delete'
            );
            const children = await graphDb.getChildren(scope.spaceId, slug);
            if (children.length > 0) {
              const dependents = describeDependents(children, scope.spaceId);
              const guidance = dependents.crossScope
                ? 'Dependents are stored in more than one scope; remove or reparent each dependent in its own scope first.'
                : 'Remove or reparent the dependents first.';
              results.push({
                uri,
                status: 'error',
                message: `Cannot delete adapter '${slug}': ${children.length} adapter(s) inherit from it: ${dependents.list}. ${guidance}`
              });
              totalFailed++;
              continue;
            }
          } else {
            structuredLogger.warn(`delete: graph DB unavailable, skipping inheritance precondition check for '${slug}'`);
          }
        } catch (graphErr) {
          const graphErrMsg = graphErr instanceof Error ? graphErr.message : String(graphErr);
          structuredLogger.warn(`delete: inheritance precondition check failed for '${slug}' (${graphErrMsg}) — continuing with delete`);
        }
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
      description: resolveToolDoc('delete') || 'Delete an adapter or layer by URI. Response contains deletion results per URI with status and message. On success, the resource is removed and subsequent activate calls will not find it. On failure (resource not found), verify the URI or check if already deleted.',
      inputSchema: mcpLooseToolInput(deleteInputSchema),
      outputSchema: deleteOutputSchema,
      annotations: TOOL_ANNOTATIONS.delete,
      icons: TOOL_ICONS.delete
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
