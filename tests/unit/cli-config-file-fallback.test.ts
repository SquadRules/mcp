// squadrules-compat-surface: references Keycloak realm/client or keyring service names (kairos-dev / kairos-prod / kairos-cli) provisioned in existing deployments
/**
 * Regression for the config-file fallback path (issue #638).
 *
 * Covers the previously-untested cases:
 *  - When keyring is unavailable, writeConfig must persist RAW tokens to the file (not the
 *    __KEYCHAIN__ sentinel), and readConfig must round-trip them back (fresh-login fallback).
 *  - When the file holds the __KEYCHAIN__ sentinel but keyring is now unavailable, readConfig
 *    must NOT return a token AND must emit a one-time re-login hint (the L168 dead-end guard),
 *    instead of silently dropping the session.
 *
 * Uses jest.resetModules per test so the module-level one-time warn flags start fresh.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KEYCHAIN_TOKEN_PLACEHOLDER, normalizeApiUrl, parseConfigFile } from '../../src/cli/config-file-internals.js';

const keyringState = {
  available: true,
  tokens: new Map<string, string>(),
  refreshTokens: new Map<string, string>(),
};
const stderrLines: string[] = [];

jest.unstable_mockModule('../../src/cli/keyring.js', () => ({
  isKeyringAvailable: () => keyringState.available,
  getKeyringUnavailableReason: () => (keyringState.available ? null : 'native keyring binding unavailable (test)'),
  getKeyringLoadError: () => null,
  getToken: async (account: string) => keyringState.tokens.get(account) ?? null,
  setToken: async (account: string, token: string) => {
    if (!keyringState.available) return false;
    keyringState.tokens.set(account, token);
    return true;
  },
  deleteToken: async (account: string) => {
    if (!keyringState.available) return false;
    keyringState.tokens.delete(account);
    return true;
  },
  getRefreshToken: async (account: string) => keyringState.refreshTokens.get(account) ?? null,
  setRefreshToken: async (account: string, token: string) => {
    if (!keyringState.available) return false;
    keyringState.refreshTokens.set(account, token);
    return true;
  },
  deleteRefreshToken: async (account: string) => {
    if (!keyringState.available) return false;
    keyringState.refreshTokens.delete(account);
    return true;
  },
}));

jest.unstable_mockModule('../../src/cli/output.js', () => ({
  writeStdout: () => {},
  writeStderr: (msg: string) => { stderrLines.push(msg); },
  writeError: () => {},
}));

let writeConfig: (partial: { apiUrl?: string; bearerToken?: string | null; refreshToken?: string | null }) => Promise<void>;
let readConfig: (baseUrl?: string) => Promise<{ apiUrl?: string; bearerToken?: string; refreshToken?: string }>;
let getConfigPath: () => string;

describe('cli config-file fallback (keyring unavailable)', () => {
  const baseUrl = 'http://localhost:3300/';
  const normalizedUrl = normalizeApiUrl(baseUrl);
  let xdgDir: string;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('../../src/cli/config-file.js');
    writeConfig = mod.writeConfig;
    readConfig = mod.readConfig;
    getConfigPath = mod.getConfigPath;

    xdgDir = mkdtempSync(join(tmpdir(), 'kairos-cli-fallback-test-'));
    process.env['XDG_CONFIG_HOME'] = xdgDir;
    keyringState.available = true;
    keyringState.tokens.clear();
    keyringState.refreshTokens.clear();
    stderrLines.length = 0;
  });

  afterEach(() => {
    rmSync(xdgDir, { recursive: true, force: true });
    delete process.env['XDG_CONFIG_HOME'];
  });

  it('writeConfig stores RAW tokens in file (not the sentinel) when keyring is unavailable', async () => {
    keyringState.available = false;

    await writeConfig({ apiUrl: baseUrl, bearerToken: 'raw-bearer', refreshToken: 'raw-refresh' });

    const parsed = parseConfigFile(getConfigPath());
    expect(parsed?.environments?.[normalizedUrl]).toEqual({
      bearerToken: 'raw-bearer',
      refreshToken: 'raw-refresh',
    });
    expect(parsed?.environments?.[normalizedUrl]?.bearerToken).not.toBe(KEYCHAIN_TOKEN_PLACEHOLDER);
    expect(stderrLines.some((l) => l.includes('storing token in config file'))).toBe(true);
  });

  it('readConfig round-trips RAW tokens from file when keyring is unavailable (fresh login)', async () => {
    keyringState.available = false;
    await writeConfig({ apiUrl: baseUrl, bearerToken: 'raw-bearer', refreshToken: 'raw-refresh' });

    const cfg = await readConfig(baseUrl);
    expect(cfg.apiUrl).toBe(normalizedUrl);
    expect(cfg.bearerToken).toBe('raw-bearer');
    expect(cfg.refreshToken).toBe('raw-refresh');
  });

  it('guards the sentinel dead-end: no token + one-time re-login hint when keyring becomes unavailable', async () => {
    // Store with keyring available → file holds __KEYCHAIN__ sentinels, tokens live in keyring.
    await writeConfig({ apiUrl: baseUrl, bearerToken: 'kc-bearer', refreshToken: 'kc-refresh' });
    const parsed = parseConfigFile(getConfigPath());
    expect(parsed?.environments?.[normalizedUrl]?.bearerToken).toBe(KEYCHAIN_TOKEN_PLACEHOLDER);

    // Keyring becomes unavailable and can no longer return the stored tokens.
    keyringState.available = false;
    keyringState.tokens.clear();
    keyringState.refreshTokens.clear();

    const cfg = await readConfig(baseUrl);
    expect(cfg.bearerToken).toBeUndefined();
    expect(cfg.refreshToken).toBeUndefined();
    expect(stderrLines.some((l) => l.includes('run `kairos login`'))).toBe(true);
  });
});
