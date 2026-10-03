// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson } from '../../utils/expect-with-raw.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

const UUID_ADAPTER_URI = 'kairos://adapter/00000000-0000-0000-0000-000000000001';
const SLUG_ADAPTER_URI = 'kairos://adapter/phase-critic';

describe('wire adapter URI contract (slug and UUID accepted)', () => {
  let mcpConnection: Awaited<ReturnType<typeof createMcpConnection>>;

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  }, 60000);

  afterAll(async () => {
    await mcpConnection.close();
  });

  test('forward accepts adapter UUID without input validation error', async () => {
    const result = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: { uri: UUID_ADAPTER_URI }
    });
    const parsed = parseMcpJson(result, 'forward uuid acceptance');
    expect(parsed.error).not.toBe('INVALID_TOOL_INPUT');
  });

  test('forward accepts adapter slug', async () => {
    const result = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: { uri: SLUG_ADAPTER_URI }
    });
    const parsed = parseMcpJson(result, 'forward slug acceptance');
    expect(parsed.error).not.toBe('INVALID_TOOL_INPUT');
  });

  test.each([
    ['tune', { uris: [UUID_ADAPTER_URI], content: ['# tuned'], review_evidence: MOCK_REVIEW_EVIDENCE }],
    ['delete', { uris: [UUID_ADAPTER_URI] }],
    ['export', { uri: UUID_ADAPTER_URI, format: 'markdown' }],
    ['train', { llm_model_id: 'slug-only-test', source_adapter_uri: UUID_ADAPTER_URI, content: '# local content', review_evidence: MOCK_REVIEW_EVIDENCE }]
  ] as const)('%s accepts adapter UUID input without validation rejection', async (toolName, arguments_) => {
    const result = await mcpConnection.client.callTool({
      name: toolName,
      arguments: arguments_ as unknown as Record<string, unknown>
    });
    const content = result.content as Array<{ type: string; text?: string }>;
    const text = content?.[0]?.text ?? '';
    let parsed: Record<string, unknown> | null = null;
    try { parsed = JSON.parse(text); } catch { /* non-JSON is fine */ }
    if (parsed) {
      expect(parsed.error).not.toBe('INVALID_TOOL_INPUT');
    }
  });
});
