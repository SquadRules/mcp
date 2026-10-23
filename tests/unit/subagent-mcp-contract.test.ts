/**
 * Structural validation of the optional `subagent.mcp` delegation list (ADR 0029).
 *
 * `subagent.mcp` names the SquadRules tools the delegated subagent must call.
 * It is optional; when present it must be an array of objects each carrying a
 * non-empty string `tool_name`, and an optional plain-object `arguments`.
 * Anything else fails closed with `subagent_mcp_invalid`.
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

function validate(contract: unknown) {
  return validateProtocolStructure(docWithContract(JSON.stringify({ contract })));
}

const CONTEXT = 'Export every adapter and report any layer over the 350-line ceiling.';

describe('validateProtocolStructure: subagent.mcp delegation list (ADR 0029)', () => {
  test('an absent mcp list is valid', () => {
    const result = validate({
      type: 'subagent',
      subagent: { context: CONTEXT },
      required: true
    });
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.missing).not.toContain('subagent_mcp_invalid');
  });

  test('a subagent contract with no subagent block at all is structurally valid', () => {
    // Presence/shape of `context` is enforced by the wire schema, not by the
    // markdown structural validator; the validator only polices `mcp`.
    const result = validate({ type: 'subagent', required: false });
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  test('a well-formed mcp list passes', () => {
    const result = validate({
      type: 'subagent',
      subagent: {
        context: CONTEXT,
        mcp: [
          { tool_name: 'export', arguments: { all_adapters: true } },
          { tool_name: 'spaces' }
        ]
      },
      required: true
    });
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  test('an empty mcp list passes', () => {
    const result = validate({ type: 'subagent', subagent: { context: CONTEXT, mcp: [] }, required: true });
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  test('an entry missing tool_name fails with subagent_mcp_invalid', () => {
    const result = validate({
      type: 'subagent',
      subagent: { context: CONTEXT, mcp: [{ arguments: { all_adapters: true } }] },
      required: true
    });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('subagent_mcp_invalid');
    expect(result.message).toMatch(/tool_name/);
  });

  test('an entry with an empty tool_name fails with subagent_mcp_invalid', () => {
    const result = validate({
      type: 'subagent',
      subagent: { context: CONTEXT, mcp: [{ tool_name: '   ' }] },
      required: true
    });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('subagent_mcp_invalid');
  });

  test('an entry with a non-string tool_name fails with subagent_mcp_invalid', () => {
    const result = validate({
      type: 'subagent',
      subagent: { context: CONTEXT, mcp: [{ tool_name: 42 }] },
      required: true
    });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('subagent_mcp_invalid');
  });

  test('an entry with non-object arguments fails with subagent_mcp_invalid', () => {
    const result = validate({
      type: 'subagent',
      subagent: { context: CONTEXT, mcp: [{ tool_name: 'export', arguments: 'all_adapters' }] },
      required: true
    });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('subagent_mcp_invalid');
    expect(result.message).toMatch(/plain object/);
  });

  test('an entry with array arguments fails with subagent_mcp_invalid', () => {
    const result = validate({
      type: 'subagent',
      subagent: { context: CONTEXT, mcp: [{ tool_name: 'export', arguments: [{ all_adapters: true }] }] },
      required: true
    });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('subagent_mcp_invalid');
  });

  test('an entry with null arguments fails with subagent_mcp_invalid', () => {
    const result = validate({
      type: 'subagent',
      subagent: { context: CONTEXT, mcp: [{ tool_name: 'export', arguments: null }] },
      required: true
    });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('subagent_mcp_invalid');
  });

  test('a non-object entry fails with subagent_mcp_invalid', () => {
    const result = validate({
      type: 'subagent',
      subagent: { context: CONTEXT, mcp: ['export'] },
      required: true
    });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('subagent_mcp_invalid');
  });

  test('a non-array mcp value fails with subagent_mcp_invalid', () => {
    const result = validate({
      type: 'subagent',
      subagent: { context: CONTEXT, mcp: { tool_name: 'export' } },
      required: true
    });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('subagent_mcp_invalid');
  });

  test('subagent_mcp_invalid is reported once even with several bad entries', () => {
    const result = validate({
      type: 'subagent',
      subagent: {
        context: CONTEXT,
        mcp: [{ arguments: {} }, { tool_name: 'export', arguments: 'nope' }]
      },
      required: true
    });
    expect(result.missing.filter(code => code === 'subagent_mcp_invalid')).toHaveLength(1);
  });
});
