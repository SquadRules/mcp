import { isDeepStrictEqual } from 'node:util';
import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { withRawOnFail } from '../../utils/expect-with-raw.js';
import {
  isMcpListedEmptyObjectParamsSchema,
  schemaHasObjectBranchWithProps,
  schemaHasPropertyPath
} from '../../utils/mcp-list-tools-schema-helpers.js';
import { zodToInputJsonSchema } from '../../../src/utils/zod-to-jsonschema.js';
import { activateInputSchema } from '../../../src/tools/activate_schema.js';
import { forwardInputSchema } from '../../../src/tools/forward_schema.js';
import { rewardInputSchema } from '../../../src/tools/reward_schema.js';
import { trainInputSchema } from '../../../src/tools/train_schema.js';
import { tuneInputSchema } from '../../../src/tools/tune_schema.js';
import { deleteInputSchema } from '../../../src/tools/delete_schema.js';
import { exportInputSchema } from '../../../src/tools/export_schema.js';
import { spacesInputSchema } from '../../../src/tools/spaces_schema.js';

describe('tools/list strict schema parity', () => {
  let mcpConnection: Awaited<ReturnType<typeof createMcpConnection>>;
  /** Tools registered with `mcpLooseToolInput(strict)` list `{}` in tools/list; `forward` may use wire or loose — see forward test below. */
  const TOOL_SCHEMAS = {
    activate: activateInputSchema,
    reward: rewardInputSchema,
    train: trainInputSchema,
    tune: tuneInputSchema,
    delete: deleteInputSchema,
    export: exportInputSchema,
    spaces: spacesInputSchema
  } as const;

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  }, 60000);

  afterAll(async () => {
    await mcpConnection.close();
  });

  test('every SQUADRULES tool inputSchema equals strict Zod JSON Schema', async () => {
    const listResponse = await mcpConnection.client.listTools({});
    withRawOnFail(listResponse, () => {
      for (const [toolName, schema] of Object.entries(TOOL_SCHEMAS)) {
        const tool = listResponse.tools.find((t) => t.name === toolName);
        expect(tool).toBeDefined();
        expect(tool?.inputSchema).toBeDefined();
        const expected = zodToInputJsonSchema(schema);
        expect(tool?.inputSchema).toEqual(expected);
      }
    }, '[tools/list] strict parity');
  });

  test('tools/list forward: strict Zod parity, wire hints, or empty listing when SDK omits union object shape', async () => {
    const listResponse = await mcpConnection.client.listTools({});
    withRawOnFail(listResponse, () => {
      const tool = listResponse.tools.find((t) => t.name === 'forward');
      expect(tool).toBeDefined();
      expect(tool?.inputSchema).toBeDefined();
      const schema = tool?.inputSchema;
      const expectedStrict = zodToInputJsonSchema(forwardInputSchema);
      if (!isMcpListedEmptyObjectParamsSchema(schema) && !isDeepStrictEqual(schema, expectedStrict)) {
        expect(schemaHasObjectBranchWithProps(schema, ['uri', 'solution'])).toBe(true);
        expect(schemaHasPropertyPath(schema, ['solution', 'mcp', 'success'])).toBe(true);
        expect(schemaHasPropertyPath(schema, ['solution', 'comment', 'text'])).toBe(true);
      }
      const desc = String(tool?.description);
      expect(desc).toMatch(/solution\.type|contract\.type/);
      expect(desc).toMatch(/omit|first call/i);
      expect(desc).toContain('execution_id');
    }, '[tools/list] forward schema');
  });

  test('adapter URI regexes in activate/forward listings are slug-only', async () => {
    const listResponse = await mcpConnection.client.listTools({});
    withRawOnFail(listResponse, () => {
      for (const name of ['activate', 'forward'] as const) {
        const tool = listResponse.tools.find((t) => t.name === name);
        expect(tool).toBeDefined();
        const bundle = `${String(tool?.description)}\n${JSON.stringify(tool?.inputSchema)}\n${JSON.stringify(tool?.outputSchema)}`;
        expect(bundle).toMatch(/squadrules:.*adapter/);
        expect(bundle).toMatch(/<slug>|\{slug\}|slug-only/);
        expect(bundle).not.toContain('{uuid|slug}');
      }
    }, '[tools/list] slug-only adapter regex');
  });
});
