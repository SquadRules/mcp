/**
 * Forward contract: forward.target enforcement end-to-end (ADR 0025/0028).
 *
 * The retired `type:"mcp"` contract (tool_name + arguments.uri) is replaced by
 * a flat `forward.target` adapter URI. Every way the submitted evidence.target
 * can fail to be the contracted target collapses into one wire code:
 * FORWARD_TARGET_MISMATCH.
 */
import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson, withRawOnFail } from '../../utils/expect-with-raw.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

const TARGET_SLUG = 'target-slug';
const CONTRACTED_TARGET = `squadrules://adapter/${TARGET_SLUG}`;

function trainSingleForwardLayer(title: string, targetSlug: string) {
  const fence = JSON.stringify({
    contract: {
      type: 'forward',
      forward: { target: `squadrules://adapter/${targetSlug}` },
      required: true
    }
  });
  return `# ${title}

## Activation Patterns
Run for forward contract target integration test.

## Forward proof step
Complete the forward challenge.

\`\`\`json
${fence}
\`\`\`

## Reward Signal
Only after the proof step.
`;
}

/** Train the fixture adapter and open a run, returning the layer URI + echoed challenge fields. */
async function openForwardRun(mcpConnection: Awaited<ReturnType<typeof createMcpConnection>>, title: string) {
  const doc = trainSingleForwardLayer(title, TARGET_SLUG);
  const storeResult = await mcpConnection.client.callTool({
    name: 'train',
    arguments: {
      content: doc,
      llm_model_id: 'test-v4-forward-contract-target',
      force_update: true,
      review_evidence: MOCK_REVIEW_EVIDENCE
    }
  });
  const stored = parseMcpJson(storeResult, `${title} train`);
  expect(stored.status).toBe('stored');
  const adapterUri = (stored.items as Array<{ adapter_uri: string }>)[0].adapter_uri;

  const open = await mcpConnection.client.callTool({ name: 'forward', arguments: { uri: adapterUri } });
  const openPayload = parseMcpJson(open, `${title} open`);
  return {
    open,
    openPayload,
    layerUri: openPayload.current_layer.uri as string,
    nonce: openPayload.contract?.nonce,
    proofHash: openPayload.contract?.proof_hash
  };
}

describe('v4-forward contract target enforcement', () => {
  let mcpConnection: Awaited<ReturnType<typeof createMcpConnection>>;

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  }, 120000);

  afterAll(async () => {
    if (mcpConnection) await mcpConnection.close();
  });

  test('opening the run exposes the flat forward.target contract', async () => {
    const { openPayload } = await openForwardRun(mcpConnection, `ForwardTargetShape ${Date.now()}`);
    withRawOnFail({ openPayload }, () => {
      expect(openPayload.contract?.type).toBe('forward');
      expect(openPayload.contract?.forward).toMatchObject({ target: CONTRACTED_TARGET });
      // The retired tool_name/arguments shape must not leak back onto the wire.
      expect(openPayload.contract?.forward).not.toHaveProperty('tool_name');
      expect(openPayload.contract?.forward).not.toHaveProperty('arguments');
    });
  });

  test('different slug yields FORWARD_TARGET_MISMATCH', async () => {
    const run = await openForwardRun(mcpConnection, `ForwardTargetWrongSlug ${Date.now()}`);

    const bad = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: {
        uri: run.layerUri,
        solution: {
          type: 'forward',
          outcome: 'success',
          nonce: run.nonce,
          proof_hash: run.proofHash,
          evidence: { target: 'squadrules://adapter/wrong-slug', success: true }
        }
      }
    });
    const badPayload = parseMcpJson(bad, 'forward-target wrong slug');
    withRawOnFail({ open: run.open, bad }, () => {
      expect(badPayload.error_code).toBe('FORWARD_TARGET_MISMATCH');
      expect(String(badPayload.message ?? '')).toContain(CONTRACTED_TARGET);
    });
  });

  test('non-adapter URI scheme yields FORWARD_TARGET_MISMATCH', async () => {
    const run = await openForwardRun(mcpConnection, `ForwardTargetBadScheme ${Date.now()}`);

    const bad = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: {
        uri: run.layerUri,
        solution: {
          type: 'forward',
          outcome: 'success',
          nonce: run.nonce,
          proof_hash: run.proofHash,
          evidence: { target: 'https://example.com/adapter/target-slug', success: true }
        }
      }
    });
    const badPayload = parseMcpJson(bad, 'forward-target bad scheme');
    withRawOnFail({ open: run.open, bad }, () => {
      expect(badPayload.error_code).toBe('FORWARD_TARGET_MISMATCH');
    });
  });

  test('missing target yields FORWARD_TARGET_MISMATCH', async () => {
    const run = await openForwardRun(mcpConnection, `ForwardTargetMissing ${Date.now()}`);

    const bad = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: {
        uri: run.layerUri,
        solution: {
          type: 'forward',
          outcome: 'success',
          nonce: run.nonce,
          proof_hash: run.proofHash,
          evidence: { success: true }
        }
      }
    });
    const badPayload = parseMcpJson(bad, 'forward-target missing target');
    withRawOnFail({ open: run.open, bad }, () => {
      expect(badPayload.error_code).toBe('FORWARD_TARGET_MISMATCH');
    });
  });

  test('matching target advances run', async () => {
    const run = await openForwardRun(mcpConnection, `ForwardTargetMatch ${Date.now()}`);

    const ok = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: {
        uri: run.layerUri,
        solution: {
          type: 'forward',
          outcome: 'success',
          nonce: run.nonce,
          proof_hash: run.proofHash,
          evidence: { target: CONTRACTED_TARGET, success: true }
        }
      }
    });
    const nextPayload = parseMcpJson(ok, 'forward-target match');
    withRawOnFail({ open: run.open, ok }, () => {
      expect(nextPayload.error_code).toBeUndefined();
      // Single-layer adapter: same layer URI, next_action directs to reward.
      expect(String(nextPayload.next_action ?? '')).toMatch(/reward/i);
    });
  });
});
