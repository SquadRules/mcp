import type { QdrantService } from '../services/qdrant/service.js';
import type { MemoryQdrantStore } from '../services/memory/store.js';
import { resolveToolDoc } from '../utils/mcp-tool-doc-runtime.js';
import { getTenantId } from '../utils/tenant-context.js';
import { tuneInputSchema, tuneOutputSchema } from './tune_schema.js';
import { mcpToolCalls, mcpToolDuration, mcpToolErrors, mcpToolInputSize, mcpToolOutputSize } from '../services/metrics/mcp-metrics.js';
import { mcpLooseToolInput } from './mcp-loose-input-schema.js';
import { mcpToolInputValidationErrorResult } from './mcp-tool-input-teaching.js';
import { executeTune } from './tune-execute.js';
import { invalidateTuneCache } from './tune-cache-invalidation.js';
import { TOOL_ANNOTATIONS } from './tool-annotations.js';
import { TOOL_ICONS } from './tool-icons.js';

export { executeTune } from './tune-execute.js';

interface RegisterTuneOptions {
  toolName?: string;
  qdrantService?: QdrantService;
}

export function registerTuneTool(server: any, memoryStore: MemoryQdrantStore, options: RegisterTuneOptions = {}) {
  const toolName = options.toolName || 'tune';
  let qdrantService = options.qdrantService ?? null;
  server.registerTool(
    toolName,
    {
      title: 'Update adapter content',
      description: resolveToolDoc('tune') || 'Update adapter layer content. Response contains the updated layer URI, new content hash, and modification timestamp. On success, call forward with the updated adapter to see changes. On failure (layer not found), verify the URI and train a new adapter if needed.',
      inputSchema: mcpLooseToolInput(tuneInputSchema),
      outputSchema: tuneOutputSchema,
      annotations: TOOL_ANNOTATIONS.tune,
      icons: TOOL_ICONS.tune
    },
    async (params: unknown) => {
      const tenantId = getTenantId();
      mcpToolInputSize.observe({ tool: toolName, tenant_id: tenantId }, JSON.stringify(params).length);
      const timer = mcpToolDuration.startTimer({ tool: toolName, tenant_id: tenantId });

      const parsedInput = tuneInputSchema.safeParse(params);
      if (!parsedInput.success) {
        mcpToolCalls.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        mcpToolErrors.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        timer({ tool: toolName, status: 'error', tenant_id: tenantId });
        return mcpToolInputValidationErrorResult('tune', parsedInput.error, params);
      }
      const input = parsedInput.data;

      try {
        if (!qdrantService) {
          const qdrantModule = await import('../services/qdrant/index.js');
          qdrantService = qdrantModule.qdrantService;
        }
        const result = await executeTune(qdrantService, input);

        // Invalidate caches so subsequent reads see the freshly written data.
        await invalidateTuneCache(result);

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
