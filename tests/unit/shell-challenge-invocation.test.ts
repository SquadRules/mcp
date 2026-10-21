/**
 * Unit tests for shell challenge argv construction (interpreter, flags, args).
 */

import { describe, expect, test } from '@jest/globals';
import {
  buildShellChallengeArgv,
  formatShellInvocationForDisplay,
  formatShellChallengeInvocationSummary,
  pickShellChallengeFields,
  SHELL_INTERPRETERS,
  type ShellChallengeFields
} from '../../src/tools/shell-challenge-invocation.js';

describe('buildShellChallengeArgv', () => {
  test('bash interpreter uses -c without args', () => {
    expect(buildShellChallengeArgv({ interpreter: 'bash', cmd: 'echo hi' })).toEqual([
      'bash',
      '-c',
      'echo hi'
    ]);
  });

  test('bash interpreter with args uses --', () => {
    expect(
      buildShellChallengeArgv({ interpreter: 'bash', cmd: 'echo "$1"', args: ['a', 'b'] })
    ).toEqual(['bash', '-c', 'echo "$1"', '--', 'a', 'b']);
  });

  test('every allowed interpreter builds argv (ADR 0026: no silent bash default)', () => {
    expect(SHELL_INTERPRETERS).toEqual(['bash', 'sh', 'python3', 'python', 'node']);
    expect(buildShellChallengeArgv({ interpreter: 'bash', cmd: 'x' })).toEqual(['bash', '-c', 'x']);
    expect(buildShellChallengeArgv({ interpreter: 'sh', cmd: 'x' })).toEqual(['sh', '-c', 'x']);
    expect(buildShellChallengeArgv({ interpreter: 'python3', cmd: 'x' })).toEqual(['python3', '-c', 'x']);
    expect(buildShellChallengeArgv({ interpreter: 'python', cmd: 'x' })).toEqual(['python', '-c', 'x']);
    expect(buildShellChallengeArgv({ interpreter: 'node', cmd: 'x' })).toEqual(['node', '-e', 'x']);
  });

  test('throws when interpreter is missing (no silent bash fallback)', () => {
    expect(() =>
      buildShellChallengeArgv({ cmd: 'echo hi' } as unknown as ShellChallengeFields)
    ).toThrow(/missing its required interpreter/);
  });

  test('throws when interpreter is blank', () => {
    expect(() =>
      buildShellChallengeArgv({ interpreter: '   ' } as unknown as ShellChallengeFields)
    ).toThrow(/missing its required interpreter/);
  });

  test('python3 injects -c', () => {
    expect(buildShellChallengeArgv({ interpreter: 'python3', cmd: 'print(1)' })).toEqual([
      'python3',
      '-c',
      'print(1)'
    ]);
  });

  test('perl -ne does not add extra -e', () => {
    expect(
      buildShellChallengeArgv({
        interpreter: 'perl',
        flags: ['-00', '-ne'],
        cmd: 'print',
        args: ['f.md']
      })
    ).toEqual(['perl', '-00', '-ne', 'print', 'f.md']);
  });

  test('node injects -e', () => {
    expect(buildShellChallengeArgv({ interpreter: 'node', cmd: 'process.exit(0)' })).toEqual([
      'node',
      '-e',
      'process.exit(0)'
    ]);
  });

  test('terraform uses other style (no auto code flag)', () => {
    expect(
      buildShellChallengeArgv({
        interpreter: 'terraform',
        flags: ['validate'],
        cmd: '',
        args: []
      })
    ).toEqual(['terraform', 'validate']);
  });

  test('formatShellChallengeInvocationSummary joins argv', () => {
    const s = formatShellChallengeInvocationSummary({ interpreter: 'bash', cmd: 'echo', args: ['a b'] });
    expect(s).toContain('bash');
    expect(s).toContain('echo');
    expect(s).toContain("'a b'");
  });

  test('formatShellInvocationForDisplay quotes spaces', () => {
    expect(formatShellInvocationForDisplay(['bash', '-c', 'echo hi'])).toMatch(/bash -c/);
  });
});

describe('pickShellChallengeFields', () => {
  test('omits empty optional keys but keeps required interpreter (exactOptionalPropertyTypes-safe)', () => {
    const picked = pickShellChallengeFields({
      cmd: 'true',
      interpreter: 'bash',
      flags: undefined,
      args: undefined,
      workdir: undefined
    });
    expect(Object.keys(picked).sort()).toEqual(['cmd', 'interpreter']);
  });

  test('throws when interpreter is missing or blank', () => {
    expect(() => pickShellChallengeFields({ cmd: 'true', interpreter: undefined })).toThrow(
      /missing its required interpreter/
    );
    expect(() => pickShellChallengeFields({ cmd: 'true', interpreter: '   ' })).toThrow(
      /missing its required interpreter/
    );
  });

  test('trims interpreter and workdir; keeps flags/args when explicitly set', () => {
    const picked = pickShellChallengeFields({
      cmd: 'x',
      interpreter: '  perl  ',
      flags: [],
      args: ['a'],
      workdir: ' /tmp/w '
    });
    expect(picked).toEqual({
      cmd: 'x',
      interpreter: 'perl',
      flags: [],
      args: ['a'],
      workdir: '/tmp/w'
    });
  });

  test('round-trips through argv like loose object would', () => {
    const argv = buildShellChallengeArgv(
      pickShellChallengeFields({
        cmd: 'print(0)',
        interpreter: 'python3',
        flags: undefined,
        args: undefined,
        workdir: undefined
      })
    );
    expect(argv).toEqual(['python3', '-c', 'print(0)']);
  });
});
