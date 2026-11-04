import { McpServer } from '@modelcontextprotocol/server';
import type { ServerCapabilities } from '@modelcontextprotocol/server';
import { structuredLogger } from './utils/structured-logger.js';
import { registerDocsResources } from './resources/docs-resources.js';
import { registerPromptResources } from './resources/prompt-resources.js';
import { bootstrapEmptyResourceHandlers } from './resources/resource-bootstrap.js';
import { MemoryQdrantStore } from './services/memory/store.js';
import { qdrantService } from './services/qdrant/index.js';
import { getBuildVersion } from './utils/build-version.js';
import { LOG_LEVEL, LOG_FORMAT, TRANSPORT_TYPE, isQdrantConfigured, getQdrantUrl, getQdrantCollection, QDRANT_API_KEY, QDRANT_RESCORE_STRING, TEI_BASE_URL, TEI_MODEL, SQUADRULES_SEARCH_OVERFETCH_FACTOR, SQUADRULES_SEARCH_MAX_FETCH, SQUADRULES_ENABLE_GROUP_COLLAPSE } from './config.js';
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
import {
  paginateItems,
  buildEmbeddedDocsCacheMetadata,
  buildServerInfoMeta,
  DEFAULT_PAGE_SIZE
} from './utils/pagination.js';
import { getResources, getTemplates } from './resources/embedded-mcp-resources.js';
import { listPromptOfferings } from './resources/prompt-resources.js';

function installStrictToolsListHandler(server: McpServer): void {
  server.server.removeRequestHandler('tools/list');
  server.server.setRequestHandler('tools/list', async (request: any) => {
    const cursor = request?.params?.cursor;
    const allTools = SQUADRULES_TOOL_REGISTRY.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: zodToInputJsonSchema(tool.strictInputSchema) as any,
      outputSchema: zodToOutputJsonSchema(tool.outputSchema) as any,
      ...('uiMeta' in tool && tool.uiMeta ? { _meta: tool.uiMeta } : {}),
      ...('annotations' in tool && tool.annotations ? { annotations: tool.annotations } : {}),
      ...('icons' in tool && tool.icons ? { icons: tool.icons } : {})
    }));
    
    const { page, nextCursor } = paginateItems(allTools, cursor, DEFAULT_PAGE_SIZE);
    const cacheMetadata = buildEmbeddedDocsCacheMetadata();
    
    return {
      resultType: 'complete',
      tools: page,
      nextCursor,
      ttlMs: cacheMetadata.ttlMs,
      cacheScope: cacheMetadata.cacheScope,
      _meta: buildServerInfoMeta()
    } as any;
  });
}

function installPaginatedResourcesListHandler(server: McpServer): void {
  server.server.removeRequestHandler('resources/list');
  server.server.setRequestHandler('resources/list', async (request: any) => {
    const cursor = request?.params?.cursor;
    const resourcesObj = getResources();
    
    // Flatten resources into an array
    const allResources: any[] = [];
    for (const [key, value] of Object.entries(resourcesObj)) {
      if (typeof value === 'string') {
        // Flat resource
        const subdir = 'doc';
        const prefix = `squadrules://${subdir}`;
        const uri = `${prefix}/${key}`;
        const name = key.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
        allResources.push({
          uri,
          name,
          description: `Document: ${name}`,
          mimeType: 'text/markdown'
        });
      } else if (typeof value === 'object' && value !== null) {
        // Nested resources
        const subdir = key;
        const prefix = `squadrules://${subdir}`;
        for (const [filename, content] of Object.entries(value as Record<string, unknown>)) {
          if (typeof content === 'string') {
            const uri = `${prefix}/${filename}`;
            const name = filename.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
            allResources.push({
              uri,
              name,
              description: `${subdir.toUpperCase()}: ${name}`,
              mimeType: 'text/markdown'
            });
          }
        }
      }
    }
    
    // Sort for deterministic order
    allResources.sort((a, b) => a.uri.localeCompare(b.uri));
    
    const { page, nextCursor } = paginateItems(allResources, cursor, DEFAULT_PAGE_SIZE);
    const cacheMetadata = buildEmbeddedDocsCacheMetadata();
    
    return {
      resultType: 'complete',
      resources: page,
      nextCursor,
      ttlMs: cacheMetadata.ttlMs,
      cacheScope: cacheMetadata.cacheScope,
      _meta: buildServerInfoMeta()
    } as any;
  });
}

function installPaginatedResourceTemplatesListHandler(server: McpServer): void {
  server.server.removeRequestHandler('resources/templates/list');
  server.server.setRequestHandler('resources/templates/list', async (request: any) => {
    const cursor = request?.params?.cursor;
    const templatesObj = getTemplates();
    
    // Flatten templates into an array
    const allTemplates: any[] = [];
    for (const [key, value] of Object.entries(templatesObj)) {
      if (typeof value === 'object' && value !== null) {
        const subdir = key;
        for (const [filename, content] of Object.entries(value as Record<string, unknown>)) {
          if (typeof content === 'string') {
            const uriTemplate = `squadrules://${subdir}/${filename}`;
            const name = filename.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
            allTemplates.push({
              uriTemplate,
              name,
              description: `Template: ${name}`,
              mimeType: 'text/markdown'
            });
          }
        }
      }
    }
    
    // Sort for deterministic order
    allTemplates.sort((a, b) => a.uriTemplate.localeCompare(b.uriTemplate));
    
    const { page, nextCursor } = paginateItems(allTemplates, cursor, DEFAULT_PAGE_SIZE);
    const cacheMetadata = buildEmbeddedDocsCacheMetadata();
    
    return {
      resultType: 'complete',
      resourceTemplates: page,
      nextCursor,
      ttlMs: cacheMetadata.ttlMs,
      cacheScope: cacheMetadata.cacheScope,
      _meta: buildServerInfoMeta()
    } as any;
  });
}

function installPaginatedPromptsListHandler(server: McpServer): void {
  server.server.removeRequestHandler('prompts/list');
  server.server.setRequestHandler('prompts/list', async (request: any) => {
    const cursor = request?.params?.cursor;
    const allPrompts = listPromptOfferings();
    
    // Sort for deterministic order
    allPrompts.sort((a, b) => a.name.localeCompare(b.name));
    
    const { page, nextCursor } = paginateItems(allPrompts, cursor, DEFAULT_PAGE_SIZE);
    const cacheMetadata = buildEmbeddedDocsCacheMetadata();
    
    return {
      resultType: 'complete',
      prompts: page,
      nextCursor,
      ttlMs: cacheMetadata.ttlMs,
      cacheScope: cacheMetadata.cacheScope,
      _meta: buildServerInfoMeta()
    } as any;
  });
}

// Create and configure the MCP server
export function createServer(memoryStore: MemoryQdrantStore): McpServer {
    const server = new McpServer(
        {
            name: 'SquadRules',
            version: getBuildVersion()
        },
        {
            // Deliberately omit listChanged and subscribe capabilities: tools,
            // resources, and prompts are static per build (registered once at
            // startup from SQUADRULES_TOOL_REGISTRY and embedded docs). We do
            // not emit notifications/<primitive>/list_changed events, so hosts
            // must not wait for them. See issue #272.
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
    installPaginatedResourcesListHandler(server);
    installPaginatedResourceTemplatesListHandler(server);
    installPaginatedPromptsListHandler(server);
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
        qdrant: isQdrantConfigured
            ? {
                url: getQdrantUrl(),
                collection: getQdrantCollection(),
                apiKey: mask(QDRANT_API_KEY),
                rescore: QDRANT_RESCORE_STRING,
            }
            : { backend: 'embedded-lancedb' },
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
