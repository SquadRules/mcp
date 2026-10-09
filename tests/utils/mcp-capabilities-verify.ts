/**
 * Shared MCP server capabilities verification.
 * Validates all cacheable operations per the 2026-07-28 spec:
 * tools/list, resources/list, resources/read, resources/templates/list, prompts/list.
 *
 * Used by both stdio and HTTP integration tests to ensure transport parity.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { withRawOnFail } from './expect-with-raw.js';

/** Validate caching hints (ttlMs, cacheScope) per 2026-07-28 spec if present. */
function assertCachingHints(result: Record<string, unknown>): void {
  if ('ttlMs' in result && result.ttlMs !== undefined) {
    expect(Number(result.ttlMs)).toBeGreaterThanOrEqual(0);
  }
  if ('cacheScope' in result && result.cacheScope !== undefined) {
    expect(['public', 'private']).toContain(result.cacheScope);
  }
}

/**
 * Comprehensive MCP server capabilities verification.
 * Checks server capabilities, version, tools, resources, resource read,
 * resource templates, and prompts — with caching hint validation on each.
 *
 * Note: server/discover (2026-07-28 spec) is not yet available in the
 * current SDK (protocol 2025-11-25); will add when the SDK upgrades.
 */
export async function verifyMcpServerCapabilities(client: Client): Promise<void> {
  // ── 1. Server capabilities (initialize response) ──────────────
  const caps = client.getServerCapabilities();
  withRawOnFail(caps, () => {
    expect(caps).toBeDefined();
    expect(caps!.tools).toBeDefined();
    expect(caps!.resources).toBeDefined();
    expect(caps!.prompts).toBeDefined();
  }, 'server capabilities');

  // ── 2. Server version info ────────────────────────────────────
  const serverVersion = client.getServerVersion();
  withRawOnFail(serverVersion, () => {
    expect(serverVersion).toBeDefined();
    expect(serverVersion!.name).toBe('SquadRules');
    expect(typeof serverVersion!.version).toBe('string');
    expect(serverVersion!.version.length).toBeGreaterThan(0);
  }, 'server version');

  // ── 3. tools/list ─────────────────────────────────────────────
  let toolsResult;
  try {
    toolsResult = await client.listTools();
  } catch (e: any) {
    throw new Error(`[tools/list] ${e?.message ?? e}`);
  }
  withRawOnFail(toolsResult, () => {
    expect(Array.isArray(toolsResult.tools)).toBe(true);
    expect(toolsResult.tools.length).toBeGreaterThan(0);

    const names = toolsResult.tools.map((t) => t.name);
    // Core workflow tools
    expect(names).toContain('activate');
    expect(names).toContain('forward');
    expect(names).toContain('reward');
    expect(names).toContain('train');
    expect(names).toContain('tune');
    // Utility tools
    expect(names).toContain('delete');
    expect(names).toContain('export');
    expect(names).toContain('spaces');

    for (const tool of toolsResult.tools) {
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
      expect(tool).toHaveProperty('inputSchema');
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
      if (tool.description !== undefined) {
        expect(typeof tool.description).toBe('string');
      }
    }

    assertCachingHints(toolsResult as Record<string, unknown>);
  }, 'tools/list');

  // ── 4. resources/list ─────────────────────────────────────────
  let resourcesResult;
  try {
    resourcesResult = await client.listResources();
  } catch (e: any) {
    throw new Error(`[resources/list] ${e?.message ?? e}`);
  }
  withRawOnFail(resourcesResult, () => {
    expect(Array.isArray(resourcesResult.resources)).toBe(true);
    expect(resourcesResult.resources.length).toBeGreaterThan(0);

    for (const res of resourcesResult.resources) {
      expect(typeof res.uri).toBe('string');
      expect(res.uri.length).toBeGreaterThan(0);
      expect(typeof res.name).toBe('string');
      expect(res.name.length).toBeGreaterThan(0);
    }

    assertCachingHints(resourcesResult as Record<string, unknown>);
  }, 'resources/list');

  // ── 4b. resources/read ────────────────────────────────────────
  if (resourcesResult.resources.length > 0) {
    const firstUri = resourcesResult.resources[0].uri;
    let readResult;
    try {
      readResult = await client.readResource({ uri: firstUri });
    } catch (e: any) {
      throw new Error(`[resources/read uri=${firstUri}] ${e?.message ?? e}`);
    }
    withRawOnFail(readResult, () => {
      expect(Array.isArray(readResult.contents)).toBe(true);
      expect(readResult.contents.length).toBeGreaterThan(0);
      for (const content of readResult.contents) {
        expect(typeof content.uri).toBe('string');
        expect(content.uri.length).toBeGreaterThan(0);
      }

      assertCachingHints(readResult as Record<string, unknown>);
    }, 'resources/read');
  }

  // ── 5. resources/templates/list ───────────────────────────────
  let templatesResult;
  try {
    templatesResult = await client.listResourceTemplates();
  } catch (e: any) {
    throw new Error(`[resources/templates/list] ${e?.message ?? e}`);
  }
  withRawOnFail(templatesResult, () => {
    expect(Array.isArray(templatesResult.resourceTemplates)).toBe(true);
    for (const tmpl of templatesResult.resourceTemplates) {
      expect(typeof tmpl.uriTemplate).toBe('string');
      expect(tmpl.uriTemplate.length).toBeGreaterThan(0);
      expect(typeof tmpl.name).toBe('string');
      expect(tmpl.name.length).toBeGreaterThan(0);
    }

    assertCachingHints(templatesResult as Record<string, unknown>);
  }, 'resources/templates/list');

  // ── 6. prompts/list ───────────────────────────────────────────
  let promptsResult;
  try {
    promptsResult = await client.listPrompts();
  } catch (e: any) {
    throw new Error(`[prompts/list] ${e?.message ?? e}`);
  }
  withRawOnFail(promptsResult, () => {
    expect(Array.isArray(promptsResult.prompts)).toBe(true);
    for (const prompt of promptsResult.prompts) {
      expect(typeof prompt.name).toBe('string');
      expect(prompt.name.length).toBeGreaterThan(0);
    }

    assertCachingHints(promptsResult as Record<string, unknown>);
  }, 'prompts/list');
}
