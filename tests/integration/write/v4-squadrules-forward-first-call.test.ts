/**
 * Forward tool response shape tests (entry pass without solution).
 */
import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson, withRawOnFail } from '../../utils/expect-with-raw.js';
import { buildProofMarkdown } from '../../utils/proof-of-work.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

function layerIdFromUri(uri: string): string {
  const base = uri.split('?')[0] ?? uri;
  return base.split('/').pop() ?? '';
}

describe('v4-forward first-call response schema', () => {
  let mcpConnection;

  // createMcpConnection health poll can run up to 60s; Jest default hook timeout is too low
  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  }, 120000);

  afterAll(async () => {
    if (mcpConnection) await mcpConnection.close();
  });

  async function trainTwoStepProtocol(label: string, slug?: string) {
    const frontmatter = slug ? `---\nslug: ${slug}\n---\n\n` : '';
    const doc = `${frontmatter}${buildProofMarkdown(label, [
      { heading: 'Step One', body: `First body for ${label}.`, proofCmd: 'echo step1' },
      { heading: 'Step Two', body: `Second body for ${label}.`, proofCmd: 'echo step2' }
    ])}`;
    const storeResult = await mcpConnection.client.callTool({
      name: 'train',
      arguments: { content: doc, llm_model_id: 'test-v4-forward-first-call', force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });
    const parsed = parseMcpJson(storeResult, 'v4-forward first-call train');
    expect(parsed.status).toBe('stored');
    return parsed.items as Array<{ uri: string; adapter_uri: string }>;
  }

  test('multi-step: must_obey true, contract, current_layer, next_action references forward', async () => {
    const ts = Date.now();
    const items = await trainTwoStepProtocol(`V4ForwardFirstCall Multi ${ts}`);
    const adapterUri = items[0].adapter_uri;

    const call = { name: 'forward', arguments: { uri: adapterUri } };
    const result = await mcpConnection.client.callTool(call);
    const parsed = parseMcpJson(result, 'v4-forward first-call');

    withRawOnFail({ call, result }, () => {
      expect(parsed.must_obey).toBe(true);
      expect(parsed.current_layer).toBeDefined();
      expect(parsed.current_layer.uri).toMatch(/^squadrules:\/\/layer\/[0-9a-f-]{36}(?:\?execution_id=[0-9a-f-]{36})?$/i);
      expect(parsed.current_layer.mimeType).toBe('text/markdown');
      expect(parsed.contract).toBeDefined();
      expect(parsed.contract.type).toBe('shell');

      expect(typeof parsed.next_action).toBe('string');
      expect(parsed.next_action.toLowerCase()).toContain('forward');
      expect(parsed.next_action).toContain('solution.type="shell"');
      expect(parsed.next_action).toContain('outcome="success"');
      expect(parsed.next_action).toContain('evidence');
      expect(parsed.execution_id).toBeDefined();

      expect(parsed.next_step).toBeUndefined();
      expect(parsed.protocol_status).toBeUndefined();
      expect(parsed.challenge).toBeUndefined();
    });
  });

  test('opening with second layer URI starts execution at that layer (no silent redirect to step 1)', async () => {
    const ts = Date.now();
    const items = await trainTwoStepProtocol(`V4ForwardFirstCall Redirect ${ts}`);
    const secondUri = items[1].uri;
    const firstLayerId = layerIdFromUri(items[0].uri);

    const call = { name: 'forward', arguments: { uri: secondUri } };
    const result = await mcpConnection.client.callTool(call);
    const parsed = parseMcpJson(result, 'v4-forward first-call second layer');

    withRawOnFail({ call, result }, () => {
      expect(parsed.must_obey).toBe(true);
      expect(parsed.current_layer).toBeDefined();
      expect(layerIdFromUri(parsed.current_layer.uri)).not.toBe(firstLayerId);
    });
  });

  test('opening with adapter slug URI starts execution at the head layer', async () => {
    const ts = Date.now();
    const slug = `v4-forward-first-call-slug-${ts}`;
    const items = await trainTwoStepProtocol(`V4ForwardFirstCall Slug ${ts}`, slug);
    const firstLayerId = layerIdFromUri(items[0].uri);

    const call = { name: 'forward', arguments: { uri: `squadrules://adapter/${slug}` } };
    const result = await mcpConnection.client.callTool(call);
    const parsed = parseMcpJson(result, 'v4-forward first-call slug');

    withRawOnFail({ call, result }, () => {
      expect(parsed.must_obey).toBe(true);
      expect(parsed.current_layer).toBeDefined();
      expect(layerIdFromUri(parsed.current_layer.uri)).toBe(firstLayerId);
      expect(parsed.contract).toBeDefined();
      expect(typeof parsed.next_action).toBe('string');
      expect(parsed.next_action.toLowerCase()).toContain('forward');
    });
  });

  const REFINING_ADAPTER_URI = 'squadrules://adapter/refine-search';

  test('refining protocol: forward with refine adapter returns comment contract', async () => {
    const call = { name: 'forward', arguments: { uri: REFINING_ADAPTER_URI } };
    const result = await mcpConnection.client.callTool(call);
    const parsed = parseMcpJson(result, 'v4-forward first-call refining');

    withRawOnFail({ call, result }, () => {
      expect(parsed.must_obey).toBe(true);
      expect(parsed.current_layer).toBeDefined();
      expect(typeof parsed.current_layer.content).toBe('string');
      if (parsed.current_layer.content.length > 0) {
        expect(parsed.current_layer.content).toMatch(/refin|Extract|user/i);
      }
      expect(parsed.contract).toBeDefined();
      expect(parsed.contract.type).toBe('comment');
      expect(typeof parsed.next_action).toBe('string');
      expect(parsed.next_action.toLowerCase()).toContain('forward');
    });
  });

  test('refining protocol: comment solution advances to next layer', async () => {
    const beginResult = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: { uri: REFINING_ADAPTER_URI }
    });
    const beginPayload = parseMcpJson(beginResult, 'v4-forward first-call refine step1');
    const layerUri = beginPayload.current_layer.uri as string;
    const nonce = beginPayload.contract?.nonce;
    const proofHash = beginPayload.contract?.proof_hash;

    const nextResult = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: {
        uri: layerUri,
        solution: {
          type: 'comment',
          comment: { text: 'Extracted goal: refine search; context: SQUADRULES; gaps: none. Genuine summary for step 1.' },
          nonce,
          proof_hash: proofHash
        }
      }
    });
    const nextPayload = parseMcpJson(nextResult, 'v4-forward first-call refine step2');

    withRawOnFail({ beginResult, nextResult }, () => {
      expect(nextPayload.error_code).toBeUndefined();
      expect(nextPayload.current_layer?.uri).toBeDefined();
      expect(['mcp', 'comment']).toContain(nextPayload.contract?.type);
      expect(typeof nextPayload.next_action).toBe('string');
      expect(nextPayload.next_action.toLowerCase()).toMatch(/forward|reward/);
    });
  });

  test('single-step adapter: next_action directs to forward or reward', async () => {
    const ts = Date.now();
    const doc = `# V4ForwardFirstCall Single ${ts}

## Activation Patterns
Run when user says "v4 forward first call single".

## Only Step
Do the thing.

\`\`\`json
{"contract":{"type":"comment","comment":{"min_length":10},"required":true}}
\`\`\`

## Reward Signal
Only after all steps.`;
    const storeResult = await mcpConnection.client.callTool({
      name: 'train',
      arguments: { content: doc, llm_model_id: 'test-v4-forward-first-call', force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });
    const stored = parseMcpJson(storeResult, 'v4-forward first-call single train');
    const uri = (stored.items as Array<{ adapter_uri: string }>)[0].adapter_uri;

    const call = { name: 'forward', arguments: { uri } };
    const result = await mcpConnection.client.callTool(call);
    const parsed = parseMcpJson(result, 'v4-forward first-call single');

    withRawOnFail({ call, result }, () => {
      expect(parsed.must_obey).toBe(true);
      expect(parsed.next_action).toMatch(/forward|reward/i);
      expect(parsed.final_challenge).toBeUndefined();
    });
  });
});
