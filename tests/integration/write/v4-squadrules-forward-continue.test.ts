/**
 * Forward continuation response shape tests (with solution).
 */
import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson, withRawOnFail } from '../../utils/expect-with-raw.js';
import { buildProofMarkdown } from '../../utils/proof-of-work.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

const QDRANT_URL = process.env.QDRANT_URL ?? 'http://localhost:6333';
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION ?? 'squadrules';

function layerIdFromUri(uri: string): string {
  const base = uri.split('?')[0] ?? uri;
  return base.split('/').pop() ?? '';
}

async function getPointPayload(pointId: string): Promise<Record<string, unknown> | null> {
  try {
    const url = `${QDRANT_URL}/collections/${QDRANT_COLLECTION}/points/${pointId}?with_payload=true&with_vector=false`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.result?.payload ?? null;
  } catch {
    return null;
  }
}

describe('v4-forward continuation response schema', () => {
  let mcpConnection;

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  }, 30000);

  afterAll(async () => {
    if (mcpConnection) await mcpConnection.close();
  });

  async function trainThreeStepProtocol(label: string) {
    const doc = buildProofMarkdown(label, [
      { heading: 'Step One', body: `First body for ${label}.`, proofCmd: 'echo step1' },
      { heading: 'Step Two', body: `Second body for ${label}.`, proofCmd: 'echo step2' },
      { heading: 'Step Three', body: `Third body for ${label}.`, proofCmd: 'echo step3' }
    ]);
    const storeResult = await mcpConnection.client.callTool({
      name: 'train',
      arguments: { content: doc, llm_model_id: 'test-v4-forward-continue', force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });
    const parsed = parseMcpJson(storeResult, 'v4-forward-continue train');
    expect(parsed.status).toBe('stored');
    return parsed.items as Array<{ uri: string; adapter_uri: string; layer_uuid: string }>;
  }

  test('continue: proof_hash naming, next_action with layer URI, contract on next layer', async () => {
    const ts = Date.now();
    const items = await trainThreeStepProtocol(`V4ForwardContinue ${ts}`);
    const secondLayerId = layerIdFromUri(items[1].uri);

    const open = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: { uri: items[0].adapter_uri }
    });
    const openPayload = parseMcpJson(open, 'v4-forward open');
    const c0 = openPayload.contract;
    const nonce = c0?.nonce;
    const proofHash = c0?.proof_hash || c0?.genesis_hash;

    const call = {
      name: 'forward',
      arguments: {
        uri: openPayload.current_layer.uri,
        solution: {
          type: 'shell',
          nonce,
          proof_hash: proofHash,
          shell: { exit_code: 0, stdout: 'step1', stderr: '', duration_seconds: 0.1 }
        }
      }
    };
    const result = await mcpConnection.client.callTool(call);
    const parsed = parseMcpJson(result, 'v4-forward continue');

    withRawOnFail({ call, result }, () => {
      expect(parsed.must_obey).toBe(true);
      expect(parsed.current_layer).toBeDefined();
      expect(layerIdFromUri(parsed.current_layer.uri)).toBe(secondLayerId);
      expect(parsed.current_layer.mimeType).toBe('text/markdown');
      expect(parsed.contract).toBeDefined();
      expect(parsed.contract.type).toBe('shell');

      expect(typeof parsed.next_action).toBe('string');
      expect(parsed.next_action).toContain('squadrules://layer/');
      expect(parsed.next_action).toContain('solution.type="shell"');
      expect(parsed.next_action).toContain('outcome="success"');
      expect(parsed.next_action).toContain('evidence');

      if (parsed.proof_hash) {
        expect(typeof parsed.proof_hash).toBe('string');
      }

      expect(parsed.next_step).toBeUndefined();
      expect(parsed.protocol_status).toBeUndefined();
      expect(parsed.challenge).toBeUndefined();
    });

    const step1Uuid = items[0].layer_uuid;
    const payload = await getPointPayload(step1Uuid);
    if (payload) {
      const qm = payload.quality_metadata as { step_quality_score?: number; step_quality?: string } | undefined;
      expect(qm).toBeDefined();
      expect(typeof qm?.step_quality_score).toBe('number');
      expect(typeof qm?.step_quality).toBe('string');
      expect(['excellent', 'high', 'standard', 'basic']).toContain(qm?.step_quality);
    }
  });

  test('continue: current layer contract proof_hash is accepted on the next forward call', async () => {
    const ts = Date.now();
    const items = await trainThreeStepProtocol(`V4Forward Contract ProofHash ${ts}`);
    const thirdLayerId = layerIdFromUri(items[2].uri);

    const openResult = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: { uri: items[0].adapter_uri }
    });
    const openPayload = parseMcpJson(openResult, 'v4-forward contract-proof-hash open');
    const firstProofHash = openPayload.contract?.proof_hash || openPayload.contract?.genesis_hash;

    expect(typeof firstProofHash).toBe('string');

    const step2Result = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: {
        uri: openPayload.current_layer.uri,
        solution: {
          type: 'shell',
          nonce: openPayload.contract?.nonce,
          proof_hash: firstProofHash,
          shell: { exit_code: 0, stdout: 'step1', stderr: '', duration_seconds: 0.1 }
        }
      }
    });
    const step2Payload = parseMcpJson(step2Result, 'v4-forward contract-proof-hash step2');
    const step2ContractProofHash = step2Payload.contract?.proof_hash;

    withRawOnFail({ step2Result, step2Payload }, () => {
      expect(step2Payload.proof_hash).toBeDefined();
      expect(step2ContractProofHash).toBe(step2Payload.proof_hash);
    });

    const step3Result = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: {
        uri: step2Payload.current_layer.uri,
        solution: {
          type: 'shell',
          nonce: step2Payload.contract?.nonce,
          proof_hash: step2ContractProofHash,
          shell: { exit_code: 0, stdout: 'step2', stderr: '', duration_seconds: 0.1 }
        }
      }
    });
    const step3Payload = parseMcpJson(step3Result, 'v4-forward contract-proof-hash step3');

    withRawOnFail({ step3Result, step3Payload }, () => {
      expect(step3Payload.error_code).toBeUndefined();
      expect(layerIdFromUri(step3Payload.current_layer.uri)).toBe(thirdLayerId);
    });
  });

  test('completed (last step): next_action directs to reward', async () => {
    const ts = Date.now();
    const items = await trainThreeStepProtocol(`V4Forward Completed ${ts}`);

    const openResult = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: { uri: items[0].adapter_uri }
    });
    let payload = parseMcpJson(openResult, 'v4-forward step0');
    let layerUri = payload.current_layer.uri as string;
    let nonce = payload.contract?.nonce;
    let proofHash = payload.contract?.proof_hash || payload.contract?.genesis_hash;

    const cmds = ['step1', 'step2', 'step3'];
    for (let i = 0; i < 3; i++) {
      const result = await mcpConnection.client.callTool({
        name: 'forward',
        arguments: {
          uri: layerUri,
          solution: {
            type: 'shell',
            nonce,
            proof_hash: proofHash,
            shell: { exit_code: 0, stdout: cmds[i] }
          }
        }
      });
      payload = parseMcpJson(result, `v4-forward completed-${i + 1}`);
      if (i < 2) {
        layerUri = payload.current_layer.uri as string;
        nonce = payload.contract?.nonce;
        proofHash = payload.proof_hash || payload.contract?.proof_hash || proofHash;
      }
    }

    withRawOnFail({ last: payload }, () => {
      expect(payload.must_obey).toBe(true);
      expect(payload.next_action).toMatch(/reward/i);
      expect(payload.final_challenge).toBeUndefined();
    });
  });

  test.skip('error response: must_obey true on first retry, next_action with recovery, error_code present', async () => {
    // Same skip rationale as v1 test: brittle to trigger via MCP; HTTP covers invalid-input paths.
  });
});
