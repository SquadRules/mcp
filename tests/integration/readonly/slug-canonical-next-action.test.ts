// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson } from '../../utils/expect-with-raw.js';

const ADAPTER_SLUG_URI_RE = /^kairos:\/\/adapter\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const LAYER_URI_RE = /^kairos:\/\/layer\/[0-9a-f-]{36}(?:\?execution_id=[0-9a-f-]{36})?$/i;

function extractSquadrulesUris(text: string): string[] {
  return text.match(/kairos:\/\/[a-z0-9/?=_-]+/gi) ?? [];
}

describe('next_action URI canonicalization', () => {
  let mcpConnection: Awaited<ReturnType<typeof createMcpConnection>>;

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  }, 60000);

  afterAll(async () => {
    await mcpConnection.close();
  });

  test('activate and forward next_action prose never emits adapter UUID URIs', async () => {
    const activateResult = await mcpConnection.client.callTool({
      name: 'activate',
      arguments: { query: 'refine protocol search query' }
    });
    const activatePayload = parseMcpJson(activateResult, 'activate canonical prose');

    const prose: string[] = [String(activatePayload.next_action ?? '')];
    for (const choice of activatePayload.choices as Array<Record<string, unknown>>) {
      prose.push(String(choice.next_action ?? ''));
    }

    const forwardResult = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: { uri: 'kairos://adapter/refine-search' }
    });
    const forwardPayload = parseMcpJson(forwardResult, 'forward canonical prose');
    prose.push(String(forwardPayload.next_action ?? ''));

    const uris = prose.flatMap((p) => extractSquadrulesUris(p));
    for (const uri of uris) {
      expect(ADAPTER_SLUG_URI_RE.test(uri) || LAYER_URI_RE.test(uri)).toBe(true);
      expect(uri).not.toMatch(/^kairos:\/\/adapter\/[0-9a-f-]{36}$/i);
    }
  });
});
