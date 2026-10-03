import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseMcpJson } from '../../utils/expect-with-raw.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

describe('Squadrules Train AI_CODING_RULES.md Import', () => {
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
    return parseMcpJson(result, '[train AI_CODING_RULES] raw MCP result');
  }

  test('import: AI_CODING_RULES.md', async () => {
    const filePath = join(process.cwd(), 'tests', 'test-data', 'AI_CODING_RULES.md');
    const content = readFileSync(filePath, 'utf-8');

    const result = await mcpConnection.client.callTool({
      name: 'train',
      arguments: {
        content: content,
        llm_model_id: 'minimax/minimax-m2:free',
        force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });

    const response = expectValidJsonResult(result);
    expect(response).toHaveProperty('items');
    expect(Array.isArray(response.items)).toBe(true);
    expect(response.items.length).toBeGreaterThanOrEqual(1);
    expect(response.status).toBe('stored');
  }, 30000);
});

