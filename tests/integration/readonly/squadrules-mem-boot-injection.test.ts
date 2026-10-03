/**
 * Integration tests for mem boot injection.
 * Injection runs at server start (injectMemResourcesAtBoot). This test confirms adapters loaded at boot
 * by calling spaces and asserting the Squadrules app space (squadrules_dev) has at least 2 adapters
 * (the two mem files in src/embed-docs/mem/). Uses normal MCP connection (auth when enabled).
 * Requires dev server (npm run dev:deploy).
 */

import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson } from '../../utils/expect-with-raw.js';

const SQUADRULES_APP_SPACE_NAME = 'Squadrules app';
const EXPECTED_BOOT_ADAPTER_COUNT = 6;
const STATIC_SYSTEM_ADAPTERS: Array<{ slug: string }> = [
  { slug: 'create-new-protocol' },
  { slug: 'refine-search' },
  { slug: 'challenge-type-guide' },
  { slug: 'phase-critic' },
  { slug: 'protocol-linking-guide' },
];

describe('Mem boot injection', () => {
  let mcpConnection: Awaited<ReturnType<typeof createMcpConnection>>;

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  }, 45000);

  afterAll(async () => {
    if (mcpConnection) await mcpConnection.close();
  });

  test('spaces shows Squadrules app space with static system adapters (boot-injected mem)', async () => {
    const result = await mcpConnection.client.callTool({
      name: 'spaces',
      arguments: { include_adapter_titles: true }
    });
    if (result.isError === true && result.content?.[0]) {
      const errText = (result.content[0] as { text?: string }).text ?? String(result.content[0]);
      throw new Error(`spaces failed: ${errText}`);
    }
    expect(result.isError).not.toBe(true);
    const parsed = parseMcpJson(result, 'spaces');
    expect(parsed).toHaveProperty('spaces');
    expect(Array.isArray(parsed.spaces)).toBe(true);

    const appSpace = (parsed.spaces as Array<{ name: string; adapter_count: number; adapters?: Array<{ adapter_id: string; title: string; layer_count: number }> }>).find(
      (s) => s.name === SQUADRULES_APP_SPACE_NAME
    );
    expect(appSpace).toBeDefined();
    expect(appSpace!.adapter_count).toBeGreaterThanOrEqual(
      EXPECTED_BOOT_ADAPTER_COUNT,
      `Squadrules app space should have at least ${EXPECTED_BOOT_ADAPTER_COUNT} adapters from mem boot (mem/ dir)`
    );

  }, 30000);

  test('static system adapters are exportable by slug URI', async () => {
    for (const expected of STATIC_SYSTEM_ADAPTERS) {
      const uri = `squadrules://adapter/${expected.slug}`;
      const result = await mcpConnection.client.callTool({
        name: 'export',
        arguments: { uri, format: 'markdown' }
      });

      if (result.isError === true && result.content?.[0]) {
        const errText = (result.content[0] as { text?: string }).text ?? String(result.content[0]);
        throw new Error(`export failed for ${expected.slug}: ${errText}`);
      }

      expect(result.isError).not.toBe(true);
      const parsed = parseMcpJson(result, 'export');
      expect(parsed.uri).toBe(uri);
      expect(typeof parsed.content).toBe('string');
      expect(parsed.content.length).toBeGreaterThan(100);
    }
  }, 30000);
});
