import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parseMcpJson } from '../../utils/expect-with-raw.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

describe('Squadrules Train Data Import (tests/test-data)', () => {
  // Tests all .md files in tests/test-data/ directory
  // Currently only contains AI_CODING_RULES.md (other redundant files were removed)
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
    return parseMcpJson(result, '[train import] raw MCP result');
  }

  const testDataDir = join(process.cwd(), 'tests', 'test-data');
  const testFiles = readdirSync(testDataDir)
    .filter((name) => name.toLowerCase().endsWith('.md'))
    .map((name) => join(testDataDir, name));

  beforeAll(() => {
    if (testFiles.length === 0) {
      throw new Error('tests/test-data has no .md files');
    }
  });

  for (const filePath of testFiles) {
    const fileName = filePath.split('/').pop() || filePath;
    test(`import: ${fileName}`, async () => {
      expect.hasAssertions();
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
  }
});
