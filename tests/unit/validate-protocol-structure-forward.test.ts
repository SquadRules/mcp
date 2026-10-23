/**
 * Structural validation of the `forward` contract type (ADR 0025 / ADR 0028).
 *
 * Two invariants are guarded here:
 *   1. `type:"forward"` is only valid as a forward link — it must carry
 *      `forward.target` matching `squadrules://adapter/<slug>`, otherwise the
 *      fail-closed code is `forward_link_only` (renamed from `mcp_link_only`).
 *   2. The retired `type:"mcp"` contract is no longer an allowed contract type:
 *      training a doc that still uses it fails with `invalid_contract_type`,
 *      which is what forces the re-train migration path.
 */

import { validateProtocolStructure } from '../../src/services/memory/validate-protocol-structure.js';

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

function validate(contractJson: string) {
  return validateProtocolStructure(docWithContract(contractJson));
}

describe('validateProtocolStructure: forward contract type (ADR 0028)', () => {
  describe('type:"forward" requires a forward link target', () => {
    test('forward with a valid adapter target passes', () => {
      const result = validate(
        '{"contract":{"type":"forward","forward":{"target":"squadrules://adapter/critic-loop"},"required":true}}'
      );
      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
      expect(result.message).toBe('');
    });

    test('forward without forward.target fails with forward_link_only', () => {
      const result = validate('{"contract":{"type":"forward","required":true}}');
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('forward_link_only');
      expect(result.message).toMatch(/forward contracts must set forward\.target/);
      expect(result.message).toMatch(/squadrules:\/\/adapter\/<slug>/);
    });

    test('forward with an empty forward object fails with forward_link_only', () => {
      const result = validate('{"contract":{"type":"forward","forward":{},"required":true}}');
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('forward_link_only');
    });

    test('forward with an empty-string target fails with forward_link_only', () => {
      const result = validate(
        '{"contract":{"type":"forward","forward":{"target":""},"required":true}}'
      );
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('forward_link_only');
    });

    test('forward with a non-string target fails with forward_link_only', () => {
      const result = validate(
        '{"contract":{"type":"forward","forward":{"target":{"uri":"squadrules://adapter/critic-loop"}},"required":true}}'
      );
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('forward_link_only');
    });

    test('forward with a non-adapter scheme fails with forward_link_only', () => {
      const result = validate(
        '{"contract":{"type":"forward","forward":{"target":"https://example.com/adapter/critic-loop"},"required":true}}'
      );
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('forward_link_only');
    });

    test('forward with an empty slug fails with forward_link_only', () => {
      const result = validate(
        '{"contract":{"type":"forward","forward":{"target":"squadrules://adapter/"},"required":true}}'
      );
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('forward_link_only');
    });

    test('forward with a nested-path target fails with forward_link_only', () => {
      const result = validate(
        '{"contract":{"type":"forward","forward":{"target":"squadrules://adapter/critic-loop/step-2"},"required":true}}'
      );
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('forward_link_only');
    });

    test('the retired mcp_link_only code is no longer emitted', () => {
      const result = validate('{"contract":{"type":"forward","forward":{},"required":true}}');
      expect(result.missing).not.toContain('mcp_link_only');
    });
  });

  describe('type:"mcp" is retired', () => {
    test('a retired mcp tool-call contract fails with invalid_contract_type', () => {
      const result = validate(
        '{"contract":{"type":"mcp","mcp":{"tool_name":"forward","arguments":{"uri":"squadrules://adapter/critic-loop"}},"required":true}}'
      );
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('invalid_contract_type');
      expect(result.message).toMatch(/shell, forward, user_input, comment, or subagent/);
    });

    test('a retired mcp contract does not report forward_link_only (type check runs first)', () => {
      const result = validate('{"contract":{"type":"mcp","required":true}}');
      expect(result.missing).toContain('invalid_contract_type');
      expect(result.missing).not.toContain('forward_link_only');
    });

    test('forward_link_only is the only code for a type-valid but unlinked forward', () => {
      const result = validate('{"contract":{"type":"forward","forward":{},"required":true}}');
      expect(result.missing).toEqual(['forward_link_only']);
    });
  });
});
