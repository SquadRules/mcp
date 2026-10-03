import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson, withRawOnFail } from '../../utils/expect-with-raw.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

describe('Squadrules search accessibility', () => {
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

      // V2: collect URIs from choices array (only match roles)
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

  test('activate finds AI CODING RULES after train', async () => {
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

    const trainedUriSet = new Set<string>();
    for (const item of trainPayload.items || []) {
      const row = item as { uri?: string; adapter_uri?: string };
      if (row.uri) trainedUriSet.add(row.uri.toLowerCase());
      if (row.adapter_uri) trainedUriSet.add(row.adapter_uri.toLowerCase());
    }

    await new Promise(resolve => setTimeout(resolve, 3000));

    const searchCall = {
      name: 'activate',
      arguments: { query: QUERY }
    };

    let searchPayload;
    let searchResult;
    const maxAttempts = 20;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      searchResult = await mcpConnection.client.callTool(searchCall);
      searchPayload = parseMcpJson(searchResult, '[activate] AI CODING RULES');
      // V2: check if we have match choices
      const hasMatches = Array.isArray(searchPayload.choices) &&
        searchPayload.choices.some((c: any) => c.role === 'match');
      if (hasMatches) {
        break;
      }
      if (attempt === maxAttempts) {
        break;
      }
      const delay = Math.min(2000 + (attempt * 500), 5000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    withRawOnFail({ call: searchCall, result: searchResult }, () => {
      expect(searchPayload).toBeDefined();

      // V2 unified response shape
      expect(searchPayload.must_obey).toBe(true);
      expect(typeof searchPayload.message).toBe('string');
      expect(typeof searchPayload.next_action).toBe('string');
      expect(
        searchPayload.next_action.includes("choice's next_action") ||
          searchPayload.next_action.includes('squadrules://') ||
          searchPayload.next_action.toLowerCase().includes('forward')
      ).toBe(true);
      expect(Array.isArray(searchPayload.choices)).toBe(true);
      expect(searchPayload.choices.length).toBeGreaterThanOrEqual(1);

      // Check that at least one URI from train appears in the choices
      const choiceUris = (searchPayload.choices || []).map((choice: any) => (choice.uri || '').toLowerCase());
      const foundTrainedUri = choiceUris.some((uri: string) => trainedUriSet.has(uri));

      if (!foundTrainedUri) {
        const diagnostic = {
          trainedUris: Array.from(trainedUriSet),
          trainedCount: trainedUriSet.size,
          attempts: maxAttempts,
          choiceUris,
          finalResponse: searchPayload
        };
        throw new Error(`activate never detected AI CODING RULES after train. Diagnostics: ${JSON.stringify(diagnostic, null, 2)}`);
      }

      expect(foundTrainedUri).toBe(true);

      // V1 fields must NOT exist
      expect(searchPayload.protocol_status).toBeUndefined();
      expect(searchPayload.start_here).toBeUndefined();
      expect(searchPayload.best_match).toBeUndefined();
    }, '[activate] AI CODING RULES raw response');
  }, 120000);
});

