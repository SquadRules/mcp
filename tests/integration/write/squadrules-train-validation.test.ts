import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

/**
 * Integration tests for the **`train`** tool: validation and error handling when
 * registering adapters from markdown.
 *
 * Goals:
 * - Verify error handling for invalid inputs.
 * - When something goes wrong, surface the raw MCP result
 *   instead of wrapping it in an extra "Failed to parse..." error.
 */

describe('Train tool validation', () => {
  let mcpConnection;

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  });

  afterAll(async () => {
    if (mcpConnection) {
      await mcpConnection.close();
    }
  });

  test('train returns PROTOCOL_STRUCTURE_INVALID for incomplete markdown', async () => {
    const incompleteMd = `# My Protocol

## Step 1 First
Content without Activation Patterns.

\`\`\`json
{"contract":{"type":"comment","comment":{"min_length":10},"required":true}}
\`\`\`

## Reward Signal
Done.`;

    const result = await mcpConnection.client.callTool({
      name: 'train',
      arguments: {
        content: incompleteMd,
        llm_model_id: 'minimax/minimax-m2:free',
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
    const body = JSON.parse(result.content[0].text);
    expect(body.error).toBe('PROTOCOL_STRUCTURE_INVALID');
    expect(body.must_obey).toBe(true);
    expect(body.next_action).toContain('forward');
    expect(body.next_action).toMatch(/create-new-protocol|squadrules:\/\/adapter\/create-new-protocol/i);
    expect(Array.isArray(body.missing)).toBe(true);
    expect(body.missing).toContain('activation_patterns');
    expect(body.message).toMatch(/Activation Patterns|required structure/i);
  });

  test('train returns PROTOCOL_STRUCTURE_INVALID for invalid contract type placeholder', async () => {
    const badTypeMd = `# Bad Type Protocol ${Date.now()}

## Activation Patterns

Run when testing invalid challenge types.

## Step 1

Bad illustrative type.

\`\`\`json
{"contract":{"type":"comment|user_input|mcp|shell","comment":{"min_length":10},"required":true}}
\`\`\`

## Reward Signal

Done.`;

    const result = await mcpConnection.client.callTool({
      name: 'train',
      arguments: {
        content: badTypeMd,
        llm_model_id: 'minimax/minimax-m2:free',
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });

    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text);
    expect(body.error).toBe('PROTOCOL_STRUCTURE_INVALID');
    expect(body.missing).toContain('invalid_contract_type');
    expect(body.message).toMatch(/tensor, shell, mcp, user_input, or comment/i);
  });

  test('train stores valid markdown with required sections (no regression)', async () => {
    const validMd = `# Valid Protocol ${Date.now()}

## Activation Patterns
Run when user says "run valid protocol".

## Step 1
Do something.

\`\`\`json
{"contract":{"type":"comment","comment":{"min_length":10},"required":true}}
\`\`\`

## Reward Signal
Only after all steps.`;

    const result = await mcpConnection.client.callTool({
      name: 'train',
      arguments: {
        content: validMd,
        llm_model_id: 'minimax/minimax-m2:free',
        force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0].text);
    expect(body.status).toBe('stored');
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.items[0].uri).toMatch(/^squadrules:\/\/layer\//);
    expect(body.items[0].adapter_uri).toMatch(/^squadrules:\/\/adapter\//);
  });

  test('train reports clear error for empty content', async () => {
    const result = await mcpConnection.client.callTool({
      name: 'train',
      arguments: {
        content: '',
        llm_model_id: 'minimax/minimax-m2:free'
      }
    });

    // Empty content fails strict train input validation; handler returns INVALID_TOOL_INPUT JSON (not SDK-only text).
    expect(result).toBeDefined();
    expect(result.isError).toBe(true);
    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Input validation error');
    expect(result.content[0].text).toContain('content');
    const emptyMdBody = JSON.parse(result.content[0].text);
    expect(emptyMdBody.error).toBe('INVALID_TOOL_INPUT');
    expect(emptyMdBody.next_action).toBeDefined();
  });

  test('train validates required parameters', async () => {
    // Test missing input
    const result1 = await mcpConnection.client.callTool({
      name: 'train',
      arguments: {
        llm_model_id: 'minimax/minimax-m2:free'
      }
    });
    expect(result1.isError).toBe(true);
    expect(result1.content[0].text).toContain('Input validation error');
    expect(result1.content[0].text).toContain('content');
    expect(JSON.parse(result1.content[0].text).error).toBe('INVALID_TOOL_INPUT');

    // Test missing llm_model_id
    const result2 = await mcpConnection.client.callTool({
      name: 'train',
      arguments: {
        content: 'test content',
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });
    expect(result2.isError).toBe(true);
    expect(result2.content[0].text).toContain('Input validation error');
    expect(result2.content[0].text).toContain('llm_model_id');
    expect(JSON.parse(result2.content[0].text).error).toBe('INVALID_TOOL_INPUT');

    // Test empty llm_model_id
    const result3 = await mcpConnection.client.callTool({
      name: 'train',
      arguments: {
        content: 'test content',
        llm_model_id: '',
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });
    expect(result3.isError).toBe(true);
    expect(result3.content[0].text).toContain('Input validation error');
    expect(result3.content[0].text).toContain('llm_model_id');
    expect(JSON.parse(result3.content[0].text).error).toBe('INVALID_TOOL_INPUT');
  });
});
