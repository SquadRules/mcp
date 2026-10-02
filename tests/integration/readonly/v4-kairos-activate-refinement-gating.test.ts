// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import crypto from 'node:crypto';
import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson, withRawOnFail } from '../../utils/expect-with-raw.js';
import { getTestSpaceId } from '../../utils/auth-headers.js';
import type { ActivateChoice } from '../v4-activate-test-helpers.js';

const URI_REFINE_SEARCH = 'kairos://adapter/refine-search' as const;
const URI_CREATE_PROTOCOL = 'kairos://adapter/create-new-protocol' as const;

describe('v4-activate refinement gating', () => {
  let mcpConnection: Awaited<ReturnType<typeof createMcpConnection>>;

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  }, 30000);

  afterAll(async () => {
    if (mcpConnection) {
      await mcpConnection.close();
    }
  });

  async function activateQuery(query: string, executionId: string) {
    const args: { query: string; space_id?: string; execution_id: string } = { query, execution_id: executionId };
    const spaceId = getTestSpaceId();
    if (spaceId) args.space_id = spaceId;
    const call = { name: 'activate' as const, arguments: args };
    const result = await mcpConnection.client.callTool(call);
    return { call, result, parsed: parseMcpJson(result, 'v4-activate-refinement-gating') };
  }

  test('removes refine footer after second refined activate call', async () => {
    const ts = Date.now();
    const executionId = crypto.randomUUID();
    const gibberish = `XyZ123GarbageV4RefineGate${ts}NoOneSearchesThis`;

    const first = await activateQuery(gibberish, executionId);
    const second = await activateQuery(`${gibberish} Two`, executionId);
    const third = await activateQuery(`${gibberish} Three`, executionId);

    withRawOnFail({ call: first.call, result: first.result }, () => {
      expect(first.parsed.execution_id).toBe(executionId);
      const refineChoice = first.parsed.choices.find((c: ActivateChoice) => c.role === 'refine');
      const createChoice = first.parsed.choices.find((c: ActivateChoice) => c.role === 'create');
      expect(refineChoice).toBeDefined();
      expect(refineChoice!.uri).toBe(URI_REFINE_SEARCH);
      expect(createChoice).toBeDefined();
      expect(createChoice!.uri).toBe(URI_CREATE_PROTOCOL);
    });

    withRawOnFail({ call: second.call, result: second.result }, () => {
      expect(second.parsed.execution_id).toBe(executionId);
      const refineChoice = second.parsed.choices.find((c: ActivateChoice) => c.role === 'refine');
      const createChoice = second.parsed.choices.find((c: ActivateChoice) => c.role === 'create');
      expect(refineChoice).toBeDefined();
      expect(refineChoice!.uri).toBe(URI_REFINE_SEARCH);
      expect(createChoice).toBeDefined();
      expect(createChoice!.uri).toBe(URI_CREATE_PROTOCOL);
    });

    withRawOnFail({ call: third.call, result: third.result }, () => {
      expect(third.parsed.execution_id).toBe(executionId);
      const refineChoice = third.parsed.choices.find((c: ActivateChoice) => c.role === 'refine');
      const createChoice = third.parsed.choices.find((c: ActivateChoice) => c.role === 'create');
      expect(refineChoice).toBeUndefined();
      expect(createChoice).toBeDefined();
      expect(createChoice!.uri).toBe(URI_CREATE_PROTOCOL);
    });
  }, 45000);
});

