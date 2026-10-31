/**
 * ADR 0026 + SquadRules/mcp#216: a shell contract must reach the caller fully
 * specified — the interpreter and the exact argv — so the executing agent never
 * guesses a wrapper. A contract that cannot be specified must say so instead of
 * rendering a guessable command.
 */
import { describe, expect, test } from '@jest/globals';
import { buildChallengeShapeForDisplay } from '../../src/tools/next-pow-challenge-shape.js';
import type { ProofOfWorkDefinition } from '../../src/types/memory.js';

const GATE_CMD = 'python3 "$SQUADRULES_LOCAL_ARTIFACT_DIR/artifacts/gate.py" --gate preflight';

describe('shell contract rendering on the forward surface', () => {
  test('emits the interpreter and the exact invocation line to run', () => {
    const shape = buildChallengeShapeForDisplay({
      required: true,
      type: 'shell',
      shell: { cmd: GATE_CMD, interpreter: 'bash', timeout_seconds: 60 }
    });

    const shell = shape['shell'] as Record<string, unknown>;
    expect(shell['interpreter']).toBe('bash');
    expect(shell['timeout_seconds']).toBe(60);

    const invocation = String(shell['invocation_display']);
    expect(invocation).toContain('bash');
    expect(invocation).toContain('-c');
    expect(invocation).toContain('gate.py');
    expect(String(shape['description'])).toContain(invocation);
  });

  test('keeps flags, args and workdir on the wire so the argv is not guessed', () => {
    const shape = buildChallengeShapeForDisplay({
      required: true,
      type: 'shell',
      shell: {
        cmd: 'node gate.js',
        interpreter: 'node',
        timeout_seconds: 30,
        flags: ['--strict'],
        args: ['--gate', 'preflight'],
        workdir: '/tmp/work'
      }
    });

    const shell = shape['shell'] as Record<string, unknown>;
    expect(shell['flags']).toEqual(['--strict']);
    expect(shell['args']).toEqual(['--gate', 'preflight']);
    expect(shell['workdir']).toBe('/tmp/work');
    expect(String(shell['invocation_display'])).toContain('--strict');
  });

  test('a contract with no interpreter is invalid and must not invite a guessed wrapper', () => {
    const shape = buildChallengeShapeForDisplay({
      required: true,
      type: 'shell',
      shell: { cmd: GATE_CMD, timeout_seconds: 30 }
    } as unknown as ProofOfWorkDefinition);

    const shell = shape['shell'] as Record<string, unknown>;
    expect(shell['interpreter']).toBeUndefined();
    expect(shell['invocation_display']).toBeUndefined();
    expect(String(shape['description'])).toMatch(/no usable interpreter/i);
    expect(String(shape['description'])).toMatch(/must not be run by guessing/i);
  });

  test('an interpreter outside the allowed set never reaches the wire', () => {
    const shape = buildChallengeShapeForDisplay({
      required: true,
      type: 'shell',
      shell: { cmd: GATE_CMD, interpreter: 'perl', timeout_seconds: 30 }
    } as unknown as ProofOfWorkDefinition);

    // The output schema is an enum: an unknown interpreter would be rejected
    // wholesale and the caller would lose the whole response.
    const shell = shape['shell'] as Record<string, unknown>;
    expect(shell['interpreter']).toBeUndefined();
    expect(shell['invocation_display']).toBeUndefined();
  });
});
