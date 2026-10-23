/**
 * Unit tests for adapter-contract-blocks.ts: contract block parsing.
 * Tests that only line-start ```json blocks are parsed as steps.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findAllLayerContractBlocks } from '../../src/services/memory/adapter-contract-blocks.js';
import { SHELL_INTERPRETERS } from '../../src/tools/shell-challenge-invocation.js';

const ALLOWED = new Set(['shell', 'forward', 'user_input', 'comment', 'subagent']);
const ALLOWED_INTERPRETERS = new Set<string>(SHELL_INTERPRETERS);

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
{"contract":{"type":"shell","shell":{"cmd":"echo test","interpreter":"bash"},"required":true}}
\`\`\`
More text`;

      const results = findAllLayerContractBlocks(content);
      expect(results).toHaveLength(1);
      expect(results[0]!.contract.type).toBe('shell');
      expect(results[0]!.contract.shell?.interpreter).toBe('bash');
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
{"contract":{"type":"shell","shell":{"cmd":"npm test","interpreter":"bash"},"required":true}}
\`\`\`
Step 3 content`;

      const results = findAllLayerContractBlocks(content);
      expect(results).toHaveLength(2);
      expect(results[0]!.contract.type).toBe('comment');
      expect(results[1]!.contract.type).toBe('shell');
      expect(results[1]!.contract.shell?.interpreter).toBe('bash');
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
{"contract":{"type":"shell","shell":{"cmd":"echo done","interpreter":"bash"},"required":true}}
\`\`\``;

      const results = findAllLayerContractBlocks(content);
      expect(results).toHaveLength(1);
      expect(results[0]!.contract.type).toBe('shell');
      expect(results[0]!.contract.shell?.interpreter).toBe('bash');
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
        join(process.cwd(), 'src/embed-docs/mem/author-adapter.md'),
        'utf8'
      );
      const results = findAllLayerContractBlocks(md);
      expect(results).toHaveLength(6);
      for (const result of results) {
        expect(ALLOWED.has(String(result.contract.type))).toBe(true);
      }
    });

    test('every shell contract parsed from bundled adapters carries a valid interpreter (ADR 0026)', () => {
      const memDir = join(process.cwd(), 'src/embed-docs/mem');
      const files = readdirSync(memDir).filter(f => f.endsWith('.md'));
      let shellContracts = 0;
      for (const file of files) {
        const md = readFileSync(join(memDir, file), 'utf8');
        for (const result of findAllLayerContractBlocks(md)) {
          if (result.contract.type !== 'shell') continue;
          shellContracts += 1;
          const interpreter = result.contract.shell?.interpreter;
          expect({ file, interpreter }).toEqual({ file, interpreter: expect.any(String) });
          expect(ALLOWED_INTERPRETERS.has(String(interpreter))).toBe(true);
        }
      }
      expect(shellContracts).toBeGreaterThan(0);
    });
  });
});
