/**
 * Shell interpreter enum restriction (#103).
 *
 * Verifies that only the five allowed interpreters are accepted and that
 * removed values (nodejs, ruby, perl, terraform, etc.) are rejected.
 */
import {
  SHELL_INTERPRETERS,
  buildShellChallengeArgv
} from '../../src/tools/shell-challenge-invocation.js';
import { challengeSchema } from '../../src/tools/next_schema.js';

describe('SHELL_INTERPRETERS', () => {
  it('contains exactly the five allowed interpreters', () => {
    expect([...SHELL_INTERPRETERS]).toEqual(['bash', 'sh', 'python3', 'python', 'node']);
  });
});

describe('buildShellChallengeArgv with allowed interpreters', () => {
  it('defaults to bash -c when no interpreter given', () => {
    const argv = buildShellChallengeArgv({ cmd: 'echo hello' });
    expect(argv).toEqual(['bash', '-c', 'echo hello']);
  });

  it('python3 gets -c injection', () => {
    const argv = buildShellChallengeArgv({ cmd: 'print(1)', interpreter: 'python3' });
    expect(argv).toEqual(['python3', '-c', 'print(1)']);
  });

  it('node gets -e injection', () => {
    const argv = buildShellChallengeArgv({ cmd: 'console.log(1)', interpreter: 'node' });
    expect(argv).toEqual(['node', '-e', 'console.log(1)']);
  });

  it('sh gets -c injection', () => {
    const argv = buildShellChallengeArgv({ cmd: 'echo hi', interpreter: 'sh' });
    expect(argv).toEqual(['sh', '-c', 'echo hi']);
  });
});

describe('challengeSchema interpreter validation', () => {
  const baseChallenge = {
    type: 'shell' as const,
    description: 'test',
    shell: {
      cmd: 'echo test',
      timeout_seconds: 30
    }
  };

  it('accepts all five allowed interpreters', () => {
    for (const interp of SHELL_INTERPRETERS) {
      const result = challengeSchema.parse({
        ...baseChallenge,
        shell: { ...baseChallenge.shell, interpreter: interp }
      });
      expect(result.shell?.interpreter).toBe(interp);
    }
  });

  it('accepts undefined interpreter', () => {
    const result = challengeSchema.parse(baseChallenge);
    expect(result.shell?.interpreter).toBeUndefined();
  });

  it('rejects removed interpreters', () => {
    for (const bad of ['nodejs', 'ruby', 'perl', 'terraform', 'docker', 'npm', 'go']) {
      const result = challengeSchema.safeParse({
        ...baseChallenge,
        shell: { ...baseChallenge.shell, interpreter: bad }
      });
      expect(result.success).toBe(false);
    }
  });
});
