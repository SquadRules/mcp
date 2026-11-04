import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { withRawOnFail } from '../../utils/expect-with-raw.js';

describe('MCP List Pagination and Cache Metadata', () => {
  let mcpConnection;

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  });

  afterAll(async () => {
    if (mcpConnection) {
      await mcpConnection.close();
    }
  });

  describe('tools/list', () => {
    test('returns paginated response with cache metadata', async () => {
      const result = await mcpConnection.client.listTools({});
      withRawOnFail(result, () => {
        expect(result).toBeDefined();
        expect(result.tools).toBeDefined();
        expect(Array.isArray(result.tools)).toBe(true);
        
        // Check for pagination fields (2026-07-28 spec)
        expect(result).toHaveProperty('resultType');
        expect(result.resultType).toBe('complete');
        
        // Check for cache metadata
        expect(result).toHaveProperty('ttlMs');
        expect(result).toHaveProperty('cacheScope');
        expect(typeof result.ttlMs).toBe('number');
        expect(result.ttlMs).toBeGreaterThan(0);
        expect(['public', 'private']).toContain(result.cacheScope);
        
        // Tools list should have cacheScope: public (embedded docs)
        expect(result.cacheScope).toBe('public');
      }, 'tools/list pagination response');
    });

    test('supports cursor pagination', async () => {
      // First page
      const page1 = await mcpConnection.client.listTools({});
      expect(page1.tools).toBeDefined();
      
      // If there's a nextCursor, fetch second page
      if (page1.nextCursor) {
        const page2 = await mcpConnection.client.listTools({ 
          cursor: page1.nextCursor 
        });
        expect(page2.tools).toBeDefined();
        
        // Verify no overlap between pages
        const page1Names = new Set(page1.tools.map(t => t.name));
        const page2Names = page2.tools.map(t => t.name);
        for (const name of page2Names) {
          expect(page1Names.has(name)).toBe(false);
        }
      }
    });
  });

  describe('resources/list', () => {
    test('returns paginated response with cache metadata', async () => {
      const result = await mcpConnection.client.listResources({});
      withRawOnFail(result, () => {
        expect(result).toBeDefined();
        expect(result.resources).toBeDefined();
        expect(Array.isArray(result.resources)).toBe(true);
        
        // Check for pagination fields
        expect(result).toHaveProperty('resultType');
        expect(result.resultType).toBe('complete');
        
        // Check for cache metadata
        expect(result).toHaveProperty('ttlMs');
        expect(result).toHaveProperty('cacheScope');
        expect(typeof result.ttlMs).toBe('number');
        expect(result.ttlMs).toBeGreaterThan(0);
        expect(['public', 'private']).toContain(result.cacheScope);
        
        // Resources list should have cacheScope: public (embedded docs)
        expect(result.cacheScope).toBe('public');
      }, 'resources/list pagination response');
    });

    test('returns resources in deterministic order', async () => {
      const result1 = await mcpConnection.client.listResources({});
      const result2 = await mcpConnection.client.listResources({});
      
      const uris1 = result1.resources.map(r => r.uri);
      const uris2 = result2.resources.map(r => r.uri);
      
      expect(uris1).toEqual(uris2);
    });

    test('supports cursor pagination', async () => {
      const page1 = await mcpConnection.client.listResources({});
      expect(page1.resources).toBeDefined();
      
      if (page1.nextCursor) {
        const page2 = await mcpConnection.client.listResources({ 
          cursor: page1.nextCursor 
        });
        expect(page2.resources).toBeDefined();
        
        // Verify no overlap
        const page1Uris = new Set(page1.resources.map(r => r.uri));
        for (const resource of page2.resources) {
          expect(page1Uris.has(resource.uri)).toBe(false);
        }
      }
    });
  });

  describe('resources/templates/list', () => {
    test('returns paginated response with cache metadata', async () => {
      const result = await mcpConnection.client.listResourceTemplates({});
      withRawOnFail(result, () => {
        expect(result).toBeDefined();
        expect(result.resourceTemplates).toBeDefined();
        expect(Array.isArray(result.resourceTemplates)).toBe(true);
        
        // Check for pagination fields
        expect(result).toHaveProperty('resultType');
        expect(result.resultType).toBe('complete');
        
        // Check for cache metadata
        expect(result).toHaveProperty('ttlMs');
        expect(result).toHaveProperty('cacheScope');
        expect(typeof result.ttlMs).toBe('number');
        expect(result.ttlMs).toBeGreaterThan(0);
        expect(['public', 'private']).toContain(result.cacheScope);
        
        // Resource templates should have cacheScope: public
        expect(result.cacheScope).toBe('public');
      }, 'resources/templates/list pagination response');
    });
  });

  describe('prompts/list', () => {
    test('returns paginated response with cache metadata', async () => {
      const result = await mcpConnection.client.listPrompts({});
      withRawOnFail(result, () => {
        expect(result).toBeDefined();
        expect(result.prompts).toBeDefined();
        expect(Array.isArray(result.prompts)).toBe(true);
        
        // Check for pagination fields
        expect(result).toHaveProperty('resultType');
        expect(result.resultType).toBe('complete');
        
        // Check for cache metadata
        expect(result).toHaveProperty('ttlMs');
        expect(result).toHaveProperty('cacheScope');
        expect(typeof result.ttlMs).toBe('number');
        expect(result.ttlMs).toBeGreaterThan(0);
        expect(['public', 'private']).toContain(result.cacheScope);
        
        // Prompts list should have cacheScope: public (embedded docs)
        expect(result.cacheScope).toBe('public');
      }, 'prompts/list pagination response');
    });

    test('returns prompts in deterministic order', async () => {
      const result1 = await mcpConnection.client.listPrompts({});
      const result2 = await mcpConnection.client.listPrompts({});
      
      const names1 = result1.prompts.map(p => p.name);
      const names2 = result2.prompts.map(p => p.name);
      
      expect(names1).toEqual(names2);
    });
  });

  describe('cache metadata correctness', () => {
    test('embedded docs have public cache scope', async () => {
      const [tools, resources, prompts] = await Promise.all([
        mcpConnection.client.listTools({}),
        mcpConnection.client.listResources({}),
        mcpConnection.client.listPrompts({})
      ]);
      
      // All embedded doc lists should have public cache scope
      expect(tools.cacheScope).toBe('public');
      expect(resources.cacheScope).toBe('public');
      expect(prompts.cacheScope).toBe('public');
      
      // TTL should be reasonable (5 minutes for embedded docs)
      expect(tools.ttlMs).toBe(300_000);
      expect(resources.ttlMs).toBe(300_000);
      expect(prompts.ttlMs).toBe(300_000);
    });
  });
});
