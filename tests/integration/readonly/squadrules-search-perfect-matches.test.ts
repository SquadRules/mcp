import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson, withRawOnFail } from '../../utils/expect-with-raw.js';
import { buildProofMarkdown } from '../../utils/proof-of-work.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

/**
 * Squadrules Search Perfect Matches Integration Tests
 *
 * Tests edge cases and schema validation for activate:
 * - No perfect match fallback behavior
 * - Output schema validation for optional fields
 * 
 * Note: Single and multiple perfect match tests are in squadrules-search-case1.test.ts
 * and squadrules-search-case2.test.ts respectively.
 */

describe('Squadrules Search Perfect Matches', () => {
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

  test('no perfect match returns V2 unified schema with choices including candidates and create', async () => {
    // Create a protocol with a unique title
    const ts = Date.now();
    const uniqueTitle = `NoPerfectMatchTest ${ts}`;
    const content = buildProofMarkdown(uniqueTitle, [
      { heading: 'Step 1 — Baseline', body: 'Document fallback behavior when no perfect match exists.', proofCmd: 'echo baseline-nomatch' },
      { heading: 'Step 2 — Investigate', body: 'Study the match scenario.', proofCmd: 'echo investigate-nomatch' }
    ]);

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

    // Search with query that matches the title (should score above threshold)
    const call = {
      name: 'activate',
      arguments: {
        query: `NoPerfectMatchTest ${ts} partial`
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

      // Validate match choices if any
      const matchChoices = parsed.choices.filter((c) => c.role === 'match');
      for (const choice of matchChoices) {
        expect(choice.uri).toBeDefined();
        expect(typeof choice.uri).toBe('string');
        expect(choice.uri.startsWith('squadrules://adapter/')).toBe(true);
        expect(choice.label).toBeDefined();
        expect(typeof choice.label).toBe('string');
        expect(choice.role).toBe('match');
        const act = (choice as { activation_score?: number | null }).activation_score ?? choice.score;
        if (act !== null && act !== undefined) {
          expect(typeof act).toBe('number');
        }
      }

      // There should be at least one create choice
      const createChoices = parsed.choices.filter((c) => c.role === 'create');
      expect(createChoices.length).toBeGreaterThanOrEqual(1);

      // Old fields must be absent
      expect(parsed.protocol_status).toBeUndefined();
      expect(parsed.best_match).toBeUndefined();
      expect(parsed.suggestion).toBeUndefined();
      expect(parsed.hint).toBeUndefined();
      expect(parsed.start_here).toBeUndefined();
    }, 'no perfect match fallback test');
  }, 20000);

  test('output schema validation - V2 unified schema always has required fields', async () => {
    // Test that the V2 schema always returns all required fields
    const ts = Date.now();
    const uniqueTitle = `SchemaValidationTest ${ts}`;
    const content = `# ${uniqueTitle}\n\nSchema validation test.`;

    // Store (force_update bypasses similarity check in shared dev collection)
    const storeResult = await mcpConnection.client.callTool({
      name: 'train',
      arguments: {
        content: content,
        llm_model_id: 'minimax/minimax-m2:free',
        force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });
    expectValidJsonResult(storeResult);

    // Search for the stored protocol
    const singleResult = await mcpConnection.client.callTool({
      name: 'activate',
      arguments: {
        query: uniqueTitle.toLowerCase()
      }
    });
    const singleParsed = expectValidJsonResult(singleResult);
    
    // V2 unified schema — all fields always present
    expect(singleParsed.must_obey).toBe(true);
    expect(typeof singleParsed.message).toBe('string');
    expect(typeof singleParsed.next_action).toBe('string');
    expect(Array.isArray(singleParsed.choices)).toBe(true);
    expect(singleParsed.choices.length).toBeGreaterThanOrEqual(1);

    const ADAPTER_SLUG_URI_RE = /^squadrules:\/\/adapter\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
    // Each choice must have uri, label, role (match/refine adapter URIs are squadrules://adapter/<slug>)
    const isNewFormat = typeof singleParsed.next_action === 'string' && singleParsed.next_action.includes("choice's next_action");
    for (const choice of singleParsed.choices) {
      expect(choice.uri).toBeDefined();
      expect(typeof choice.uri).toBe('string');
      if (choice.role === 'match' || choice.role === 'refine') {
        expect(choice.uri).toMatch(ADAPTER_SLUG_URI_RE);
        expect(choice).toHaveProperty('forward_first_call');
        expect(choice.forward_first_call).not.toBeNull();
        expect(choice.forward_first_call.uri).toMatch(ADAPTER_SLUG_URI_RE);
      } else {
        expect(choice.role).toBe('create');
        expect(choice.forward_first_call).toBeNull();
      }
      expect(choice.label).toBeDefined();
      expect(typeof choice.label).toBe('string');
      if (isNewFormat) expect(choice).toHaveProperty('next_action');
      expect(['match', 'refine', 'create']).toContain(choice.role);
      if (choice.tags !== undefined) {
        expect(Array.isArray(choice.tags)).toBe(true);
      }
    }

    // Old fields must be absent
    expect(singleParsed.protocol_status).toBeUndefined();
    expect(singleParsed.start_here).toBeUndefined();
    expect(singleParsed.best_match).toBeUndefined();
    expect(singleParsed.suggestion).toBeUndefined();
    expect(singleParsed.hint).toBeUndefined();
  }, 20000);
});

