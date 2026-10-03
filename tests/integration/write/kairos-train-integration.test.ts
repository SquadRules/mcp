// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson, withRawOnFail } from '../../utils/expect-with-raw.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

/**
 * Squadrules Train integration tests (integration with other tools).
 *
 * Goals:
 * - Verify integration with forward and resource reading.
 * - When something goes wrong, surface the raw MCP result
 *   instead of wrapping it in an extra "Failed to parse..." error.
 */

describe('Squadrules Train Integration', () => {
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
    return parseMcpJson(result, 'train raw MCP result');
  }

  test('activate returns valid response after train', async () => {
    // Use one timestamp for store + query; include required Activation Patterns and Reward Signal
    const ts = Date.now();
    const testQuery = `CacheCheckDoc ${ts}`;
    const content = `# ${testQuery}

## Activation Patterns
Run when user says "cache check".

This document exists to test activate after train.

## Step 1
Body.

\`\`\`json
{"contract":{"type":"shell","shell":{"cmd":"echo ok","timeout_seconds":5},"required":true}}
\`\`\`

## Reward Signal
Only after all steps.`;
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

    // Search — expect valid V2 response
    const call = { name: 'activate', arguments: { query: testQuery } };
    const result = await mcpConnection.client.callTool(call);
    withRawOnFail({ call, result }, () => {
      const parsed = expectValidJsonResult(result);

      // V2 unified response shape (always present)
      expect(parsed.must_obey).toBe(true);
      expect(typeof parsed.message).toBe('string');
      expect(typeof parsed.next_action).toBe('string');
      // New format: global directive "choice's next_action"; old format: next_action may cite a layer URI (`kairos://…`).
      expect(
        parsed.next_action.includes("choice's next_action") ||
          parsed.next_action.includes('kairos://') ||
          parsed.next_action.toLowerCase().includes('forward')
      ).toBe(true);
      expect(Array.isArray(parsed.choices)).toBe(true);
      expect(parsed.choices.length).toBeGreaterThanOrEqual(1);

      // Each choice has the V2 shape (role can be match, refine, or create; next_action in new format)
      const isNewFormat = parsed.next_action.includes("choice's next_action");
      for (const choice of parsed.choices) {
        expect(choice).toHaveProperty('uri');
        expect(choice).toHaveProperty('label');
        expect(choice).toHaveProperty('role');
        expect(choice).toHaveProperty('tags');
        if (isNewFormat) expect(choice).toHaveProperty('next_action');
        expect(['match', 'refine', 'create']).toContain(choice.role);
      }

      // V1 fields must NOT exist
      expect(parsed.start_here).toBeUndefined();
      expect(parsed.best_match).toBeUndefined();
      expect(parsed.protocol_status).toBeUndefined();
      expect(parsed.suggestion).toBeUndefined();
      expect(parsed.hint).toBeUndefined();
    }, 'activate call + raw result');
  }, 20000);

});