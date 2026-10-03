import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson, withRawOnFail } from '../../utils/expect-with-raw.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

/**
 * CASE 1 — ONE PERFECT MATCH (score = 1.0)
 * → Immediate obedience
 * 
 * Tests from reports/outputs.md
 */

describe('Squadrules Search - CASE 1: ONE PERFECT MATCH', () => {
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

  test('returns V2 unified schema with must_obey: true and choices containing our match', async () => {
    const ts = Date.now();
    const uniqueTitle = `PerfectMatchCase1 ${ts}`;
    const content = `# ${uniqueTitle}

## Activation Patterns
Run when user says "perfect match case 1".

## Step 1
This protocol tests CASE 1 behavior: single perfect match.

\`\`\`json
{"contract":{"type":"comment","comment":{"min_length":10},"required":true}}
\`\`\`

## Reward Signal
Only after all steps.`;

    // Store the protocol (force_update bypasses similarity check in shared dev collection)
    const storeResult = await mcpConnection.client.callTool({
      name: 'train',
      arguments: {
        content: content,
        llm_model_id: 'minimax/minimax-m2:free',
        force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });
    const storeResponse = expectValidJsonResult(storeResult);
    expect(storeResponse.status).toBe('stored');

    // Allow Qdrant indexing to complete
    await new Promise((r) => setTimeout(r, 3000));
    // Search with exact title (should be perfect match, score = 1.0)
    const call = {
      name: 'activate',
      arguments: {
        query: uniqueTitle
      }
    };
    const result = await mcpConnection.client.callTool(call);
    const parsed = expectValidJsonResult(result);

    withRawOnFail({ call, result }, () => {
      // V2 unified schema — must_obey is ALWAYS true
      expect(parsed.must_obey).toBe(true);

      // message: string
      expect(parsed.message).toBeDefined();
      expect(typeof parsed.message).toBe('string');

      // next_action: global directive (new) or URI (old)
      expect(parsed.next_action).toBeDefined();
      expect(typeof parsed.next_action).toBe('string');
      expect(
        parsed.next_action.includes("choice's next_action") ||
          parsed.next_action.includes('squadrules://') ||
          parsed.next_action.toLowerCase().includes('forward')
      ).toBe(true);

      // choices: always an array with at least one entry
      expect(Array.isArray(parsed.choices)).toBe(true);
      expect(parsed.choices.length).toBeGreaterThanOrEqual(1);

      // Find our match in choices (or verify create fallback when no match)
      const ourChoice = parsed.choices.find(
        (c) =>
          c.role === 'match' &&
          ((c as { adapter_name?: string }).adapter_name === uniqueTitle ||
            (c.label && String(c.label).includes(uniqueTitle)))
      );
      if (ourChoice) {
        expect(ourChoice.uri).toBeDefined();
        expect(typeof ourChoice.uri).toBe('string');
        expect(ourChoice.uri.startsWith('squadrules://adapter/')).toBe(true);
        expect(ourChoice.role).toBe('match');
        if (ourChoice.next_action !== undefined) {
          expect(
            ourChoice.next_action.includes('squadrules://') || ourChoice.next_action.toLowerCase().includes('forward')
          ).toBe(true);
        }
        if (ourChoice.tags !== undefined) {
          expect(Array.isArray(ourChoice.tags)).toBe(true);
        }
      }

      // Old fields must be absent
      expect(parsed.start_here).toBeUndefined();
      expect(parsed.protocol_status).toBeUndefined();
      expect(parsed.best_match).toBeUndefined();
      expect(parsed.suggestion).toBeUndefined();
      expect(parsed.hint).toBeUndefined();
    }, 'CASE 1 test');
  }, 20000);
});

