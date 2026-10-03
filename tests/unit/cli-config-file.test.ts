import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KEYCHAIN_TOKEN_PLACEHOLDER, normalizeApiUrl, parseConfigFile } from '../../src/cli/config-file-internals.js';

const keyringState = {
  available: true,
  tokens: new Map<string, string>(),
  refreshTokens: new Map<string, string>(),
};

jest.unstable_mockModule('../../src/cli/keyring.js', () => ({
  isKeyringAvailable: () => keyringState.available,
  getKeyringUnavailableReason: () => (keyringState.available ? null : 'test: keyring unavailable'),
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
  writeStderr: () => {},
}));

let writeConfig: (partial: { apiUrl?: string; bearerToken?: string | null; refreshToken?: string | null }) => Promise<void>;
let readConfig: (baseUrl?: string) => Promise<{ apiUrl?: string; bearerToken?: string; refreshToken?: string }>;
let getConfigPath: () => string;

describe('cli config keychain sentinel behavior', () => {
  let xdgDir: string;
  const baseUrl = 'http://localhost:3300/';
  const normalizedUrl = normalizeApiUrl(baseUrl);

  beforeAll(async () => {
    const configModule = await import('../../src/cli/config-file.js');
    writeConfig = configModule.writeConfig;
    readConfig = configModule.readConfig;
    getConfigPath = configModule.getConfigPath;
  });

  beforeEach(() => {
    xdgDir = mkdtempSync(join(tmpdir(), 'squadrules-cli-config-test-'));
    process.env['XDG_CONFIG_HOME'] = xdgDir;
    keyringState.available = true;
    keyringState.tokens.clear();
    keyringState.refreshTokens.clear();
  });

  afterEach(() => {
    rmSync(xdgDir, { recursive: true, force: true });
    delete process.env['XDG_CONFIG_HOME'];
    keyringState.tokens.clear();
    keyringState.refreshTokens.clear();
  });

  it('writeConfig stores sentinel in file when keyring accepts secrets', async () => {
    await writeConfig({
      apiUrl: baseUrl,
      bearerToken: 'bearer-from-login',
      refreshToken: 'refresh-from-login',
    });

    const parsed = parseConfigFile(getConfigPath());
    expect(parsed).not.toBeNull();
    expect(parsed?.defaultUrl).toBe(normalizedUrl);
    expect(parsed?.environments?.[normalizedUrl]).toEqual({
      bearerToken: KEYCHAIN_TOKEN_PLACEHOLDER,
      refreshToken: KEYCHAIN_TOKEN_PLACEHOLDER,
    });
    expect(keyringState.tokens.get(normalizedUrl)).toBe('bearer-from-login');
    expect(keyringState.refreshTokens.get(normalizedUrl)).toBe('refresh-from-login');
  });

  it('readConfig resolves sentinel from keyring values', async () => {
    await writeConfig({ apiUrl: baseUrl, bearerToken: 'stored-bearer', refreshToken: 'stored-refresh' });

    const cfg = await readConfig(baseUrl);
    expect(cfg.apiUrl).toBe(normalizedUrl);
    expect(cfg.bearerToken).toBe('stored-bearer');
    expect(cfg.refreshToken).toBe('stored-refresh');
  });

  it('readConfig does not return sentinel as bearer when keyring token is missing', async () => {
    await writeConfig({ apiUrl: baseUrl, bearerToken: 'temporary-bearer' });
    keyringState.tokens.delete(normalizedUrl);

    const cfg = await readConfig(baseUrl);
    expect(cfg.apiUrl).toBe(normalizedUrl);
    expect(cfg.bearerToken).toBeUndefined();
  });
});
