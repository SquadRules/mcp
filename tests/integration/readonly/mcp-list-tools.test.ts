import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { withRawOnFail } from '../../utils/expect-with-raw.js';
import { isLikelyToolInputJsonSchema } from '../../utils/mcp-list-tools-schema-helpers.js';
import { SQUADRULES_UI_RESOURCE_URI_FLAT_META_KEY } from '../../../src/mcp-apps/squadrules-ui-constants.js';

describe('MCP Tools Listing', () => {
  let mcpConnection;

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  });

  afterAll(async () => {
    if (mcpConnection) {
      await mcpConnection.close();
    }
  });

  test('tools/list returns valid tool definitions', async () => {
    const result = await mcpConnection.client.listTools({});
    withRawOnFail(result, () => {
      expect(result).toBeDefined();
      expect(result.tools).toBeDefined();
      expect(Array.isArray(result.tools)).toBe(true);

      const tools = result.tools;
      expect(tools.length).toBeGreaterThan(0);

      // Validate schema for each tool
      tools.forEach((tool) => {
        expect(tool).toHaveProperty('name');
        expect(typeof tool.name).toBe('string');
        expect(tool).toHaveProperty('title');
        expect(typeof tool.title).toBe('string');
        expect(tool).toHaveProperty('inputSchema');
        expect(isLikelyToolInputJsonSchema(tool.inputSchema)).toBe(true);
      });

      const names = tools.map((t) => t.name);
      // Current public surface
      expect(names).toContain('train');
      expect(names).toContain('activate');
      expect(names).toContain('forward');
      expect(names).toContain('export');

      const spaces = tools.find((t) => t.name === 'spaces');
      expect(spaces?._meta?.ui?.resourceUri).toBe('ui://squadrules/spaces-result');
      expect(
        (spaces?._meta as Record<string, unknown> | undefined)?.[SQUADRULES_UI_RESOURCE_URI_FLAT_META_KEY]
      ).toBe('ui://squadrules/spaces-result');

      const forwardTool = tools.find((t) => t.name === 'forward');
      expect(forwardTool?._meta?.ui?.resourceUri).toBe('ui://squadrules/forward-result');
      expect(
        (forwardTool?._meta as Record<string, unknown> | undefined)?.[SQUADRULES_UI_RESOURCE_URI_FLAT_META_KEY]
      ).toBe('ui://squadrules/forward-result');

      const activateTool = tools.find((t) => t.name === 'activate');
      expect(activateTool?._meta?.ui?.resourceUri).toBe('ui://squadrules/activate-result');
      expect(
        (activateTool?._meta as Record<string, unknown> | undefined)?.[SQUADRULES_UI_RESOURCE_URI_FLAT_META_KEY]
      ).toBe('ui://squadrules/activate-result');
    }, 'tools/list raw response');
  });
});
