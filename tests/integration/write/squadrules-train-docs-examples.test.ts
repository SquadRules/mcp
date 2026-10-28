/**
 * Squadrules Train integration tests for docs/examples (workflow test — imports scenario).
 *
 * Trains each example adapter from docs/examples/ via train. Used in dev/qa
 * to validate that canonical examples can be imported; complements agent-driven
 * workflow tests in tests/workflow-test/.
 */

import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import { parseMcpJson } from '../../utils/expect-with-raw.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

describe('Squadrules Train Docs Examples (docs/examples)', () => {
  let mcpConnection;

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  });

  afterAll(async () => {
    if (mcpConnection) {
      await mcpConnection.close();
    }
  });

  function expectValidJsonResult(result: unknown) {
    return parseMcpJson(result, '[train docs/examples] raw MCP result');
  }

  // Canonical, reviewed example adapters (see docs/examples/README.md).
  // Recursive: examples may sit in a sub-directory (e.g. `artifact-gate/`) when
  // their companion artifacts would otherwise be attached to unrelated examples.
  const examplesDir = join(process.cwd(), 'docs', 'examples');
  function collectExamples(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) return collectExamples(fullPath);
      const isExample = entry.name.startsWith('adapter-example-') && entry.name.toLowerCase().endsWith('.md');
      return isExample ? [fullPath] : [];
    });
  }
  const testFiles = collectExamples(examplesDir);

  beforeAll(() => {
    if (testFiles.length === 0) {
      throw new Error(`${examplesDir} has no adapter-example-*.md files`);
    }
  });

  for (const filePath of testFiles) {
    const fileName = relative(examplesDir, filePath);
    test(`import: ${fileName}`, async () => {
      expect.hasAssertions();
      const content = readFileSync(filePath, 'utf-8');

      const result = await mcpConnection.client.callTool({
        name: 'train',
        arguments: {
          content: content,
          llm_model_id: 'minimax/minimax-m2:free',
          force_update: true,
          review_evidence: MOCK_REVIEW_EVIDENCE
        }
      });

      const response = expectValidJsonResult(result);
      expect(response).toHaveProperty('items');
      expect(Array.isArray(response.items)).toBe(true);
      expect(response.items.length).toBeGreaterThanOrEqual(1);
      expect(response.status).toBe('stored');
    }, 30000);
  }
});
