import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson, withRawOnFail } from '../../utils/expect-with-raw.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

/**
 * CASE 3 — NO PERFECT MATCH, BUT ONE GOOD CANDIDATE (0.5 ≤ score < 1.0)
 * → Offer with confidence — never force
 * 
 * Tests from reports/outputs.md
 */

describe('Squadrules Search - CASE 3: NO PERFECT MATCH BUT GOOD CANDIDATE', () => {
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

  test('returns V2 unified schema with non-perfect match candidates in choices', async () => {
    const ts = Date.now();
    const uniqueTitle = `PartialMatchCase3 ${ts}`;
    const content = `# ${uniqueTitle}

## Activation Patterns
Run when user says "partial match case 3".

## Step 1
This protocol tests CASE 3 behavior: no perfect match but good candidate.

\`\`\`json
{"contract":{"type":"comment","comment":{"min_length":10},"required":true}}
\`\`\`

## Reward Signal
Only after all steps.`;

    // Store the protocol
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

    // Search with non-exact query (may score above threshold)
    const call = {
      name: 'activate',
      arguments: {
        query: `match case3 ${ts}`
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

      // choices: always an array with at least one entry (the create protocol)
      expect(Array.isArray(parsed.choices)).toBe(true);
      expect(parsed.choices.length).toBeGreaterThanOrEqual(1);

      // If there are match choices, validate their structure
      const matchChoices = parsed.choices.filter((c) => c.role === 'match');
      for (const choice of matchChoices) {
        expect(choice.uri).toBeDefined();
        expect(typeof choice.uri).toBe('string');
        expect(choice.uri.startsWith('squadrules://adapter/')).toBe(true);
        expect(choice.label).toBeDefined();
        expect(typeof choice.label).toBe('string');
        expect(choice.role).toBe('match');
        // score may be a number or null
        const actScore = (choice as { activation_score?: number | null }).activation_score ?? choice.score;
        if (actScore !== null && actScore !== undefined) {
          expect(typeof actScore).toBe('number');
        }
        if (choice.tags !== undefined) {
          expect(Array.isArray(choice.tags)).toBe(true);
        }
      }

      // There should be at least one create choice
      const createChoices = parsed.choices.filter((c) => c.role === 'create');
      expect(createChoices.length).toBeGreaterThanOrEqual(1);
      for (const cc of createChoices) {
        expect(cc.uri).toBeDefined();
        expect(cc.role).toBe('create');
      }

      // Old fields must be absent
      expect(parsed.protocol_status).toBeUndefined();
      expect(parsed.best_match).toBeUndefined();
      expect(parsed.suggestion).toBeUndefined();
      expect(parsed.hint).toBeUndefined();
      expect(parsed.start_here).toBeUndefined();
    }, 'CASE 3 test');
  }, 20000);
});

