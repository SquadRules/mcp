import { mcpResources } from '../../../src/resources/embedded-mcp-resources.js';
import { createMcpConnection } from '../../utils/mcp-client-utils.js';

describe('Embedded MCP Resources', () => {
  test('mcpResources.prompts is empty (contextual prompt removed — SKILL.md owns routing)', () => {
    expect(mcpResources).toHaveProperty('prompts');
    expect(typeof mcpResources.prompts).toBe('object');
    expect(Object.keys(mcpResources.prompts)).toHaveLength(0);
  });

  test('mcpResources contains tools', () => {
    expect(mcpResources).toHaveProperty('tools');
    expect(Object.keys(mcpResources.tools).length).toBeGreaterThan(0);
    for (const [, content] of Object.entries(mcpResources.tools)) {
      expect(typeof content).toBe('string');
      expect(content.length).toBeGreaterThan(10);
    }
  });

  test('mcpResources.templates stays empty when no templates are registered', () => {
    expect(mcpResources).toHaveProperty('templates');
    expect(typeof mcpResources.templates).toBe('object');
    expect(Object.keys(mcpResources.templates)).toHaveLength(0);
  });
});

describe('Special static memory resources', () => {
  test('mcpResources.mem is empty (mem files are read from filesystem at runtime)', () => {
    expect(mcpResources).toHaveProperty('mem');
    const mem = mcpResources.mem;
    expect(typeof mem).toBe('object');
    // mem/ files are now read from filesystem at runtime in mem-resources-boot.ts
    // They are no longer embedded in the generated file
    expect(Object.keys(mem).length).toBe(0);
  });
});

describe('MCP Tools and Resources', () => {
  let mcp;

  beforeAll(async () => {
    mcp = await createMcpConnection();
  }, 45000);

  afterAll(async () => {
    if (mcp) await mcp.close();
  });
  
  test('tools match mcpResources.tools (each tool has non-empty description; exact text may differ if server build differs)', async () => {
    const tools = await mcp.client.listTools();
    const toolNames = Object.keys(mcpResources.tools);
    expect(tools.tools).toHaveLength(toolNames.length);
    for (const name of toolNames) {
      const tool = tools.tools.find(t => t.name === name);
      expect(tool).toBeDefined();
      expect(typeof tool?.description).toBe('string');
      expect(tool?.description.length).toBeGreaterThan(20);
    }
  }, 30000);

  test('resources/templates/list returns empty array when no templates are registered', async () => {
    const templates = await mcp.client.listResourceTemplates();
    expect(Array.isArray(templates.resourceTemplates)).toBe(true);
    expect(templates.resourceTemplates.length).toBe(0);
  }, 30000);
});

