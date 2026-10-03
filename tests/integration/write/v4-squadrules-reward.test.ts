/**
 * Reward tool response shape tests.
 * Allowed keys for each result item; must match tool outputSchema (additionalProperties: false).
 */
import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson, withRawOnFail } from '../../utils/expect-with-raw.js';
import { buildProofMarkdown } from '../../utils/proof-of-work.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

const REWARD_RESULT_KEYS = [
  'uri',
  'outcome',
  'score',
  'feedback',
  'rater',
  'rubric_version',
  'llm_model_id',
  'grader_kind',
  'evaluation_label',
  'exportable_for_sft',
  'exportable_for_preference',
  'sft_blockers',
  'preference_blockers',
  'rated_at'
] as const;

describe('v4-reward response schema', () => {
  let mcpConnection;

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  }, 30000);

  afterAll(async () => {
    if (mcpConnection) await mcpConnection.close();
  });

  /** Two-step shell adapter: walk forward until next_action mentions reward; return last layer URI. */
  async function trainAndWalkToLastLayer(label: string): Promise<{ lastUri: string }> {
    const doc = buildProofMarkdown(label, [
      { heading: 'Step One', body: `First body for ${label}.`, proofCmd: 'echo step1' },
      { heading: 'Step Two', body: `Second body for ${label}.`, proofCmd: 'echo step2' }
    ]);
    const storeResult = await mcpConnection.client.callTool({
      name: 'train',
      arguments: { content: doc, llm_model_id: 'test-v4-reward', force_update: true, review_evidence: MOCK_REVIEW_EVIDENCE }
    });
    const stored = parseMcpJson(storeResult, 'v4-reward train');
    expect(stored.status).toBe('stored');
    const items = stored.items as Array<{ adapter_uri: string }>;

    const open = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: { uri: items[0].adapter_uri }
    });
    let payload = parseMcpJson(open, 'v4-reward open');
    let layerUri = payload.current_layer.uri as string;
    let nonce = payload.contract?.nonce;
    let proofHash = payload.contract?.proof_hash || payload.contract?.genesis_hash;

    for (let i = 0; i < 2; i++) {
      const result = await mcpConnection.client.callTool({
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
      payload = parseMcpJson(result, `v4-reward step${i + 1}`);
      if (i === 0) {
        layerUri = payload.current_layer.uri as string;
        nonce = payload.contract?.nonce;
        proofHash = payload.proof_hash || payload.contract?.proof_hash || proofHash;
      }
    }

    const lastUri = payload.current_layer?.uri as string;
    expect(typeof lastUri).toBe('string');
    return { lastUri };
  }

  test('success reward: returns results array', async () => {
    const ts = Date.now();
    const { lastUri } = await trainAndWalkToLastLayer(`V4Reward Success ${ts}`);

    const call = {
      name: 'reward',
      arguments: {
        uri: lastUri,
        outcome: 'success',
        feedback: 'All steps completed successfully.'
      }
    };
    const result = await mcpConnection.client.callTool(call);
    const parsed = parseMcpJson(result, 'v4-reward success');

    withRawOnFail({ call, result }, () => {
      expect(Array.isArray(parsed.results)).toBe(true);
      expect(parsed.results.length).toBeGreaterThanOrEqual(1);

      const r = parsed.results[0];
      expect(r.uri).toBe(lastUri);
      expect(r.outcome).toBe('success');
      expect(r.score === null || typeof r.score === 'number').toBe(true);
      expect(r.feedback === null || typeof r.feedback === 'string').toBe(true);
      expect(r.grader_kind).toBe('unknown');
      expect(r.evaluation_label).toBe('gold');
      expect(r.exportable_for_sft).toBe(false);
      expect(r.exportable_for_preference).toBe(false);
      expect(r.sft_blockers).toContain('missing_rubric_version');
      expect(r.preference_blockers).toContain('missing_evaluator_identity');
      expect(typeof r.rated_at).toBe('string');

      const resultKeys = Object.keys(r).sort();
      expect(resultKeys).toEqual([...REWARD_RESULT_KEYS].sort());

      expect(parsed.total_rated).toBe(parsed.results.length);
      expect(parsed.total_failed).toBe(0);
    }, 'v4-reward success');
  });

  test('failure reward', async () => {
    const ts = Date.now();
    const { lastUri } = await trainAndWalkToLastLayer(`V4Reward Failure ${ts}`);

    const call = {
      name: 'reward',
      arguments: {
        uri: lastUri,
        outcome: 'failure',
        feedback: 'Step failed: permission denied.'
      }
    };
    const result = await mcpConnection.client.callTool(call);
    const parsed = parseMcpJson(result, 'v4-reward failure');

    withRawOnFail({ call, result }, () => {
      expect(Array.isArray(parsed.results)).toBe(true);
      expect(parsed.results.length).toBeGreaterThanOrEqual(1);
      const r = parsed.results[0];
      expect(r.outcome).toBe('failure');
      expect(r.evaluation_label).toBe('rejected');
      expect(Object.keys(r).sort()).toEqual([...REWARD_RESULT_KEYS].sort());
      expect(parsed.total_rated).toBe(parsed.results.length);
      expect(parsed.total_failed).toBe(0);
    }, 'v4-reward failure');
  });
});
