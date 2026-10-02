import { CLI_PATH, execAsync } from './cli-commands-shared.js';
import { isHttpTransport } from '../utils/auth-headers.js';

const _d = isHttpTransport() ? describe : describe.skip;

_d('CLI usage help', () => {
  test('train without path or --source-adapter-uri prints error', async () => {
    try {
      await execAsync(`node ${CLI_PATH} train`, { timeout: 10000 });
      throw new Error('Expected train without path to fail');
    } catch (error) {
      const err = error as { code?: number; stderr?: string };
      const stderr = String(err.stderr ?? '');

      expect(err.code).toBe(1);
      expect(stderr).toContain('Missing path:');
      expect(stderr).toContain('--source-adapter-uri');
    }
  });

  test('mistyped subcommand prints suggestion and root help', async () => {
    try {
      await execAsync(`node ${CLI_PATH} trian`, { timeout: 10000 });
      throw new Error('Expected unknown subcommand to fail');
    } catch (error) {
      const err = error as { code?: number; stderr?: string };
      const stderr = String(err.stderr ?? '');

      expect(err.code).toBe(1);
      expect(stderr).toContain("error: unknown command 'trian'");
      expect(stderr).toContain('(Did you mean train?)');
      expect(stderr).toContain('Usage: squadrules [options] [command]');
      expect(stderr).toContain('Commands:');
    }
  });

  test('mistyped train option prints suggestion and train help', async () => {
    try {
      await execAsync(`node ${CLI_PATH} train --modl foo tests/test-data/cli-minimal-test.md`, {
        timeout: 10000
      });
      throw new Error('Expected unknown option to fail');
    } catch (error) {
      const err = error as { code?: number; stderr?: string };
      const stderr = String(err.stderr ?? '');

      expect(err.code).toBe(1);
      expect(stderr).toContain("error: unknown option '--modl'");
      expect(stderr).toContain('(Did you mean --model?)');
      expect(stderr).toContain('Usage: squadrules train [options] [path]');
      expect(stderr).toContain('markdown/artifact file');
    }
  });
});
