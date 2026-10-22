/**
 * Unit tests for the contract-type enforcement added to
 * `validate-protocol-structure.ts`:
 *   - H1 (ADR 0026): a `shell` contract must name an allowed interpreter.
 *   - H2: `subagent` is an allowed contract type, written with `subagent.context`.
 *   - H3 (ADR 0025, re-expressed by ADR 0028): a `forward` contract must be a
 *     forward link to another adapter.
 *
 * Also guards that every bundled `src/embed-docs/mem` adapter contract block stays
 * a valid, elite example: boot injection bypasses train-time validation, so the
 * bundled adapters are verified here instead.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateProtocolStructure } from '../../src/services/memory/validate-protocol-structure.js';
import { findAllLayerContractBlocks } from '../../src/services/memory/adapter-contract-blocks.js';

/** Wrap a single contract JSON payload in a minimal, otherwise-valid adapter doc. */
function docWithContract(contractJson: string): string {
  return `# Test Adapter

## Activation Patterns

Run when needed.

## Step 1

Do it.

\`\`\`json
${contractJson}
\`\`\`

## Reward Signal

Done.`;
}

describe('validateProtocolStructure contract enforcement', () => {
  describe('H1: shell interpreter required (ADR 0026)', () => {
    test('shell contract without interpreter fails with shell_interpreter_required', () => {
      const result = validateProtocolStructure(
        docWithContract('{"contract":{"type":"shell","shell":{"cmd":"echo hi"},"required":true}}')
      );
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('shell_interpreter_required');
      expect(result.message).toMatch(/shell\.interpreter/);
    });

    test('shell contract with a valid interpreter passes', () => {
      const result = validateProtocolStructure(
        docWithContract(
          '{"contract":{"type":"shell","shell":{"cmd":"echo hi","interpreter":"bash"},"required":true}}'
        )
      );
      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    test('shell contract with an invalid interpreter fails with shell_interpreter_required', () => {
      const result = validateProtocolStructure(
        docWithContract(
          '{"contract":{"type":"shell","shell":{"cmd":"echo hi","interpreter":"perl"},"required":true}}'
        )
      );
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('shell_interpreter_required');
    });
  });

  describe('H2: subagent contract type allowed', () => {
    test('subagent contract passes validation (was previously rejected)', () => {
      const result = validateProtocolStructure(
        docWithContract(
          '{"contract":{"type":"subagent","subagent":{"context":"Do the reasoning step."},"required":true}}'
        )
      );
      expect(result.valid).toBe(true);
      expect(result.missing).not.toContain('invalid_contract_type');
      expect(result.missing).toHaveLength(0);
    });
  });

  describe('H3: forward contract must be a forward link (ADR 0025/0028)', () => {
    test('forward link to another adapter passes', () => {
      const result = validateProtocolStructure(
        docWithContract(
          '{"contract":{"type":"forward","forward":{"target":"squadrules://adapter/some-slug"},"required":true}}'
        )
      );
      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    test('bare tool call (non-forward) fails with forward_link_only', () => {
      const result = validateProtocolStructure(
        docWithContract(
          '{"contract":{"type":"forward","forward":{"target":"activate"},"required":true}}'
        )
      );
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('forward_link_only');
      expect(result.message).toMatch(/forward\.target/);
    });

    test('forward without a target fails with forward_link_only', () => {
      const result = validateProtocolStructure(
        docWithContract('{"contract":{"type":"forward","forward":{},"required":true}}')
      );
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('forward_link_only');
    });

    test('forward with a non-adapter URI scheme fails with forward_link_only', () => {
      const result = validateProtocolStructure(
        docWithContract(
          '{"contract":{"type":"forward","forward":{"target":"https://example.com/adapter/some-slug"},"required":true}}'
        )
      );
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('forward_link_only');
    });

    test('forward with an empty slug fails with forward_link_only', () => {
      const result = validateProtocolStructure(
        docWithContract(
          '{"contract":{"type":"forward","forward":{"target":"squadrules://adapter/"},"required":true}}'
        )
      );
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('forward_link_only');
    });
  });

  test('every bundled mem adapter contract block passes structural validation', () => {
    // Boot injection bypasses train-time validation, so bundled adapters must be
    // verified here to stay elite examples (ADR 0024/0025/0026).
    const memDir = join(process.cwd(), 'src/embed-docs/mem');
    const files = readdirSync(memDir).filter(f => f.endsWith('.md') && f !== 'README.md');
    expect(files.length).toBeGreaterThan(0);

    let checked = 0;
    for (const file of files) {
      const md = readFileSync(join(memDir, file), 'utf8');
      for (const block of findAllLayerContractBlocks(md)) {
        checked += 1;
        const result = validateProtocolStructure(
          docWithContract(JSON.stringify({ contract: block.contract }))
        );
        expect({ file, valid: result.valid, missing: result.missing }).toEqual({
          file,
          valid: true,
          missing: []
        });
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
