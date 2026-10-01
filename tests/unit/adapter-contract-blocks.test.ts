/**
 * Unit tests for adapter-contract-blocks.ts: contract block parsing.
 * Tests that only line-start ```json blocks are parsed as steps.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findAllLayerContractBlocks } from '../../src/services/memory/adapter-contract-blocks.js';

const ALLOWED = new Set(['shell', 'mcp', 'user_input', 'comment']);

describe('adapter-contract-blocks', () => {
  describe('findAllLayerContractBlocks', () => {
    test('finds contract block at line start (after newline)', () => {
      const content = `Some text
\`\`\`json
{"contract":{"type":"comment","comment":{"min_length":10},"required":true}}
\`\`\`
More text`;

      const results = findAllLayerContractBlocks(content);
      expect(results).toHaveLength(1);
      expect(results[0]!.contract.type).toBe('comment');
      expect(results[0]!.start).toBeGreaterThan(0);
      expect(results[0]!.end).toBeGreaterThan(results[0]!.start);
    });

    test('finds contract block at content start', () => {
      const content = `\`\`\`json
{"contract":{"type":"shell","shell":{"cmd":"echo test"},"required":true}}
\`\`\`
More text`;

      const results = findAllLayerContractBlocks(content);
      expect(results).toHaveLength(1);
      expect(results[0]!.contract.type).toBe('shell');
      expect(results[0]!.start).toBe(0);
    });

    test('does NOT find contract block with inline prefix', () => {
      const content = `Some text
Example: \`\`\`json
{"contract":{"type":"comment","comment":{"min_length":10},"required":true}}
\`\`\`
More text`;

      const results = findAllLayerContractBlocks(content);
      expect(results).toHaveLength(0);
    });

    test('finds multiple line-start contract blocks', () => {
      const content = `Step 1 content
\`\`\`json
{"contract":{"type":"comment","comment":{"min_length":10},"required":true}}
\`\`\`
Step 2 content
\`\`\`json
{"contract":{"type":"shell","shell":{"cmd":"npm test"},"required":true}}
\`\`\`
Step 3 content`;

      const results = findAllLayerContractBlocks(content);
      expect(results).toHaveLength(2);
      expect(results[0]!.contract.type).toBe('comment');
      expect(results[1]!.contract.type).toBe('shell');
      expect(results[1]!.start).toBeGreaterThan(results[0]!.end);
    });

    test('ignores inline-prefixed blocks but finds line-start blocks', () => {
      const content = `Reference section:
Example: \`\`\`json
{"contract":{"type":"comment","comment":{"min_length":10},"required":true}}
\`\`\`

## Step 1
Do something
\`\`\`json
{"contract":{"type":"shell","shell":{"cmd":"echo done"},"required":true}}
\`\`\``;

      const results = findAllLayerContractBlocks(content);
      expect(results).toHaveLength(1);
      expect(results[0]!.contract.type).toBe('shell');
    });

    test('ignores blocks with ``` (no json): only ```json counts as contract block', () => {
      const content = `Some text
\`\`\`
{"contract":{"type":"comment","comment":{"min_length":10},"required":true}}
\`\`\`
More text`;

      const results = findAllLayerContractBlocks(content);
      expect(results).toHaveLength(0);
    });

    test('ignores blocks without contract key', () => {
      const content = `Some text
\`\`\`json
{"not_a_contract":true}
\`\`\`
More text`;

      const results = findAllLayerContractBlocks(content);
      expect(results).toHaveLength(0);
    });

    test('ignores invalid JSON blocks', () => {
      const content = `Some text
\`\`\`json
{invalid json}
\`\`\`
More text`;

      const results = findAllLayerContractBlocks(content);
      expect(results).toHaveLength(0);
    });

    test('preserves correct start/end indices for segment slicing', () => {
      const content = `Prefix text
\`\`\`json
{"contract":{"type":"comment","comment":{"min_length":10},"required":true}}
\`\`\`
Suffix text`;

      const results = findAllLayerContractBlocks(content);
      expect(results).toHaveLength(1);

      const beforeBlock = content.slice(0, results[0]!.start);
      const afterBlock = content.slice(results[0]!.end);

      expect(beforeBlock.trim()).toBe('Prefix text');
      expect(afterBlock.trim()).toBe('Suffix text');
    });

    test('embedded create-new-adapter flow has only valid contract types and expected step count', () => {
      const md = readFileSync(
        join(process.cwd(), 'src/embed-docs/mem/create-new-protocol.md'),
        'utf8'
      );
      const results = findAllLayerContractBlocks(md);
      expect(results).toHaveLength(8);
      for (const result of results) {
        expect(ALLOWED.has(String(result.contract.type))).toBe(true);
      }
    });
  });
});
