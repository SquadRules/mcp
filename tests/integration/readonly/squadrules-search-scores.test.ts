/**
 * Baseline and verification tests for activate (activation_score) vs. recorded baseline.
 * Per plan: (a) RECORD_BASELINE=1 runs fixed queries and writes tests/test-data/squadrules-search-score-baseline.json.
 *           (b) Default run loads baseline and asserts top score >= baseline for each query.
 * Uses train-in-test + fixed queries for deterministic dev. Run: npm run dev:deploy && npm run dev:test -- tests/integration/squadrules-search-scores.test.ts
 */
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson, withRawOnFail } from '../../utils/expect-with-raw.js';
import { getTestSpaceId } from '../../utils/auth-headers.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

const RECORD_BASELINE = process.env.RECORD_BASELINE === '1';
const BASELINE_PATH = join(process.cwd(), 'tests', 'test-data', 'squadrules-search-score-baseline.json');

interface BaselineChoice {
  label: string;
  score: number | null;
}

interface BaselineQueryResult {
  topScore: number;
  topLabel: string;
  choices: BaselineChoice[];
}

interface BaselineFile {
  recordedAt: string;
  queries: Record<string, BaselineQueryResult>;
}

const FIXED_QUERIES = ['ScoreBaseline'];

function expectConfidenceMessageWithinBounds(message: string) {
  const match = message.match(/top confidence: (\d+)%/i);
  if (!match) return;
  expect(Number(match[1])).toBeLessThanOrEqual(100);
}

function buildBaselineFromParsed(parsed: {
  choices: Array<{ label: string; score?: number | null; activation_score?: number | null; role: string }>;
}): BaselineQueryResult {
  const matchChoices = parsed.choices.filter((c) => c.role === 'match');
  const top = matchChoices[0];
  const rawTop = top ? top.activation_score ?? top.score : null;
  const topScore = typeof rawTop === 'number' ? rawTop : 0;
  const topLabel = top?.label ?? '';
  const choices = parsed.choices.map((c) => ({
    label: c.label,
    score: (c.activation_score ?? c.score) ?? null
  }));
  return { topScore, topLabel, choices };
}

describe('activate score baseline and verification', () => {
  let mcpConnection: Awaited<ReturnType<typeof createMcpConnection>>;

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  }, 30000);

  afterAll(async () => {
    if (mcpConnection) await mcpConnection.close();
  });

  async function search(query: string) {
    const args: { query: string; space_id?: string } = { query };
    const spaceId = getTestSpaceId();
    if (spaceId) args.space_id = spaceId;
    const result = await mcpConnection!.client.callTool({ name: 'activate', arguments: args });
    return parseMcpJson(result, 'activate scores');
  }

  async function trainProtocol(title: string) {
    const content = `# ${title}\n\n## Activation Patterns\nWhen.\n\n## Step 1\nDo something.\n\n\`\`\`json\n{"contract":{"type":"comment","comment":{"min_length":10},"required":true}}\n\`\`\`\n\n## Reward Signal\nDone.`;
    await mcpConnection!.client.callTool({
      name: 'train',
      arguments: { content: content, llm_model_id: 'test-score-baseline', force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });
  }

  test(
    RECORD_BASELINE ? 'record baseline: run fixed queries and write baseline file' : 'verify: scores meet or exceed baseline',
    async () => {
      const ts = Date.now();
      await trainProtocol(`ScoreBaseline ${ts}`);
      await new Promise((r) => setTimeout(r, 5000));

      const results: Record<string, BaselineQueryResult> = {};
      for (const q of FIXED_QUERIES) {
        const parsed = await search(q);
        const matchChoices = parsed.choices.filter((c: { role: string }) => c.role === 'match');
        expectConfidenceMessageWithinBounds(parsed.message);
        for (const choice of matchChoices) {
          const score = choice.activation_score ?? choice.score;
          expect(typeof score).toBe('number');
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(1);
        }
        results[q] = buildBaselineFromParsed(parsed);
      }

      if (RECORD_BASELINE) {
        const baseline: BaselineFile = {
          recordedAt: new Date().toISOString(),
          queries: results
        };
        writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2), 'utf-8');
        expect(existsSync(BASELINE_PATH)).toBe(true);
        return;
      }

      if (!existsSync(BASELINE_PATH)) {
        throw new Error(
          `Baseline file not found at ${BASELINE_PATH}. Run with RECORD_BASELINE=1 first, then commit the file.`
        );
      }

      const raw = readFileSync(BASELINE_PATH, 'utf-8');
      const baseline: BaselineFile = JSON.parse(raw);
      expect(baseline.queries).toBeDefined();

      for (const q of FIXED_QUERIES) {
        const expected = baseline.queries[q];
        if (!expected) continue;
        const current = results[q];
        withRawOnFail({ query: q, current, expected }, () => {
          expect(current.topScore).toBeGreaterThanOrEqual(expected.topScore);
        });
      }
    },
    60000
  );
});
