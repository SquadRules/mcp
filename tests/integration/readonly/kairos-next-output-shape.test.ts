// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
console.debug('kairos-next-output-shape.test.ts');

import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson, withRawOnFail } from '../../utils/expect-with-raw.js';
import { buildProofMarkdown } from '../../utils/proof-of-work.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

function layerIdFromUri(uri: string): string {
  const base = uri.split('?')[0] ?? uri;
  return base.split('/').pop() ?? '';
}

console.debug('kairos-next-output-shape.test.ts');
describe('forward response schema (train → forward)', () => {
  let mcpConnection;

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  }, 30000);

  afterAll(async () => {
    if (mcpConnection) await mcpConnection.close();
  });

  async function trainTwoStepProtocol(label: string) {
    const doc = buildProofMarkdown(label, [
      { heading: 'Step One', body: `First body for ${label}.`, proofCmd: 'echo step1' },
      { heading: 'Step Two', body: `Second body for ${label}.`, proofCmd: 'echo step2' }
    ]);

    const storeResult = await mcpConnection.client.callTool({
      name: 'train',
      arguments: { content: doc, llm_model_id: 'test-model-kairos-next', force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });

    const parsed = parseMcpJson(storeResult, '[forward tests] train');
    expect(parsed.status).toBe('stored');
    expect(parsed.items.length).toBeGreaterThanOrEqual(2);
    return parsed.items as Array<{ uri: string; adapter_uri: string }>;
  }

  async function trainThreeStepProtocol(label: string) {
    const doc = buildProofMarkdown(label, [
      { heading: 'Step One', body: `First body for ${label}.`, proofCmd: 'echo step1' },
      { heading: 'Step Two', body: `Second body for ${label}.`, proofCmd: 'echo step2' },
      { heading: 'Step Three', body: `Third body for ${label}.`, proofCmd: 'echo step3' }
    ]);

    const storeResult = await mcpConnection.client.callTool({
      name: 'train',
      arguments: { content: doc, llm_model_id: 'test-model-kairos-next', force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });

    const parsed = parseMcpJson(storeResult, '[forward tests] train');
    expect(parsed.status).toBe('stored');
    expect(parsed.items.length).toBeGreaterThanOrEqual(3);
    return parsed.items as Array<{ uri: string; adapter_uri: string }>;
  }
  console.debug('mcpConnection', mcpConnection);

  test('returns continue payload with current_layer and contract', async () => {
    const ts = Date.now();
    const items = await trainThreeStepProtocol(`Squadrules Forward Schema ${ts}`);
    const secondLayerId = layerIdFromUri(items[1].uri);

    const openResult = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: { uri: items[0].adapter_uri }
    });
    const beginPayload = parseMcpJson(openResult, '[forward] step 1');
    const nonce = beginPayload.contract?.nonce;
    const proofHash = beginPayload.contract?.proof_hash || beginPayload.contract?.genesis_hash;

    const solution = {
      type: 'shell',
      nonce,
      proof_hash: proofHash,
      shell: { exit_code: 0, stdout: 'step1' }
    };
    const call = { name: 'forward', arguments: { uri: beginPayload.current_layer.uri, solution } };
    const result = await mcpConnection.client.callTool(call);
    const payload = parseMcpJson(result, '[forward] continue payload');

    withRawOnFail({ call, result }, () => {
      expect(payload.must_obey).toBe(true);
      expect(payload.current_layer).toBeDefined();
      expect(layerIdFromUri(payload.current_layer.uri)).toBe(secondLayerId);
      expect(payload.current_layer.mimeType).toBe('text/markdown');
      expect(payload.current_layer.content).toContain('Second body');
      expect(payload.contract).toBeDefined();
      if (payload.contract.shell) {
        expect(payload.contract.shell.cmd).toContain('step2');
        expect(payload.contract.shell.timeout_seconds).toBe(30);
      }
      expect(typeof payload.next_action).toBe('string');
      expect(payload.next_action).toContain('kairos://layer/');
      if (payload.proof_hash) {
        expect(typeof payload.proof_hash).toBe('string');
      }
      expect(payload.next_step).toBeUndefined();
      expect(payload.protocol_status).toBeUndefined();
      expect(payload.last_proof_hash).toBeUndefined();
    }, '[forward] continue payload with raw result');
  }, 30000);

  test('returns completed payload when final step', async () => {
    const ts = Date.now();
    const items = await trainTwoStepProtocol(`Squadrules Forward Final ${ts}`);
    const lastLayerId = layerIdFromUri(items[items.length - 1].uri);

    const openResult = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: { uri: items[0].adapter_uri }
    });
    const beginPayload = parseMcpJson(openResult, '[forward] open');
    let nonce = beginPayload.contract?.nonce;
    let proofHash = beginPayload.contract?.proof_hash || beginPayload.contract?.genesis_hash;
    let layerUri = beginPayload.current_layer.uri as string;

    const submission1 = {
      type: 'shell',
      nonce,
      proof_hash: proofHash,
      shell: { exit_code: 0, stdout: 'step1' }
    };
    const result1 = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: { uri: layerUri, solution: submission1 }
    });
    const payload1 = parseMcpJson(result1, '[forward] after step 1');
    nonce = payload1.contract?.nonce;
    proofHash = payload1.proof_hash ?? payload1.contract?.proof_hash ?? proofHash;
    layerUri = payload1.current_layer.uri as string;

    const submission2 = {
      type: 'shell',
      nonce,
      proof_hash: proofHash,
      shell: { exit_code: 0, stdout: 'step2' }
    };
    const call = { name: 'forward', arguments: { uri: layerUri, solution: submission2 } };
    const result = await mcpConnection.client.callTool(call);
    const payload = parseMcpJson(result, '[forward] completed payload');

    withRawOnFail({ call, result }, () => {
      expect(payload.must_obey).toBe(true);
      expect(layerIdFromUri(payload.current_layer.uri)).toBe(lastLayerId);
      expect(
        payload.current_layer.content.includes('Second body') ||
          payload.current_layer.content.includes('Completion') ||
          payload.current_layer.content.includes('all steps')
      ).toBe(true);
      expect(payload.contract).toBeDefined();
      if (payload.contract.shell) {
        expect(payload.contract.shell.cmd).toContain('step2');
      }
      expect(typeof payload.next_action).toBe('string');
      expect(payload.next_action).toMatch(/reward/i);
      expect(payload.final_challenge).toBeUndefined();
      expect(payload.protocol_status).toBeUndefined();
      expect(payload.attest_required).toBeUndefined();
      expect(payload.next_step).toBeUndefined();
    }, '[forward] completed payload with raw result');
  }, 30000);
});
