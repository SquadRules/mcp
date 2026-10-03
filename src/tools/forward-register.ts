import type { MemoryQdrantStore } from '../services/memory/store.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { resolveToolDoc } from '../utils/mcp-tool-doc-runtime.js';
import { getTenantId } from '../utils/tenant-context.js';
import { mcpToolCalls, mcpToolDuration, mcpToolErrors, mcpToolInputSize, mcpToolOutputSize } from '../services/metrics/mcp-metrics.js';
import { SQUADRULES_FORWARD_TOOL_UI_META } from '../mcp-apps/squadrules-ui-constants.js';
import { forwardInputSchema, forwardMcpWireInputSchema, forwardOutputSchema } from './forward_schema.js';
import { executeForward } from './forward.js';
import { formatForwardToolError } from './forward-tool-error.js';
import { SquadrulesError } from '../types/index.js';
import { mcpToolInputValidationErrorResult } from './mcp-tool-input-teaching.js';

export interface RegisterForwardOptions {
  toolName?: string;
  qdrantService?: QdrantService;
}

export function registerForwardTool(server: any, memoryStore: MemoryQdrantStore, options: RegisterForwardOptions = {}): void {
  const toolName = options.toolName || 'forward';
  const qdrantService = options.qdrantService;

  server.registerTool(
    toolName,
    {
      title: 'Run adapter forward pass',
      description: resolveToolDoc('forward') || 'Run the first or next adapter layer. Omit `solution` on the first call in a run.',
      inputSchema: forwardMcpWireInputSchema,
      outputSchema: forwardOutputSchema,
      _meta: SQUADRULES_FORWARD_TOOL_UI_META
    },
    async (params: unknown) => {
      const tenantId = getTenantId();
      mcpToolInputSize.observe({ tool: toolName, tenant_id: tenantId }, JSON.stringify(params).length);
      const timer = mcpToolDuration.startTimer({ tool: toolName, tenant_id: tenantId });

      const parsedInput = forwardInputSchema.safeParse(params);
      if (!parsedInput.success) {
        mcpToolCalls.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        mcpToolErrors.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        timer({ tool: toolName, status: 'error', tenant_id: tenantId });
        return mcpToolInputValidationErrorResult('forward', parsedInput.error, params);
      }
      const input = parsedInput.data;

      try {
        const output = await executeForward(server, memoryStore, qdrantService, input);
        mcpToolCalls.inc({ tool: toolName, status: 'success', tenant_id: tenantId });
        mcpToolOutputSize.observe({ tool: toolName, tenant_id: tenantId }, JSON.stringify(output).length);
        timer({ tool: toolName, status: 'success', tenant_id: tenantId });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(output) }],
          structuredContent: output
        };
      } catch (error) {
        mcpToolCalls.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        mcpToolErrors.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        timer({ tool: toolName, status: 'error', tenant_id: tenantId });
        if (error instanceof SquadrulesError) {
          return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(formatForwardToolError(error)) }] };
        }
        throw error;
      }
    }
  );
}
