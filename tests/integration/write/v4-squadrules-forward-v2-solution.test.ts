/**
 * Forward tool v2 unified solution envelope tests.
 */
import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson, withRawOnFail } from '../../utils/expect-with-raw.js';
import { buildProofMarkdown } from '../../utils/proof-of-work.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

describe('v4-forward v2 unified solution envelope', () => {
  let mcpConnection: any;

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  }, 30000);

  afterAll(async () => {
    if (mcpConnection) await mcpConnection.close();
  });

  test('v2 shell solution format is accepted and processed correctly', async () => {
    const ts = Date.now();
    const items = await trainThreeStepShellProtocol(`V4ForwardV2Shell ${ts}`);

    // Open the protocol
    const openResult = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: { uri: items[0].adapter_uri }
    });
    const openPayload = parseMcpJson(openResult, 'v4-forward-v2-shell open');
    
    // Submit v2 shell solution
    const shellSolutionResult = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: {
        uri: openPayload.current_layer.uri,
        solution: {
          type: 'shell',
          outcome: 'success',
          evidence: {
            exit_code: 0,
            stdout: 'step1 output',
            stderr: '',
            duration_seconds: 0.15
          },
          nonce: openPayload.contract?.nonce,
          proof_hash: openPayload.contract?.proof_hash || openPayload.contract?.genesis_hash
        }
      }
    });
    const shellSolutionPayload = parseMcpJson(shellSolutionResult, 'v4-forward-v2-shell solution');

    withRawOnFail({ shellSolutionResult, shellSolutionPayload }, () => {
      expect(shellSolutionPayload.error_code).toBeUndefined();
      expect(shellSolutionPayload.must_obey).toBe(true);
      expect(shellSolutionPayload.contract.type).toBe('shell');
      expect(typeof shellSolutionPayload.current_layer.uri).toBe('string');
    });
  });

  test('mixed v1 and v2 solutions work together in same protocol run', async () => {
    const ts = Date.now();
    const items = await trainThreeStepShellProtocol(`V4ForwardMixed ${ts}`);

    // Open the protocol
    const openResult = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: { uri: items[0].adapter_uri }
    });
    let payload = parseMcpJson(openResult, 'v4-forward-mixed open');
    
    // Step 1: v1 shell format
    let stepResult = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: {
        uri: payload.current_layer.uri,
        solution: {
          type: 'shell',
          shell: { exit_code: 0, stdout: 'v1 format' },
          nonce: payload.contract?.nonce,
          proof_hash: payload.contract?.proof_hash || payload.contract?.genesis_hash
        }
      }
    });
    payload = parseMcpJson(stepResult, 'v4-forward-mixed step1');

    // Step 2: v2 shell format
    stepResult = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: {
        uri: payload.current_layer.uri,
        solution: {
          type: 'shell',
          outcome: 'success',
          evidence: {
            exit_code: 0,
            stdout: 'v2 format',
            stderr: '',
            duration_seconds: 0.1
          },
          nonce: payload.contract?.nonce,
          proof_hash: payload.contract?.proof_hash
        }
      }
    });
    payload = parseMcpJson(stepResult, 'v4-forward-mixed step2');

    // Step 3: v1 shell format  
    stepResult = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: {
        uri: payload.current_layer.uri,
        solution: {
          type: 'shell',
          shell: { exit_code: 0, stdout: 'mixed formats work' },
          nonce: payload.contract?.nonce,
          proof_hash: payload.contract?.proof_hash
        }
      }
    });
    const finalPayload = parseMcpJson(stepResult, 'v4-forward-mixed final');

    withRawOnFail({ stepResult, finalPayload }, () => {
      expect(finalPayload.error_code).toBeUndefined();
      expect(finalPayload.must_obey).toBe(true);
      expect(finalPayload.next_action).toMatch(/reward/i);
    });
  });

  async function trainThreeStepShellProtocol(label: string) {
    const doc = buildProofMarkdown(label, [
      { heading: 'Step One', body: `First body for ${label}.`, proofCmd: 'echo step1' },
      { heading: 'Step Two', body: `Second body for ${label}.`, proofCmd: 'echo step2' },
      { heading: 'Step Three', body: `Third body for ${label}.`, proofCmd: 'echo step3' }
    ]);
    const storeResult = await mcpConnection.client.callTool({
      name: 'train',
      arguments: { content: doc, llm_model_id: 'test-v4-forward-v2-solution', force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });
    const parsed = parseMcpJson(storeResult, 'v4-forward-v2-solution train');
    expect(parsed.status).toBe('stored');
    return parsed.items as Array<{ uri: string; adapter_uri: string; layer_uuid: string }>;
  }
});