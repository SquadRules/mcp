import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { structuredLogger } from './utils/structured-logger.js';
import { registerDocsResources } from './resources/docs-resources.js';
import { registerPromptResources } from './resources/prompt-resources.js';
import { bootstrapEmptyResourceHandlers } from './resources/resource-bootstrap.js';
import { MemoryQdrantStore } from './services/memory/store.js';
import { qdrantService } from './services/qdrant/index.js';
import { getBuildVersion } from './utils/build-version.js';
import { LOG_LEVEL, LOG_FORMAT, TRANSPORT_TYPE, getQdrantUrl, getQdrantCollection, QDRANT_API_KEY, QDRANT_RESCORE_STRING, TEI_BASE_URL, TEI_MODEL, SQUADRULES_SEARCH_OVERFETCH_FACTOR, SQUADRULES_SEARCH_MAX_FETCH, SQUADRULES_ENABLE_GROUP_COLLAPSE } from './config.js';
import { getEmbeddingDimension } from './services/embedding/config.js';
// removed: debug tools (kb_version, kb_cache_stats)
import { registerDeleteTool } from './tools/delete.js';
import { squadrulesServerUiCapabilityBlock } from './mcp-apps/squadrules-server-ui-capability.js';
import { registerActivateUiResources } from './mcp-apps/register-activate-ui-resources.js';
import { registerForwardUiResources } from './mcp-apps/register-forward-ui-resources.js';
import { registerSpacesUiResources } from './mcp-apps/register-spaces-ui-resources.js';
import { registerSpacesTool } from './tools/spaces.js';
import { registerActivateTool } from './tools/activate.js';
import { registerForwardTool } from './tools/forward-register.js';
import { registerTrainTool } from './tools/train.js';
import { registerRewardTool } from './tools/reward.js';
import { registerTuneTool } from './tools/tune.js';
import { registerExportTool } from './tools/export.js';
import { zodToInputJsonSchema, zodToOutputJsonSchema } from './utils/zod-to-jsonschema.js';
import { SQUADRULES_TOOL_REGISTRY } from './tools/tool-registry.js';

function installStrictToolsListHandler(server: McpServer): void {
  server.server.removeRequestHandler('tools/list');
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: SQUADRULES_TOOL_REGISTRY.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: zodToInputJsonSchema(tool.strictInputSchema),
      outputSchema: zodToOutputJsonSchema(tool.outputSchema),
      ...('uiMeta' in tool && tool.uiMeta ? { _meta: tool.uiMeta } : {})
    }))
  }));
}

// Create and configure the MCP server
export function createServer(memoryStore: MemoryQdrantStore): McpServer {
    const server = new McpServer(
        {
            name: 'SquadRules',
            version: getBuildVersion()
        },
        {
            capabilities: {
                tools: {},
                resources: {},
                prompts: {},
                ...squadrulesServerUiCapabilityBlock
            } as ServerCapabilities
        }
    );

    // Register the current MCP tools.
    registerActivateTool(server, memoryStore, { qdrantService });
    registerForwardTool(server, memoryStore, { qdrantService });
    registerTrainTool(server, memoryStore, { qdrantService });
    registerRewardTool(server, qdrantService);
    registerTuneTool(server, memoryStore, { qdrantService });
    registerDeleteTool(server, 'delete');
    registerExportTool(server, memoryStore, { qdrantService });
    registerSpacesTool(server, memoryStore, { toolName: 'spaces' });
    installStrictToolsListHandler(server);
    registerSpacesUiResources(server);
    registerForwardUiResources(server);
    registerActivateUiResources(server);

    // Register resources
    bootstrapEmptyResourceHandlers(server);
    // Register docs resources (from embedded-mcp-resources)
    registerDocsResources(server);

    // Register prompts (from embedded-mcp-resources)
    registerPromptResources(server);

    // Log runtime configuration (mask secrets)
    const mask = (v?: string) => (v ? `${v.slice(0, 2)}***${v.slice(-2)}` : undefined);
    const config = {
        log: {
            level: LOG_LEVEL,
            format: LOG_FORMAT,
        },
        transport: {
            type: TRANSPORT_TYPE,
        },
        qdrant: {
            url: getQdrantUrl(),
            collection: getQdrantCollection(),
            apiKey: mask(QDRANT_API_KEY),
            rescore: QDRANT_RESCORE_STRING,
        },
        tei: {
            url: TEI_BASE_URL,
            model: TEI_MODEL,
            dim_env: getEmbeddingDimension(),
        },
        search: {
            overfetch: SQUADRULES_SEARCH_OVERFETCH_FACTOR,
            maxFetch: SQUADRULES_SEARCH_MAX_FETCH,
            groupCollapse: SQUADRULES_ENABLE_GROUP_COLLAPSE
        },
    };
    structuredLogger.debug(`runtime config ${JSON.stringify(config)}`);
    structuredLogger.debug('MCP server created and configured');
    return server;
}
