/**
 * CLI auth E2E. Default path is non-interactive: tests/setup.ts refreshes the
 * dev test bearer token and this file exercises `squadrules login --token`.
 *
 * Requires: dev server + Keycloak (npm run dev:deploy). Test credentials come
 * from tests/global-setup-auth.ts and tests/utils/auth-headers.ts.
 * Run: npm run dev:deploy && npm run dev:test -- tests/integration/cli-auth-browser-login.e2e.test.ts
 */

import { exec, execFile } from 'child_process';
import { join } from 'path';
import {
  getTestAuthBaseUrl,
  getMcpTestBearerToken,
  serverRequiresAuth,
  isHttpTransport
} from '../utils/auth-headers.js';

const BASE_URL = getTestAuthBaseUrl();
const CLI_PATH = join(process.cwd(), 'dist/cli/index.js');
const _d = isHttpTransport() ? describe : describe.skip;

function runCli(args: string): Promise<{ stdout: string; stderr: string; code?: number }> {
  return new Promise((resolve) => {
    exec(
      `node ${CLI_PATH} ${args}`,
      { env: { ...process.env, BROWSER: 'true' } },
      (err, stdout, stderr) => {
        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          code: err ? (err as Error & { code?: number }).code : 0
        });
      }
    );
  });
}

function runCliFile(args: string[]): Promise<{ stdout: string; stderr: string; code?: number }> {
  return new Promise((resolve) => {
    execFile(
      'node',
      [CLI_PATH, ...args],
      { env: { ...process.env, BROWSER: 'true' }, timeout: 15000 },
      (err, stdout, stderr) => {
        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          code: err ? (err as Error & { code?: number }).code : 0
        });
      }
    );
  });
}

async function loginWithDevToken(): Promise<void> {
  const token = getMcpTestBearerToken();
  if (!token) {
    throw new Error(
      'CLI auth E2E requires dev test bearer token from .test-auth-env.<env>.json. Run npm run dev:deploy first.'
    );
  }
  const result = await runCliFile(['login', '--token', token, '--url', BASE_URL]);
  expect(result.code).toBe(0);
}

const describeWhenAuth = serverRequiresAuth() && isHttpTransport() ? describe : describe.skip;

describeWhenAuth('CLI auth (dev token login)', () => {
  beforeEach(async () => {
    await runCliFile(['logout', '--url', BASE_URL]);
  });

  test('login --token stores dev bearer token and activate works', async () => {
    await loginWithDevToken();

    const tokenResult = await runCliFile(['token', '--url', BASE_URL]);
    expect(tokenResult.code).toBe(0);
    const storedToken = tokenResult.stdout.trim();
    expect(storedToken).toMatch(/^eyJ/);

    const searchResult = await runCli(`--url ${BASE_URL} activate "test"`);
    expect(searchResult.code).toBe(0);
    const data = JSON.parse(searchResult.stdout);
    expect(data).toHaveProperty('choices');
  }, 30000);

  test('logout clears token from config', async () => {
    await loginWithDevToken();

    const tokenBefore = await runCliFile(['token', '--url', BASE_URL]);
    expect(tokenBefore.code).toBe(0);
    expect(tokenBefore.stdout.trim()).toMatch(/^eyJ/);

    const logoutResult = await runCliFile(['logout', '--url', BASE_URL]);
    expect(logoutResult.code).toBe(0);
    expect(logoutResult.stdout).toMatch(/Credentials cleared|Token cleared/i);

    const tokenAfter = await runCliFile(['token', '--url', BASE_URL]);
    expect(tokenAfter.code).not.toBe(0);
  }, 20000);

  test('activate without token after logout fails with auth message', async () => {
    const logoutResult = await runCliFile(['logout', '--url', BASE_URL]);
    expect(logoutResult.code).toBe(0);

    let timeoutId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<{ stdout: string; stderr: string; code?: number }>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('CLI timed out after 12s (expected auth error)')), 12000);
    });
    const searchResult = await Promise.race([
      runCli(`--url ${BASE_URL} activate "test"`),
      timeoutPromise
    ]).finally(() => clearTimeout(timeoutId!));
    expect(searchResult.code).not.toBe(0);
    expect(searchResult.stderr || searchResult.stdout).toMatch(
      /Authentication required|Unauthorized|login|Log in/i
    );
  }, 15000);
});
