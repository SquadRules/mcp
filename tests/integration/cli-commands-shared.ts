/**
 * Shared utilities for CLI command tests.
 * CLI uses config under XDG_CONFIG_HOME (set by test runner). Tests run "cli login --token" then run commands; no env overrides.
 */

import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';
import { getMcpTestBearerToken, getTestAuthBaseUrl } from '../utils/auth-headers.js';
import { MOCK_REVIEW_EVIDENCE } from '../utils/mock-review-evidence.js';

const CONFIG_DIR_NAME = 'squadrules';
const CONFIG_FILE_NAME = 'config.json';

/** Same logic as src/cli/config-file.ts so we don't pull in keyring under Jest. */
function getConfigDir(): string {
  if (platform() === 'win32') {
    const appData = process.env['APPDATA'] || join(homedir(), 'AppData', 'Roaming');
    return join(appData, CONFIG_DIR_NAME);
  }
  const base = process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config');
  return join(base, CONFIG_DIR_NAME);
}

function getConfigPath(): string {
  return join(getConfigDir(), CONFIG_FILE_NAME);
}

export const BASE_URL = getTestAuthBaseUrl();
export const CLI_PATH = join(process.cwd(), 'dist/cli/index.js');
export const TEST_FILE = join(process.cwd(), 'tests/test-data/cli-minimal-test.md');

const execPromise = promisify(exec);
const execFilePromise = promisify(execFile);

/** Run "cli login --token" so config is written to XDG_CONFIG_HOME (set by runner). Returns true if login ran, false if no token. */
export async function setupCliConfigWithLogin(): Promise<boolean> {
  // In simple profile auth is disabled, so CLI commands are expected to work without login.
  if (process.env.AUTH_ENABLED !== 'true') return true;
  const token = process.env.AUTH_ENABLED === 'true' ? getMcpTestBearerToken() : undefined;
  if (!token) return false;
  const env = { ...process.env, BROWSER: 'true' };
  await execFilePromise('node', [CLI_PATH, 'login', '--token', token, '--url', BASE_URL], { env, timeout: 15000 });
  return true;
}

/** Run a CLI command. Uses real env (XDG_CONFIG_HOME from runner). */
export async function execAsync(
  command: string,
  options?: { timeout?: number }
): Promise<{ stdout: string; stderr: string }> {
  const env = { ...process.env, BROWSER: 'true', SQUADRULES_REVIEW_EVIDENCE: JSON.stringify(MOCK_REVIEW_EVIDENCE) };
  return execPromise(command, { env, ...options }) as Promise<{ stdout: string; stderr: string }>;
}

/** Run a CLI command with no token: logout, run command (expect auth failure), then login again to restore. */
export async function execAsyncNoAuth(
  command: string,
  options?: { timeout?: number }
): Promise<{ stdout: string; stderr: string }> {
  const env = { ...process.env, BROWSER: 'true', SQUADRULES_REVIEW_EVIDENCE: JSON.stringify(MOCK_REVIEW_EVIDENCE) };
  await execFilePromise('node', [CLI_PATH, 'logout', '--url', BASE_URL], { env, timeout: 10000 }).catch(() => {});
  try {
    return await execPromise(command, { env, ...options });
  } finally {
    const token = getMcpTestBearerToken();
    if (token) {
      await execFilePromise('node', [CLI_PATH, 'login', '--token', token, '--url', BASE_URL], { env, timeout: 10000 }).catch(() => {});
    }
  }
}

/** Write config to the path CLI uses (XDG_CONFIG_HOME from runner), then run command. Clears token first (logout) so keyring does not override the written config. */
export async function execAsyncWithConfig(
  command: string,
  config: { SQUADRULES_API_URL?: string; bearerToken?: string },
  options?: { timeout?: number }
): Promise<{ stdout: string; stderr: string }> {
  const env = { ...process.env, BROWSER: 'true', SQUADRULES_REVIEW_EVIDENCE: JSON.stringify(MOCK_REVIEW_EVIDENCE) };
  const url = config.SQUADRULES_API_URL ?? BASE_URL;
  await execFilePromise('node', [CLI_PATH, 'logout', '--url', url], { env, timeout: 10000 }).catch(() => {});
  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), { mode: 0o600 });
  return execPromise(command, { env, ...options }) as Promise<{ stdout: string; stderr: string }>;
}

export async function setupServerCheck() {
  return true;
}

/**
 * Use at the start of CLI integration tests that need a live server and `cli login --token`.
 * Replaces silent `if (!serverAvailable || !cliLoggedIn) return` (which passes with zero assertions).
 */
export function requireMcpServerAndCliLogin(serverAvailable: boolean, cliLoggedIn: boolean): void {
  if (!serverAvailable || !cliLoggedIn) {
    throw new Error(
      'CLI integration requires dev server and CLI login (setupServerCheck + setupCliConfigWithLogin). Refusing silent skip.'
    );
  }
}

/** Preflight URI from train/activate in beforeAll; fail loudly if missing. */
export function requireCachedLayerUri(uri: string | null | undefined, what: string): asserts uri is string {
  if (uri == null || uri === '') {
    throw new Error(`Missing cached layer URI for ${what}: train/activate preflight did not produce a URI.`);
  }
}
