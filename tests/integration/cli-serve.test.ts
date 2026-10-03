/**
 * squadrules serve — help and flag validation (no full server boot; requires dist/cli).
 */

import { execAsync, CLI_PATH } from './cli-commands-shared.js';
import { isHttpTransport } from '../utils/auth-headers.js';

const _d = isHttpTransport() ? describe : describe.skip;

_d('CLI serve', () => {
  test('serve --help lists options and usage', async () => {
    const { stdout, stderr } = await execAsync(`node ${CLI_PATH} serve --help`, {
      timeout: 15000
    });
    expect(stderr).toBe('');
    expect(stdout).toContain('Usage: squadrules serve');
    expect(stdout).toContain('--env-file');
    expect(stdout).toContain('--server-port');
    expect(stdout).toContain('--metrics-port');
    expect(stdout).toContain('--transport');
  });

  test('serve rejects invalid --server-port', async () => {
    try {
      await execAsync(`node ${CLI_PATH} serve --server-port not-a-number`, {
        timeout: 15000
      });
      throw new Error('expected invalid port to fail');
    } catch (error) {
      const err = error as { code?: number; stderr?: string; stdout?: string };
      const combined = `${err.stderr ?? ''}${err.stdout ?? ''}`;
      expect(err.code).toBe(1);
      expect(combined).toMatch(/Invalid --server-port|not-a-number/);
    }
  });

  test('root --url does not break serve --help', async () => {
    const { stdout, stderr } = await execAsync(
      `node ${CLI_PATH} --url http://127.0.0.1:9 serve --help`,
      { timeout: 15000 }
    );
    expect(stderr).toBe('');
    expect(stdout).toContain('Usage: squadrules serve');
  });
});
