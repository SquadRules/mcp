import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson } from '../../utils/expect-with-raw.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

/**
 * Train integration tests (basic functionality).
 *
 * Goals:
 * - Verify the happy-path JSON contract of the train tool.
 * - When something goes wrong, surface the raw MCP result
 *   instead of wrapping it in an extra "Failed to parse..." error.
 */

describe('Train basic functionality', () => {
  let mcpConnection;

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  });

  afterAll(async () => {
    if (mcpConnection) {
      await mcpConnection.close();
    }
  });

  // Helper to generate unique markdown with required structure (Activation Patterns first, Reward Signal last)
  function uniqueMd(titlePrefix, sections) {
    const ts = Date.now();
    const h1 = `# ${titlePrefix} ${ts}`;
    const triggers = '\n\n## Activation Patterns\n\nRun when user says "run this".';
    const body = sections
      .map((s, index) => {
        const proofCmd = s.proof || `echo step-${index + 1}`;
        const timeout = s.timeout || 30;
        const cmdEsc = proofCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const block = `\n\n\`\`\`json\n{"contract":{"type":"shell","shell":{"cmd":"${cmdEsc}","timeout_seconds":${timeout}},"required":true}}\n\`\`\``;
        return `\n\n## ${s.h2}\n${s.body}${block}`;
      })
      .join('');
    const completionRule = '\n\n## Reward Signal\n\nOnly after all steps.';
    return `${h1}${triggers}${body}${completionRule}`;
  }

  function expectValidJsonResult(result) {
    return parseMcpJson(result, 'train raw MCP result');
  }

  test('train stores single text content successfully', async () => {
    const md = uniqueMd('Squadrules Train Smoke', [
      { h2: 'Intro', body: 'Alpha content' },
      { h2: 'Details', body: 'Beta content' }
    ]);

    const result = await mcpConnection.client.callTool({
      name: 'train',
      arguments: {
        content: md,
        llm_model_id: 'minimax/minimax-m2:free',
        force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });

    const response = expectValidJsonResult(result);

    expect(response).toHaveProperty('items');
    expect(Array.isArray(response.items)).toBe(true);
    expect(response.items.length).toBeGreaterThanOrEqual(1);

    const item = response.items[0];
    expect(item).toHaveProperty('uri');
    expect(item.uri).toMatch(/^squadrules:\/\/layer\//);
    expect(item).toHaveProperty('layer_uuid');
    expect(typeof item.layer_uuid).toBe('string');
    expect(item.layer_uuid.length).toBeGreaterThan(0);
    expect(item).toHaveProperty('adapter_uri');
    expect(item.adapter_uri).toMatch(/^squadrules:\/\/adapter\//);
    expect(item).toHaveProperty('label');
    expect(typeof item.label).toBe('string');
    expect(item).toHaveProperty('tags');
    expect(Array.isArray(item.tags)).toBe(true);

    expect(response).toHaveProperty('status');
    expect(response.status).toBe('stored');
  }, 20000); // Increase timeout for large document processing

  test('train duplicate policy with label-based adapter UUID and force_update', async () => {
    // 1) Create timestamp for a unique adapter label; include required Activation Patterns and Reward Signal
    const ts = Date.now().toString();
    const md = `# Unique Store ${ts}

## Activation Patterns
Run when user says "unique store".

## Step 1
Alpha

\`\`\`json
{"contract":{"type":"shell","shell":{"cmd":"echo alpha","timeout_seconds":5},"required":true}}
\`\`\`

## Step 2
Beta

\`\`\`json
{"contract":{"type":"shell","shell":{"cmd":"echo beta","timeout_seconds":5},"required":true}}
\`\`\`

## Reward Signal
Only after all steps.`;

    // 2) First store → stored (force_update bypasses similarity check in shared dev collection)
    const first = await mcpConnection.client.callTool({
      name: 'train',
      arguments: {
        content: md,
        llm_model_id: 'minimax/minimax-m2:free',
        force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });
    const firstParsed = expectValidJsonResult(first);
    expect(firstParsed.status).toBe('stored');
    expect(Array.isArray(firstParsed.items)).toBe(true);
    expect(firstParsed.items.length).toBeGreaterThanOrEqual(1);

    // 3) Second store (same H1) -> error DUPLICATE_ADAPTER
    const second = await mcpConnection.client.callTool({
      name: 'train',
      arguments: {
        content: md,
        llm_model_id: 'minimax/minimax-m2:free',
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });
    expect(second).toBeDefined();
    expect(second.isError).toBe(true);
    expect(second.content).toBeDefined();
    const dupBody = JSON.parse(second.content[0].text);
    // Second store without force_update: DUPLICATE_ADAPTER or SIMILAR_MEMORY_FOUND (both indicate existing memory)
    expect(['DUPLICATE_ADAPTER', 'SIMILAR_MEMORY_FOUND']).toContain(dupBody.error);
    if (dupBody.error === 'DUPLICATE_ADAPTER') {
      expect(dupBody.adapter_id).toBeDefined();
      expect(Array.isArray(dupBody.items)).toBe(true);
      expect(dupBody.items.length).toBeGreaterThan(0);
    } else {
      expect(dupBody.existing_memory).toBeDefined();
      expect(dupBody.must_obey).toBe(true);
      expect(typeof dupBody.next_action).toBe('string');
      expect(dupBody.next_action).toContain('export');
      if (dupBody.content_preview !== undefined) {
        expect(typeof dupBody.content_preview).toBe('string');
      }
    }

    // 4) Third store with force_update -> stored (overwrites prior adapter)
    const third = await mcpConnection.client.callTool({
      name: 'train',
      arguments: {
        content: md,
        llm_model_id: 'minimax/minimax-m2:free',
        force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });
    const thirdParsed = expectValidJsonResult(third);
    expect(thirdParsed.status).toBe('stored');
    expect(Array.isArray(thirdParsed.items)).toBe(true);
    expect(thirdParsed.items.length).toBeGreaterThanOrEqual(1);
  }, 30000);

  test('train SIMILAR_MEMORY_FOUND response shape (must_obey, next_action, content_preview)', async () => {
    const ts = Date.now().toString();
    const md = `# SIMILAR_MEMORY_FOUND Shape ${ts}

## Activation Patterns
Run when user says "similar shape".

## Step 1
Content

\`\`\`json
{"contract":{"type":"shell","shell":{"cmd":"echo ok","timeout_seconds":5},"required":true}}
\`\`\`

## Reward Signal
Only after all steps.`;

    const first = await mcpConnection.client.callTool({
      name: 'train',
      arguments: {
        content: md,
        llm_model_id: 'minimax/minimax-m2:free',
        force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });
    const firstParsed = expectValidJsonResult(first);
    expect(firstParsed.status).toBe('stored');

    const second = await mcpConnection.client.callTool({
      name: 'train',
      arguments: {
        content: md,
        llm_model_id: 'minimax/minimax-m2:free',
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });
    expect(second).toBeDefined();
    expect(second.isError).toBe(true);
    expect(second.content).toBeDefined();
    const body = JSON.parse(second.content[0].text);
    expect(['DUPLICATE_ADAPTER', 'SIMILAR_MEMORY_FOUND']).toContain(body.error);

    if (body.error === 'SIMILAR_MEMORY_FOUND') {
      expect(body.must_obey).toBe(true);
      expect(typeof body.next_action).toBe('string');
      expect(body.next_action.length).toBeGreaterThan(0);
      expect(body.next_action).toContain('export');
      expect(body.next_action).toContain('force_update');
      expect(body.existing_memory).toBeDefined();
      if (body.content_preview !== undefined) {
        expect(typeof body.content_preview).toBe('string');
      }
    }
  }, 30000);

  test('train stores code block content', async () => {
    // Document with code blocks containing searchable identifiers
    const ts = Date.now();
    const codeContent = `# Code Example Documentation ${ts}

## Activation Patterns
Run when user says "code example docs".

## Function Implementation
Here's how to implement a data processor:

\`\`\`typescript
function processData(input: string): string {
  return input.toUpperCase();
}

class DataProcessor {
  constructor(private data: string[]) {}

  processAll(): string[] {
    return this.data.map(item => processData(item));
  }
}
\`\`\`

\`\`\`json
{"contract":{"type":"shell","shell":{"cmd":"echo implement-processor","timeout_seconds":45},"required":true}}
\`\`\`

## Usage Example

\`\`\`javascript
const processor = new DataProcessor(['hello', 'world']);
const result = processor.processAll();
console.log(result); // ['HELLO', 'WORLD']
\`\`\`

This demonstrates the data processing functionality.

\`\`\`json
{"contract":{"type":"shell","shell":{"cmd":"echo run-processor","timeout_seconds":45},"required":true}}
\`\`\`

## Reward Signal
Only after all steps.`;

    // Store the document (force_update bypasses similarity check in shared dev collection)
    const storeResult = await mcpConnection.client.callTool({
      name: 'train',
      arguments: {
        content: codeContent,
        llm_model_id: 'minimax/minimax-m2:free',
        force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });

    const storeResponse = expectValidJsonResult(storeResult);
    if (storeResponse.error) {
      throw new Error(`train failed: ${storeResponse.error} - ${storeResponse.message ?? ''}`);
    }
    expect(storeResponse.status).toBe('stored');
    // PoW-based train: each ```json challenge block defines a layer; this doc has 2 blocks so expect >= 1 stored layer
    expect(storeResponse.items.length).toBeGreaterThanOrEqual(1);

    // Test that activate can find the adapter (use semantic query from content)
    await new Promise((r) => setTimeout(r, 2000)); // Allow Qdrant indexing
    const searchResult = await mcpConnection.client.callTool({
      name: 'activate',
      arguments: {
        query: 'Code Example Documentation DataProcessor'
      }
    });

    const searchResponse = expectValidJsonResult(searchResult);

    // V2 unified response shape (always present)
    expect(searchResponse.must_obey).toBe(true);
    expect(typeof searchResponse.message).toBe('string');
    expect(typeof searchResponse.next_action).toBe('string');
    expect(
      searchResponse.next_action.includes("choice's next_action") ||
        searchResponse.next_action.includes('squadrules://') ||
        searchResponse.next_action.toLowerCase().includes('forward')
    ).toBe(true);
    expect(Array.isArray(searchResponse.choices)).toBe(true);
    expect(searchResponse.choices.length).toBeGreaterThanOrEqual(1);

    // At least one match choice should exist (or create/refine fallback if indexing delayed)
    const matchChoices = searchResponse.choices.filter((c: any) => c.role === 'match');
    if (matchChoices.length === 0) {
      expect(searchResponse.choices.some((c: any) => c.role === 'create')).toBe(true);
    } else {
      expect(matchChoices.length).toBeGreaterThanOrEqual(1);
    }

    // Each choice has the activate shape (uri, label, adapter_name, role, tags; next_action in new format)
    const isNewFormat = searchResponse.next_action.includes("choice's next_action");
    for (const choice of searchResponse.choices) {
      expect(choice).toHaveProperty('uri');
      expect(choice).toHaveProperty('label');
      expect(choice).toHaveProperty('adapter_name');
      expect(choice).toHaveProperty('role');
      expect(choice).toHaveProperty('tags');
      if (isNewFormat) expect(choice).toHaveProperty('next_action');
      expect(['match', 'refine', 'create']).toContain(choice.role);
    }

    // V1 fields must NOT exist
    expect(searchResponse.protocol_status).toBeUndefined();
    expect(searchResponse.start_here).toBeUndefined();
    expect(searchResponse.best_match).toBeUndefined();
  }, 20000);
});