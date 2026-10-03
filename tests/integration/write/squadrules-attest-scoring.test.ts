/**
 * Integration tests: reward propagation to the adapter head and attest-based score boost.
 * Uses the current tools: train, forward, reward, activate.
 */
import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson, withRawOnFail } from '../../utils/expect-with-raw.js';
import { getTestSpaceId } from '../../utils/auth-headers.js';
import { buildProofMarkdown } from '../../utils/proof-of-work.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

const MIN_ATTEST_RUNS = 3;

describe('reward scoring: propagation and score boost', () => {
  let mcpConnection: Awaited<ReturnType<typeof createMcpConnection>>;

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  }, 30000);

  afterAll(async () => {
    if (mcpConnection) await mcpConnection.close();
  });

  async function activateQuery(query: string): Promise<{
    choices: Array<{
      uri: string;
      label: string;
      adapter_name?: string | null;
      activation_score?: number | null;
      score?: number | null;
      role: string;
    }>;
  }> {
    const args: { query: string; space_id?: string } = { query };
    const spaceId = getTestSpaceId();
    if (spaceId) args.space_id = spaceId;
    const result = await mcpConnection!.client.callTool({ name: 'activate', arguments: args });
    return parseMcpJson(result, 'activate');
  }

  async function activateAllSpaces(query: string) {
    const result = await mcpConnection!.client.callTool({ name: 'activate', arguments: { query } });
    return parseMcpJson(result, 'activate');
  }

  function getScoreForChain(
    parsed: {
      choices: Array<{
        label?: string;
        adapter_name?: string | null;
        activation_score?: number | null;
        score?: number | null;
        role: string;
      }>;
    },
    chainLabel: string
  ): number | null {
    const matches = parsed.choices.filter((c) => c.role === 'match');
    const effective = (c: (typeof matches)[0]) => c.adapter_name ?? c.label ?? '';
    const exact = matches.find((c) => effective(c) === chainLabel);
    const byInclude =
      exact ?? matches.find((c) => effective(c).includes(chainLabel) || chainLabel.includes(effective(c)));
    const match = byInclude ?? (matches.length === 1 ? matches[0]! : null);
    const raw = match?.activation_score ?? match?.score ?? null;
    if (raw == null) return null;
    if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
    if (typeof raw === 'string') {
      const n = Number(raw);
      return Number.isNaN(n) ? null : n;
    }
    if (typeof raw === 'object') {
      const o = raw as Record<string, unknown>;
      if (typeof o.value === 'number' && !Number.isNaN(o.value)) return o.value;
      if (typeof o.score === 'number' && !Number.isNaN(o.score)) return o.score;
    }
    return null;
  }

  /** Train a 2-step adapter, walk forward twice, return label and last layer URI for reward. */
  async function trainAndComplete(uniqueLabel: string): Promise<{ chainLabel: string; completionLayerUri: string }> {
    const doc = buildProofMarkdown(uniqueLabel, [
      { heading: 'Step One', body: `First for ${uniqueLabel}.`, proofCmd: 'echo step1' },
      { heading: 'Step Two', body: `Second for ${uniqueLabel}.`, proofCmd: 'echo step2' }
    ]);
    const trainArgs: { content: string; llm_model_id: string; force_update: boolean; space?: string } = {
      content: doc,
      llm_model_id: 'test-attest-scoring',
      force_update: true,
    review_evidence: MOCK_REVIEW_EVIDENCE
  };
    const spaceId = getTestSpaceId();
    if (spaceId) trainArgs.space = 'personal';
    const storeResult = await mcpConnection!.client.callTool({
      name: 'train',
      arguments: trainArgs
    });
    const stored = parseMcpJson(storeResult, 'attest-scoring train');
    withRawOnFail({ call: { name: 'train', arguments: trainArgs }, result: storeResult, parsed: stored }, () => {
      expect(stored.status).toBe('stored');
      expect(Array.isArray(stored.items)).toBe(true);
      expect(stored.items.length).toBeGreaterThan(0);
    }, 'attest-scoring train');
    const items = stored.items as Array<{ uri: string; adapter_uri: string }>;

    const open = await mcpConnection!.client.callTool({
      name: 'forward',
      arguments: { uri: items[0].adapter_uri }
    });
    let p = parseMcpJson(open, 'attest-scoring forward open');
    let layerUri = p.current_layer.uri as string;
    let nonce = p.contract?.nonce;
    let proofHash = p.contract?.proof_hash ?? p.contract?.genesis_hash;

    for (let i = 0; i < 2; i++) {
      const r = await mcpConnection!.client.callTool({
        name: 'forward',
        arguments: {
          uri: layerUri,
          solution: {
            type: 'shell',
            nonce,
            proof_hash: proofHash,
            shell: { exit_code: 0, stdout: i === 0 ? 'step1' : 'step2' }
          }
        }
      });
      p = parseMcpJson(r, `attest-scoring forward ${i}`);
      if (i === 0) {
        layerUri = p.current_layer.uri as string;
        nonce = p.contract?.nonce;
        proofHash = p.proof_hash || p.contract?.proof_hash || proofHash;
      }
    }

    const completionLayerUri = p.current_layer?.uri as string;
    return { chainLabel: uniqueLabel, completionLayerUri };
  }

  async function reward(uri: string, outcome: 'success' | 'failure', feedback: string): Promise<void> {
    const result = await mcpConnection!.client.callTool({
      name: 'reward',
      arguments: { uri, outcome, feedback }
    });
    parseMcpJson(result, 'reward');
  }

  test('positive reward: search score increases after MIN_ATTEST_RUNS successes', async () => {
    const ts = Date.now();
    const uniqueLabel = `AttestScoringPositive ${ts}`;
    const { chainLabel, completionLayerUri } = await trainAndComplete(uniqueLabel);

    const searchFn = getTestSpaceId() ? activateQuery : activateAllSpaces;
    const parsedBefore = await searchFn(uniqueLabel);
    const scoreBefore = getScoreForChain(parsedBefore, chainLabel);
    const matchChoicesBefore = parsedBefore.choices?.filter((c: { role: string }) => c.role === 'match') ?? [];
    if (matchChoicesBefore.length === 0) {
      const msg = `Trained adapter "${chainLabel}" not in activate results (0 matches). Ensure dev server is running and train/activate use the same space.`;
      throw new Error(msg);
    }
    const matchSummary = matchChoicesBefore.slice(0, 5).map((c: { label?: string; adapter_name?: string | null }) =>
      String(c.adapter_name ?? c.label ?? '?')
    );

    for (let i = 0; i < MIN_ATTEST_RUNS; i++) {
      await reward(completionLayerUri, 'success', `Run ${i + 1} completed.`);
    }

    const parsedAfter = await searchFn(uniqueLabel);
    const scoreAfter = getScoreForChain(parsedAfter, chainLabel);

    withRawOnFail(
      { parsedBefore, parsedAfter, chainLabel, scoreBefore, scoreAfter, matchCount: matchChoicesBefore.length, matchSummary },
      () => {
        expect(scoreBefore).not.toBeNull();
        expect(scoreAfter).not.toBeNull();
        expect(scoreAfter as number).toBeGreaterThan(scoreBefore as number);
      },
      'reward scoring positive'
    );
  }, 45000);

  test('negative reward: search score decreases or stays same after failure', async () => {
    const ts = Date.now();
    const uniqueLabel = `AttestScoringNegative ${ts}`;
    const { chainLabel, completionLayerUri } = await trainAndComplete(uniqueLabel);

    const searchFn = getTestSpaceId() ? activateQuery : activateAllSpaces;
    for (let i = 0; i < MIN_ATTEST_RUNS; i++) {
      await reward(completionLayerUri, 'success', `Warmup ${i + 1}.`);
    }
    const parsedAfterSuccesses = await searchFn(uniqueLabel);
    const scoreAfterSuccesses = getScoreForChain(parsedAfterSuccesses, chainLabel);

    await reward(completionLayerUri, 'failure', 'One run failed.');
    const parsedAfterFailure = await searchFn(uniqueLabel);
    const scoreAfterFailure = getScoreForChain(parsedAfterFailure, chainLabel);

    withRawOnFail(
      { chainLabel, scoreAfterSuccesses, scoreAfterFailure, parsedAfterSuccesses, parsedAfterFailure },
      () => {
        expect(scoreAfterSuccesses).not.toBeNull();
        expect(scoreAfterFailure).not.toBeNull();
        expect(scoreAfterFailure as number).toBeLessThanOrEqual((scoreAfterSuccesses as number) + 0.001);
      },
      'reward scoring negative'
    );
  }, 70000);

  test('no boost when runs < MIN_ATTEST_RUNS: one success does not change score', async () => {
    const ts = Date.now();
    const uniqueLabel = `AttestScoringNoBoost ${ts}`;
    const { chainLabel, completionLayerUri } = await trainAndComplete(uniqueLabel);

    const searchFn = getTestSpaceId() ? activateQuery : activateAllSpaces;
    const parsedBefore = await searchFn(uniqueLabel);
    const scoreBefore = getScoreForChain(parsedBefore, chainLabel);

    await reward(completionLayerUri, 'success', 'Single run.');

    const parsedAfter = await searchFn(uniqueLabel);
    const scoreAfter = getScoreForChain(parsedAfter, chainLabel);

    withRawOnFail(
      { parsedBefore, parsedAfter, chainLabel, scoreBefore, scoreAfter },
      () => {
        expect(scoreBefore).not.toBeNull();
        expect(scoreAfter).not.toBeNull();
        expect(scoreAfter as number).toBeCloseTo(scoreBefore as number, 4);
      },
      'reward scoring threshold'
    );
  }, 30000);
});
