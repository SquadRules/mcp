// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson, withRawOnFail } from '../../utils/expect-with-raw.js';
import { buildProofMarkdown } from '../../utils/proof-of-work.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

/**
 * CASE 2 — MULTIPLE PERFECT MATCHES (score = 1.0 × N)
 * → Positive choice — never force
 * 
 * Tests from reports/outputs.md
 */

describe('Squadrules Search - CASE 2: MULTIPLE PERFECT MATCHES', () => {
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

  test('returns V2 unified schema with multiple perfect matches in choices', async () => {
    const ts = Date.now();
    const queryString = `MultiplePerfectMatch ${ts}`;

    // Create 3 protocols with different H1 titles, all containing the query string
    const protocols = [
      buildProofMarkdown(`Protocol A ${queryString}`, [
        { heading: 'Step 1 — Setup', body: `First step for ${queryString}.`, proofCmd: 'echo setup-a' },
        { heading: 'Step 2 — Execute', body: `Second step. This protocol covers ${queryString} implementation.`, proofCmd: 'echo run-a' }
      ]),
      buildProofMarkdown(`Protocol B ${queryString}`, [
        { heading: 'Step 1 — Setup', body: `First step for ${queryString}.`, proofCmd: 'echo setup-b' },
        { heading: 'Step 2 — Execute', body: `Second step. This protocol covers ${queryString} implementation.`, proofCmd: 'echo run-b' }
      ]),
      buildProofMarkdown(`Protocol C ${queryString}`, [
        { heading: 'Step 1 — Setup', body: `First step for ${queryString}.`, proofCmd: 'echo setup-c' },
        { heading: 'Step 2 — Execute', body: `Second step. This protocol covers ${queryString} implementation.`, proofCmd: 'echo run-c' }
      ])
    ];

    // Store all protocols (each with a unique H1 = unique adapter; force_update bypasses similarity in the shared dev collection)
    for (const protocol of protocols) {
      const storeResult = await mcpConnection.client.callTool({
        name: 'train',
        arguments: {
          content: protocol,
          llm_model_id: 'minimax/minimax-m2:free',
          force_update: true,
          review_evidence: MOCK_REVIEW_EVIDENCE
        }
      });
      const storeResponse = expectValidJsonResult(storeResult);
      expect(storeResponse.status).toBe('stored');
    }

    const call = {
      name: 'activate',
      arguments: {
        query: queryString
      }
    };

    // Wait for indexing/caching; poll activate once more if matches are not visible yet (no jest.retryTimes — see v4-activate-test-helpers.ts).
    const initialIndexWaitMs = 3000;
    const retryPollWaitMs = 4000;
    const maxActivatePolls = 2;

    await new Promise((resolve) => setTimeout(resolve, initialIndexWaitMs));

    let result = await mcpConnection.client.callTool(call);
    for (let poll = 1; poll < maxActivatePolls; poll++) {
      const peek = expectValidJsonResult(result);
      const matchCount = (peek.choices ?? []).filter((c) => c.role === 'match').length;
      if (matchCount >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, retryPollWaitMs));
      result = await mcpConnection.client.callTool(call);
    }

    withRawOnFail({ call, result }, () => {
      const parsed = expectValidJsonResult(result);

      // V2 unified schema — must_obey is ALWAYS true
      expect(parsed.must_obey).toBe(true);
      expect(parsed.message).toBeDefined();
      expect(typeof parsed.message).toBe('string');
      expect(parsed.next_action).toBeDefined();
      expect(typeof parsed.next_action).toBe('string');
      expect(
        parsed.next_action.includes("choice's next_action") || parsed.next_action.toLowerCase().includes('forward')
      ).toBe(true);
      expect(Array.isArray(parsed.choices)).toBe(true);
      expect(parsed.choices.length).toBeGreaterThanOrEqual(1);

      const matchChoices = parsed.choices.filter((c) => c.role === 'match');
      expect(matchChoices.length).toBeGreaterThanOrEqual(2);

      for (const choice of matchChoices) {
        expect(choice.uri).toBeDefined();
        expect(typeof choice.uri).toBe('string');
        expect(choice.uri.startsWith('kairos://adapter/')).toBe(true);
        expect(choice.label).toBeDefined();
        expect(typeof choice.label).toBe('string');
        expect(choice.role).toBe('match');
        if (choice.next_action !== undefined) {
          expect(choice.next_action.toLowerCase()).toContain('forward');
        }
        if (choice.tags !== undefined) {
          expect(Array.isArray(choice.tags)).toBe(true);
        }
      }

      expect(parsed.start_here).toBeUndefined();
      expect(parsed.protocol_status).toBeUndefined();
      expect(parsed.best_match).toBeUndefined();
      expect(parsed.suggestion).toBeUndefined();
      expect(parsed.hint).toBeUndefined();
    }, 'CASE 2 test');
  }, 30000);
});

