/**
 * Regression guard for the subagent contract field rename (ADR 0029).
 *
 * The live wire schema reads `subagent.context`; the docs and fixtures used to
 * say `subagent.instruction`, which silently produced a delegation challenge
 * with no task-specific context. These tests pin `context` as the authoritative
 * field and keep `instruction` covered as a no-op so the bug cannot return.
 */

import { describe, expect, test } from '@jest/globals';
import { buildChallengeShapeForDisplay } from '../../src/tools/next-pow-challenge-shape.js';
import type { ProofOfWorkDefinition } from '../../src/types/memory.js';

const DELEGATION_LINE =
  'Delegate this task to a subagent and return its actual report. Do not perform the task yourself.';

const CONTEXT = 'Export every adapter and report any layer over the 350-line ceiling.';

describe('subagent.context is the authoritative delegation field', () => {
  test('the context is carried into the challenge description', () => {
    const shape = buildChallengeShapeForDisplay({
      type: 'subagent',
      required: true,
      subagent: { context: CONTEXT }
    } as ProofOfWorkDefinition);

    expect(shape['type']).toBe('subagent');
    expect(String(shape['description'])).toBe(`${DELEGATION_LINE} Context: ${CONTEXT}`);
    expect(shape['subagent']).toEqual({ context: CONTEXT });
  });

  test('the context is echoed in the payload and the mcp list stays absent when unset', () => {
    const shape = buildChallengeShapeForDisplay({
      type: 'subagent',
      required: true,
      subagent: { context: CONTEXT }
    } as ProofOfWorkDefinition);

    const payload = shape['subagent'] as Record<string, unknown>;
    expect(payload['context']).toBe(CONTEXT);
    expect(payload).not.toHaveProperty('mcp');
  });

  test('an mcp tool list appends the delegation hint to the description', () => {
    const shape = buildChallengeShapeForDisplay({
      type: 'subagent',
      required: true,
      subagent: {
        context: CONTEXT,
        mcp: [
          { tool_name: 'export', arguments: { all_adapters: true } },
          { tool_name: 'spaces' }
        ]
      }
    } as ProofOfWorkDefinition);

    expect(String(shape['description'])).toBe(
      `${DELEGATION_LINE} Context: ${CONTEXT} The subagent must call these MCP tools: export, spaces.`
    );
    expect((shape['subagent'] as Record<string, unknown>)['mcp']).toEqual([
      { tool_name: 'export', arguments: { all_adapters: true } },
      { tool_name: 'spaces' }
    ]);
  });

  test('an absent context yields the bare delegation line', () => {
    const shape = buildChallengeShapeForDisplay({
      type: 'subagent',
      required: true
    } as ProofOfWorkDefinition);

    expect(String(shape['description'])).toBe(DELEGATION_LINE);
    expect(shape['subagent']).toEqual({ context: '' });
  });
});

describe('the retired subagent.instruction field is ignored', () => {
  test('instruction does not reach the description', () => {
    const shape = buildChallengeShapeForDisplay({
      type: 'subagent',
      required: true,
      subagent: { instruction: CONTEXT }
    } as unknown as ProofOfWorkDefinition);

    // Regression guard: an author who still writes `instruction` gets the bare
    // delegation line — the field is not silently substituted for `context`.
    expect(String(shape['description'])).toBe(DELEGATION_LINE);
    expect(String(shape['description'])).not.toContain('350-line ceiling');
    expect(shape['subagent']).toEqual({ context: '' });
  });

  test('instruction alongside context contributes nothing', () => {
    const shape = buildChallengeShapeForDisplay({
      type: 'subagent',
      required: true,
      subagent: { context: CONTEXT, instruction: 'Run the export sweep twice.' }
    } as unknown as ProofOfWorkDefinition);

    expect(String(shape['description'])).toBe(`${DELEGATION_LINE} Context: ${CONTEXT}`);
    expect(String(shape['description'])).not.toContain('twice');
  });
});

describe('a malformed stored subagent.mcp list degrades gracefully', () => {
  // tune persists inference_contract data without the train-time validator,
  // so the renderer must treat the stored list as untrusted (ADR 0029).
  test('a non-array mcp value renders the plain delegation challenge without throwing', () => {
    const shape = buildChallengeShapeForDisplay({
      type: 'subagent',
      required: true,
      subagent: { context: CONTEXT, mcp: 'not-an-array' }
    } as unknown as ProofOfWorkDefinition);

    expect(String(shape['description'])).toBe(`${DELEGATION_LINE} Context: ${CONTEXT}`);
    expect(shape['subagent']).toEqual({ context: CONTEXT });
  });

  test('entries without a usable tool_name are skipped, valid ones survive', () => {
    const shape = buildChallengeShapeForDisplay({
      type: 'subagent',
      required: true,
      subagent: {
        context: CONTEXT,
        mcp: ['export', { tool_name: '   ' }, 42, { tool_name: 'spaces' }]
      }
    } as unknown as ProofOfWorkDefinition);

    expect(String(shape['description'])).toBe(
      `${DELEGATION_LINE} Context: ${CONTEXT} The subagent must call these MCP tools: spaces.`
    );
    expect((shape['subagent'] as Record<string, unknown>)['mcp']).toEqual([{ tool_name: 'spaces' }]);
  });

  test('an entry with a non-object arguments value is skipped', () => {
    const shape = buildChallengeShapeForDisplay({
      type: 'subagent',
      required: true,
      subagent: {
        context: CONTEXT,
        mcp: [{ tool_name: 'export', arguments: 'all_adapters' }]
      }
    } as unknown as ProofOfWorkDefinition);

    expect(String(shape['description'])).toBe(`${DELEGATION_LINE} Context: ${CONTEXT}`);
    expect(shape['subagent']).toEqual({ context: CONTEXT });
  });

  test('an empty mcp list renders no tool hint and no mcp field', () => {
    const shape = buildChallengeShapeForDisplay({
      type: 'subagent',
      required: true,
      subagent: { context: CONTEXT, mcp: [] }
    } as ProofOfWorkDefinition);

    expect(String(shape['description'])).toBe(`${DELEGATION_LINE} Context: ${CONTEXT}`);
    expect(shape['subagent']).toEqual({ context: CONTEXT });
  });
});
