/**
 * Forward MCP proof: contract tool_name + arguments enforcement (issue #311).
 */
import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson, withRawOnFail } from '../../utils/expect-with-raw.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

function trainSingleMcpLayer(title: string, tool: string, args?: Record<string, unknown>) {
  const mcp: Record<string, unknown> = { tool_name: tool };
  if (args !== undefined) mcp.arguments = args;
  const fence = JSON.stringify({
    contract: {
      type: 'mcp',
      mcp,
      required: true
    }
  });
  return `# ${title}

## Activation Patterns
Run for MCP contract args integration test.

## MCP proof step
Complete the MCP challenge.

\`\`\`json
${fence}
\`\`\`

## Reward Signal
Only after the proof step.
`;
}

describe('v4-forward MCP contract tool and arguments', () => {
  let mcpConnection: Awaited<ReturnType<typeof createMcpConnection>>;

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  }, 120000);

  afterAll(async () => {
    if (mcpConnection) await mcpConnection.close();
  });

  test('wrong tool_name yields MCP_TOOL_MISMATCH', async () => {
    const ts = Date.now();
    const doc = trainSingleMcpLayer(`McpContractArgs ${ts}`, 'spaces', { limit: 1 });
    const storeResult = await mcpConnection.client.callTool({
      name: 'train',
      arguments: { content: doc, llm_model_id: 'test-v4-mcp-contract-args', force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });
    const stored = parseMcpJson(storeResult, 'mcp-args train');
    expect(stored.status).toBe('stored');
    const adapterUri = (stored.items as Array<{ adapter_uri: string }>)[0].adapter_uri;

    const open = await mcpConnection.client.callTool({ name: 'forward', arguments: { uri: adapterUri } });
    const openPayload = parseMcpJson(open, 'mcp-args open');
    const layerUri = openPayload.current_layer.uri as string;
    const nonce = openPayload.contract?.nonce;
    const proofHash = openPayload.contract?.proof_hash;

    const bad = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: {
        uri: layerUri,
        solution: {
          type: 'mcp',
          nonce,
          proof_hash: proofHash,
          mcp: {
            tool_name: 'forward',
            arguments: { limit: 1 },
            result: {},
            success: true
          }
        }
      }
    });
    const badPayload = parseMcpJson(bad, 'mcp-args wrong tool');
    withRawOnFail({ open, bad }, () => {
      expect(badPayload.error_code).toBe('MCP_TOOL_MISMATCH');
    });
  });

  test('wrong arguments yields MCP_ARGUMENTS_MISMATCH', async () => {
    const ts = Date.now();
    const doc = trainSingleMcpLayer(`McpContractArgs2 ${ts}`, 'spaces', { limit: 1 });
    const storeResult = await mcpConnection.client.callTool({
      name: 'train',
      arguments: { content: doc, llm_model_id: 'test-v4-mcp-contract-args', force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });
    const stored = parseMcpJson(storeResult, 'mcp-args2 train');
    const adapterUri = (stored.items as Array<{ adapter_uri: string }>)[0].adapter_uri;

    const open = await mcpConnection.client.callTool({ name: 'forward', arguments: { uri: adapterUri } });
    const openPayload = parseMcpJson(open, 'mcp-args2 open');
    const layerUri = openPayload.current_layer.uri as string;
    const nonce = openPayload.contract?.nonce;
    const proofHash = openPayload.contract?.proof_hash;

    const bad = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: {
        uri: layerUri,
        solution: {
          type: 'mcp',
          nonce,
          proof_hash: proofHash,
          mcp: {
            tool_name: 'spaces',
            arguments: { limit: 2 },
            result: {},
            success: true
          }
        }
      }
    });
    const badPayload = parseMcpJson(bad, 'mcp-args2 wrong args');
    withRawOnFail({ open, bad }, () => {
      expect(badPayload.error_code).toBe('MCP_ARGUMENTS_MISMATCH');
    });
  });

  test('matching tool_name and arguments advances run', async () => {
    const ts = Date.now();
    const doc = trainSingleMcpLayer(`McpContractArgs3 ${ts}`, 'spaces', { limit: 1 });
    const storeResult = await mcpConnection.client.callTool({
      name: 'train',
      arguments: { content: doc, llm_model_id: 'test-v4-mcp-contract-args', force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });
    const stored = parseMcpJson(storeResult, 'mcp-args3 train');
    const adapterUri = (stored.items as Array<{ adapter_uri: string }>)[0].adapter_uri;

    const open = await mcpConnection.client.callTool({ name: 'forward', arguments: { uri: adapterUri } });
    const openPayload = parseMcpJson(open, 'mcp-args3 open');
    const layerUri = openPayload.current_layer.uri as string;
    const nonce = openPayload.contract?.nonce;
    const proofHash = openPayload.contract?.proof_hash;

    const ok = await mcpConnection.client.callTool({
      name: 'forward',
      arguments: {
        uri: layerUri,
        solution: {
          type: 'mcp',
          nonce,
          proof_hash: proofHash,
          mcp: {
            tool_name: 'spaces',
            arguments: { limit: 1, extra: true },
            result: { ok: true },
            success: true
          }
        }
      }
    });
    const nextPayload = parseMcpJson(ok, 'mcp-args3 ok');
    withRawOnFail({ open, ok }, () => {
      expect(nextPayload.error_code).toBeUndefined();
      // Single-layer adapter: same layer URI, next_action directs to reward.
      expect(String(nextPayload.next_action ?? '')).toMatch(/reward/i);
    });
  });
});
