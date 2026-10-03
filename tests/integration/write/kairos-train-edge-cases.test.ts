// squadrules-compat-surface: dual-accepts canonical kairos:// URIs (squadrules:// alias) so existing stored URIs and clients keep resolving
import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

/**
 * Squadrules Train integration tests (edge cases).
 *
 * Goals:
 * - Verify fallback behavior and caching.
 * - When something goes wrong, surface the raw MCP result
 *   instead of wrapping it in an extra "Failed to parse..." error.
 */

describe('Squadrules Train Edge Cases', () => {
  let mcpConnection;

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  });

  afterAll(async () => {
    if (mcpConnection) {
      await mcpConnection.close();
    }
  });

  test('train rejects documents without required structure (PROTOCOL_STRUCTURE_INVALID)', async () => {
    // Document without H1, H2, or challenge blocks is rejected by validation gate
    const simpleContent = `This is a simple document without any markdown headers. ${Date.now()}`;

    const result = await mcpConnection.client.callTool({
      name: 'train',
      arguments: {
        content: simpleContent,
        llm_model_id: 'minimax/minimax-m2:free',
        force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });

    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text);
    expect(body.error).toBe('PROTOCOL_STRUCTURE_INVALID');
    expect(body.must_obey).toBe(true);
    expect(body.next_action).toContain('forward');
    expect(body.next_action).toMatch(/create-new-protocol|kairos:\/\/adapter\/create-new-protocol/i);
    expect(Array.isArray(body.missing)).toBe(true);
  });

});