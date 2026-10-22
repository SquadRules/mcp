/**
 * Unit tests for the `forward` branch of buildChallengeShapeForDisplay
 * (renamed from next-pow-mcp-display.test.ts).
 *
 * The description is the text the executing agent actually obeys, so ADR 0028
 * requires it to say "Forward to adapter <target>" and never "Call MCP tool".
 */
import { describe, expect, test } from '@jest/globals';
import { buildChallengeShapeForDisplay } from '../../src/tools/next-pow-challenge-shape.js';
import type { ProofOfWorkDefinition } from '../../src/types/memory.js';

const TARGET = 'squadrules://adapter/critic-loop';

describe('next-pow-challenge-shape buildChallengeShapeForDisplay forward', () => {
  test('emits the flat forward.target payload and names the target in the description', () => {
    const shape = buildChallengeShapeForDisplay({
      required: true,
      type: 'forward',
      forward: { target: TARGET }
    });
    expect(shape['type']).toBe('forward');
    expect(shape['forward']).toEqual({ target: TARGET });
    expect(String(shape['description'])).toContain(TARGET);
    expect(String(shape['description'])).toMatch(/Forward to adapter/);
  });

  test('never tells the agent to call an MCP tool inline (ADR 0028)', () => {
    const shape = buildChallengeShapeForDisplay({
      required: true,
      type: 'forward',
      forward: { target: TARGET }
    });
    expect(String(shape['description'])).not.toMatch(/Call MCP tool/i);
  });

  test('surfaces expected_result when the contract sets it', () => {
    const shape = buildChallengeShapeForDisplay({
      required: true,
      type: 'forward',
      forward: { target: TARGET, expected_result: { ok: true } }
    });
    expect(shape['forward']).toEqual({ target: TARGET, expected_result: { ok: true } });
  });

  test('a forward contract with no target still renders a readable challenge', () => {
    const shape = buildChallengeShapeForDisplay({
      required: true,
      type: 'forward'
    } as ProofOfWorkDefinition);
    expect((shape['forward'] as Record<string, unknown>)['target']).toBe('No target specified');
  });

  test('a stale stored type "mcp" fails closed with a re-train message', () => {
    const shape = buildChallengeShapeForDisplay({
      required: true,
      type: 'mcp',
      mcp: { tool_name: 'forward', arguments: { uri: TARGET } }
    } as unknown as ProofOfWorkDefinition);
    expect(String(shape['description'])).toMatch(/Unsupported contract type "mcp"/);
    expect(String(shape['description'])).toMatch(/re-trained/);
    expect(shape['forward']).toBeUndefined();
  });
});
