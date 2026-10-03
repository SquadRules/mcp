// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson, withRawOnFail } from '../../utils/expect-with-raw.js';

/**
 * CASE 4 — NO RELEVANT RESULTS (score < 0.5 or none)
 * → Offer to create — never hallucinate
 * 
 * Tests from reports/outputs.md
 */

describe('Squadrules Search - CASE 4: NO RELEVANT RESULTS', () => {
  let mcpConnection;

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  });

  afterAll(async () => {
    if (mcpConnection) {
      await mcpConnection.close();
    }
  });

  function expectValidJsonResult(result) {
    return parseMcpJson(result, 'activate raw MCP result');
  }

  test('returns V2 unified schema with no matches — only create choice', async () => {
    // Use a completely random query that should not match anything
    const ts = Date.now();
    const gibberishQuery = `XyZ123AbC789GarbageQuery${ts}NoOneWouldEverSearchForThisRandomString`;

    const call = {
      name: 'activate',
      arguments: {
        query: gibberishQuery
      }
    };
    const result = await mcpConnection.client.callTool(call);

    withRawOnFail({ call, result }, () => {
      const parsed = expectValidJsonResult(result);

      // V2 unified schema — must_obey is ALWAYS true
      expect(parsed.must_obey).toBe(true);


      // message: always present
      expect(parsed.message).toBeDefined();
      expect(typeof parsed.message).toBe('string');

      // next_action: always present
      expect(parsed.next_action).toBeDefined();
      expect(typeof parsed.next_action).toBe('string');

      // choices: always an array with at least one entry; no relevant results must offer create
      expect(Array.isArray(parsed.choices)).toBe(true);
      expect(parsed.choices.length).toBeGreaterThanOrEqual(1);

      const createChoices = parsed.choices.filter((c) => c.role === 'create');
      const relevantMatches = parsed.choices.filter((c) => {
        if (c.role !== 'match') return false;
        const s = (c as { activation_score?: number | null }).activation_score ?? c.score ?? 0;
        return (s as number) >= 0.5;
      });
      expect(createChoices.length >= 1 || relevantMatches.length >= 1).toBe(true);
      if (relevantMatches.length === 0) {
        expect(createChoices.length).toBeGreaterThanOrEqual(1);
      }
      for (const cc of createChoices) {
        expect(cc.uri).toBeDefined();
        expect(typeof cc.uri).toBe('string');
        expect(cc.uri.startsWith('kairos://adapter/')).toBe(true);
        expect(cc.role).toBe('create');
      }

      // Old fields must be absent
      expect(parsed.protocol_status).toBeUndefined();
      expect(parsed.start_here).toBeUndefined();
      expect(parsed.adapter_name).toBeUndefined();
      expect(parsed.total_steps).toBeUndefined();
      expect(parsed.best_match).toBeUndefined();
      expect(parsed.suggestion).toBeUndefined();
      expect(parsed.hint).toBeUndefined();
    }, 'CASE 4 test');
  }, 20000);
});

