/**
 * Unit tests for the `forward` branch of buildChallengeShapeForDisplay
 * (renamed from next-pow-mcp-display.test.ts).
 *
 * The description is the text the executing agent actually obeys, so ADR 0028
 * requires it to say "Forward to adapter <target>" and never "Call MCP tool".
 */
import { describe, expect, test } from '@jest/globals';
import { buildChallengeShapeForDisplay } from '../../src/tools/next-pow-challenge-shape.js';
import { SquadrulesError } from '../../src/types/index.js';
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

  test('a stale stored type "mcp" throws a fail-closed re-train error instead of an invalid shape', () => {
    let caught: unknown;
    try {
      buildChallengeShapeForDisplay({
        required: true,
        type: 'mcp',
        mcp: { tool_name: 'forward', arguments: { uri: TARGET } }
      } as unknown as ProofOfWorkDefinition);
    } catch (error) {
      caught = error;
    }

    // The SDK output schema rejects any challenge carrying type "mcp", so the
    // guard must surface an actionable isError payload (the forward tool
    // registration renders SquadrulesError as isError), never a stale shape.
    expect(caught).toBeInstanceOf(SquadrulesError);
    const err = caught as SquadrulesError;
    expect(err.code).toBe('UNSUPPORTED_CONTRACT_TYPE');
    expect(err.message).toMatch(/Unsupported contract type "mcp"/);
    expect(err.message).toMatch(/trained before the mcp→forward rename/);
    expect(err.message).toMatch(/Re-train this adapter/);
  });

  test('an unrecognized stored type throws the same fail-closed error', () => {
    expect(() =>
      buildChallengeShapeForDisplay({
        required: true,
        type: 'tensor'
      } as unknown as ProofOfWorkDefinition)
    ).toThrow(/Unsupported contract type "tensor"/);
  });
});
