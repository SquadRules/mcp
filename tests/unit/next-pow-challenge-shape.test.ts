/**
 * Unit tests for the forward-path challenge builder (`next-pow-challenge-shape.ts`,
 * consumed by `buildChallenge` / `dump`). The active forward shell contract must pass
 * the stored interpreter/flags/args/workdir through to the executing agent — before this
 * change only `cmd`/`timeout_seconds` reached the agent, so a stored `interpreter` was
 * silently dropped. These tests lock the pass-through and the removal of the `mcp` type.
 */

import { buildChallengeShapeForDisplay } from '../../src/tools/next-pow-challenge-shape.js';

describe('next-pow-challenge-shape buildChallengeShapeForDisplay (forward shell surface)', () => {
  test('passes interpreter/flags/args/workdir through to the shell contract', () => {
    const shape = buildChallengeShapeForDisplay({
      required: true,
      type: 'shell',
      shell: {
        cmd: 'print',
        timeout_seconds: 5,
        interpreter: 'python3',
        flags: ['-c'],
        args: ['x'],
        workdir: '/tmp'
      }
    } as any);
    expect(shape.type).toBe('shell');
    const shell = shape.shell as Record<string, unknown>;
    expect(shell.cmd).toBe('print');
    expect(shell.timeout_seconds).toBe(5);
    expect(shell.interpreter).toBe('python3');
    expect(shell.flags).toEqual(['-c']);
    expect(shell.args).toEqual(['x']);
    expect(shell.workdir).toBe('/tmp');
    expect(shell.invocation_display).toBeDefined();
  });

  test('defaults to bash invocation when interpreter is omitted', () => {
    const shape = buildChallengeShapeForDisplay({
      required: true,
      type: 'shell',
      shell: { cmd: 'echo hi', timeout_seconds: 7 }
    } as any);
    const shell = shape.shell as Record<string, unknown>;
    expect(shell.cmd).toBe('echo hi');
    expect(shell.timeout_seconds).toBe(7);
    expect(String(shell.invocation_display)).toContain('bash');
  });

  test('subagent contract emits context and a delegation description', () => {
    const shape = buildChallengeShapeForDisplay({
      required: true,
      type: 'subagent',
      subagent: { context: 'forward squadrules://adapter/critic-loop' }
    } as any);
    expect(shape.type).toBe('subagent');
    expect((shape.subagent as Record<string, unknown>).context).toBe(
      'forward squadrules://adapter/critic-loop'
    );
    expect(String(shape.description)).toMatch(/delegate/i);
  });
});
