import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson, withRawOnFail } from '../../utils/expect-with-raw.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

describe('Squadrules train accessibility', () => {
  let mcpConnection;
  const QUERY = 'AI CODING RULES';

  async function purgeExistingProtocols() {
    const maxRounds = 5;
    for (let round = 0; round < maxRounds; round++) {
      const searchCall = {
        name: 'activate',
        arguments: { query: QUERY }
      };
      const searchResult = await mcpConnection.client.callTool(searchCall);
      const searchPayload = parseMcpJson(searchResult, '[activate] cleanup AI CODING RULES');

      // V2: collect URIs from choices array
      const uris = new Set<string>();
      if (Array.isArray(searchPayload.choices)) {
        for (const choice of searchPayload.choices) {
          if (choice?.uri && choice.role === 'match') {
            uris.add(choice.uri);
          }
        }
      }

      if (uris.size === 0) {
        break;
      }

      const deleteCall = {
        name: 'delete',
        arguments: { uris: Array.from(uris) }
      };
      const deleteResult = await mcpConnection.client.callTool(deleteCall);
      parseMcpJson(deleteResult, '[delete] cleanup result');
      // One round done; total_deleted may be 0 (e.g. space isolation)—break to avoid looping
      await new Promise(resolve => setTimeout(resolve, 500));
      break;
    }
  }

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  }, 30000);

  afterAll(async () => {
    if (mcpConnection) {
      await mcpConnection.close();
    }
  });

  test('train stores AI CODING RULES markdown', async () => {
    await purgeExistingProtocols();
    await new Promise(resolve => setTimeout(resolve, 2000));

    const docPath = join(process.cwd(), 'tests', 'test-data', 'AI_CODING_RULES.md');
    const markdownDoc = readFileSync(docPath, 'utf-8');

    const trainCall = {
      name: 'train',
      arguments: {
        content: markdownDoc,
        llm_model_id: 'test-ai-coding-rules',
        force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    };
    const trainResult = await mcpConnection.client.callTool(trainCall);
    const trainPayload = parseMcpJson(trainResult, '[train] AI CODING RULES');

    withRawOnFail({ call: trainCall, result: trainResult }, () => {
      expect(trainPayload.status).toBe('stored');
      expect(Array.isArray(trainPayload.items)).toBe(true);
      expect(trainPayload.items.length).toBeGreaterThanOrEqual(1);
    }, '[train] AI CODING RULES raw');
  }, 60000);
});

