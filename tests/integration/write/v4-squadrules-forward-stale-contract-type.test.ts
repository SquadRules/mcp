/**
 * Stale contract types and malformed delegation lists through the MCP
 * boundary (ADR 0028/0029).
 *
 * tune persists inference_contract fences without the train-time structural
 * validator, so it is the realistic way a contract trained before the
 * mcp→forward rename (type "mcp") or a malformed subagent.mcp list reaches
 * the store. These tests pin what the forward tool does when it opens a run
 * against such a stored contract:
 * - the stale type must surface as an isError response carrying the re-train
 *   guidance — a returned challenge shape with type "mcp" dies in SDK output
 *   validation, so the caller would never see the recovery message;
 * - the malformed delegation list must degrade to a valid challenge instead
 *   of crashing the challenge renderer.
 */
import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson, withRawOnFail } from '../../utils/expect-with-raw.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

const FORWARD_TARGET = 'squadrules://adapter/stale-type-target';
const CONTEXT = 'Export every adapter and report any layer over the 350-line ceiling.';

type McpConnection = Awaited<ReturnType<typeof createMcpConnection>>;

function adapterDoc(title: string, contract: Record<string, unknown>): string {
  return `# ${title}

## Activation Patterns
Run for the stale-contract regression suite.

## Proof step
Complete the challenge.

\`\`\`json
${JSON.stringify({ contract })}
\`\`\`

## Reward Signal
Only after the proof step.
`;
}

/** Train a single-layer adapter with a valid contract and return its adapter URI. */
async function trainAdapter(mcpConnection: McpConnection, title: string, contract: Record<string, unknown>): Promise<string> {
  const train = await mcpConnection.client.callTool({
    name: 'train',
    arguments: {
      content: adapterDoc(title, contract),
      llm_model_id: 'test-forward-stale-contract-type',
      force_update: true,
      review_evidence: MOCK_REVIEW_EVIDENCE
    }
  });
  const stored = parseMcpJson(train, `${title} train`);
  expect(stored.status).toBe('stored');
  return (stored.items as Array<{ adapter_uri: string }>)[0].adapter_uri;
}

/**
 * Overwrite the adapter's stored contract through tune. tune skips the
 * train-time structural validator, so the fence is persisted verbatim — the
 * realistic shape of a stored contract written before the rename.
 */
async function tuneStoredContract(
  mcpConnection: McpConnection,
  title: string,
  adapterUri: string,
  contract: Record<string, unknown>
): Promise<void> {
  const tune = await mcpConnection.client.callTool({
    name: 'tune',
    arguments: {
      uris: [adapterUri],
      content: [adapterDoc(title, contract)],
      review_evidence: MOCK_REVIEW_EVIDENCE
    }
  });
  const tuned = parseMcpJson(tune, `${title} tune`);
  expect(tuned.total_updated).toBeGreaterThanOrEqual(1);
}

describe('forward against contracts persisted by tune without validation', () => {
  let mcpConnection: McpConnection;

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  }, 120000);

  afterAll(async () => {
    if (mcpConnection) await mcpConnection.close();
  });

  test('a stale type:"mcp" contract fails closed with an isError re-train message', async () => {
    const title = `StaleContractType ${Date.now()}`;
    const adapterUri = await trainAdapter(mcpConnection, title, {
      type: 'forward',
      forward: { target: FORWARD_TARGET },
      required: true
    });
    await tuneStoredContract(mcpConnection, title, adapterUri, {
      type: 'mcp',
      mcp: { tool_name: 'forward', arguments: { uri: FORWARD_TARGET } },
      required: true
    });

    const open = await mcpConnection.client.callTool({ name: 'forward', arguments: { uri: adapterUri } });
    const payload = parseMcpJson(open, 'stale-type open');
    withRawOnFail({ open }, () => {
      // The recovery message must reach the caller as an isError payload: the
      // challenge output schema's type enum has no "mcp", so a returned shape
      // would be rejected by SDK output validation and the guidance lost.
      expect((open as { isError?: boolean }).isError).toBe(true);
      expect(payload.error_code).toBe('UNSUPPORTED_CONTRACT_TYPE');
      expect(String(payload.message)).toContain('Unsupported contract type "mcp"');
      expect(String(payload.message)).toContain('mcp→forward rename');
      expect(String(payload.message)).toContain('Re-train');
    });
  }, 60000);

  test('a malformed subagent.mcp value degrades to a valid delegation challenge', async () => {
    const title = `MalformedMcpList ${Date.now()}`;
    const adapterUri = await trainAdapter(mcpConnection, title, {
      type: 'subagent',
      subagent: { context: CONTEXT },
      required: true
    });
    await tuneStoredContract(mcpConnection, title, adapterUri, {
      type: 'subagent',
      subagent: { context: CONTEXT, mcp: 'not-an-array' },
      required: true
    });

    const open = await mcpConnection.client.callTool({ name: 'forward', arguments: { uri: adapterUri } });
    const payload = parseMcpJson(open, 'malformed-mcp open');
    withRawOnFail({ open }, () => {
      // No crash and no isError: the stored junk list is skipped and the
      // challenge still satisfies the output schema's subagent shape.
      expect(Boolean((open as { isError?: boolean }).isError)).toBe(false);
      expect(payload.error_code).toBeUndefined();
      expect(payload.contract?.type).toBe('subagent');
      expect(payload.contract?.subagent).toEqual({ context: CONTEXT });
      expect(String(payload.contract?.description)).toContain(CONTEXT);
      expect(String(payload.contract?.description)).not.toContain('must call these MCP tools');
    });
  }, 60000);
});
