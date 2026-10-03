// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
/**
 * CLI config file: token and API URL storage (XDG-compliant, user-only readable).
 * Supports multiple environments keyed by KAIROS_API_URL (normalized, no trailing slash).
 * When keyring is available, bearer and refresh tokens are stored in the OS keyring; the config file
 * holds only defaultUrl and environment keys. When keyring is unavailable, secrets are
 * stored in the file (with a one-time warning).
 *
 * New format:
 *   { "defaultUrl": "http://localhost:<SERVER_PORT>", "environments": { "http://localhost:<SERVER_PORT>": { "bearerToken": "..." }, ... } }
 * Older single-env shape: { "KAIROS_API_URL": "...", "bearerToken": "..." } — migrated on first write.
 */

import {
  getRefreshToken,
  getToken,
  isKeyringAvailable,
  setRefreshToken,
  setToken,
} from './keyring.js';
import { writeStderr } from './output.js';
import {
  getConfigPath,
  isKeychainTokenPlaceholder,
  isSingleEnvFlatConfig,
  KEYCHAIN_TOKEN_PLACEHOLDER,
  normalizeApiUrl,
  parseConfigFile,
  writeConfigShape,
} from './config-file-internals.js';
export { writeConfig } from './config-file-write.js';
export { normalizeApiUrl, getConfigPath } from './config-file-internals.js';

export interface CliConfig {
  apiUrl?: string;
  bearerToken?: string;
  /** Present after browser PKCE login when IdP issued a refresh_token; omitted for `login --token`. */
  refreshToken?: string;
}

function extractInlineSecret(value: string | undefined): { inlineValue: string | undefined; hadPlaceholder: boolean } {
  if (isKeychainTokenPlaceholder(value)) return { inlineValue: undefined, hadPlaceholder: true };
  return { inlineValue: value, hadPlaceholder: false };
}

let keychainUnreachableWarned = false;
/**
 * One-time warning for the placeholder dead-end: the file marks a token as keychain-stored
 * (__KEYCHAIN__) but the keyring can no longer return it (binding gone or timed out). Without this
 * the CLI silently drops the session; here we tell the user how to recover.
 */
function warnKeychainUnreachableOnce(): void {
  if (keychainUnreachableWarned) return;
  keychainUnreachableWarned = true;
  writeStderr('Token was saved to the OS keychain but the keyring is now unavailable — run `kairos login` to re-authenticate.');
}

function persistEnvironmentSentinel(path: string, url: string, opts: { bearer?: boolean; refresh?: boolean }): void {
  const parsed = parseConfigFile(path);
  if (!parsed || isSingleEnvFlatConfig(parsed)) return;
  const envs = { ...(parsed.environments ?? {}) };
  const entry = { ...(envs[url] ?? {}) };
  if (opts.bearer) entry.bearerToken = KEYCHAIN_TOKEN_PLACEHOLDER;
  if (opts.refresh) entry.refreshToken = KEYCHAIN_TOKEN_PLACEHOLDER;
  envs[url] = entry;
  if (typeof parsed.defaultUrl === 'string') writeConfigShape({ defaultUrl: parsed.defaultUrl, environments: envs });
  else writeConfigShape({ environments: envs });
}

/**
 * Sync read of default API URL from config file (no keyring/token). Used by ApiClient constructor.
 */
export function getDefaultApiUrlFromFile(): string | undefined {
    const path = getConfigPath();
    const parsed = parseConfigFile(path);
    if (!parsed) return undefined;
    if (isSingleEnvFlatConfig(parsed) && typeof parsed.KAIROS_API_URL === 'string') {
        return normalizeApiUrl(parsed.KAIROS_API_URL);
    }
    if (typeof parsed.defaultUrl === 'string') return normalizeApiUrl(parsed.defaultUrl);
    const envs = parsed.environments ?? {};
    const first = Object.keys(envs)[0];
    return first ? normalizeApiUrl(first) : undefined;
}

/**
 * Read config from disk. When baseUrl is given, returns config for that environment (token for that URL).
 * When omitted, returns the default environment (defaultUrl). Returns empty object if file missing or invalid.
 * Tokens are read from keyring when available; tokens in the file are migrated to keyring on first read.
 */
export async function readConfig(baseUrl?: string): Promise<CliConfig> {
  const path = getConfigPath();
  const parsed = parseConfigFile(path);
  if (!parsed) return {};
  const useKeyring = isKeyringAvailable();

  let effectiveUrl: string | undefined;
  let tokenFromFile: string | undefined;
  let refreshFromFile: string | undefined;
  let hadTokenPlaceholder = false;
  let hadRefreshPlaceholder = false;
  let apiUrlOut: string | undefined;

  if (isSingleEnvFlatConfig(parsed)) {
    const storedSingleUrlRaw = typeof parsed.KAIROS_API_URL === 'string' ? parsed.KAIROS_API_URL : undefined;
    const normalizedStoredSingleUrl = storedSingleUrlRaw ? normalizeApiUrl(storedSingleUrlRaw) : undefined;
    const normalizedBase = baseUrl ? normalizeApiUrl(baseUrl) : undefined;
    const isMatchingStoredSingle = !!(
      normalizedStoredSingleUrl &&
      ((!normalizedBase && normalizedStoredSingleUrl) || normalizedBase === normalizedStoredSingleUrl)
    );

    if (!normalizedStoredSingleUrl && normalizedBase) {
      effectiveUrl = normalizedBase;
      apiUrlOut = normalizedBase;
    } else if (normalizedStoredSingleUrl && (normalizedBase === undefined || normalizedBase === normalizedStoredSingleUrl)) {
      effectiveUrl = normalizedStoredSingleUrl;
      apiUrlOut = normalizedStoredSingleUrl;
      tokenFromFile = typeof parsed.bearerToken === 'string' ? parsed.bearerToken : undefined;
      refreshFromFile = typeof parsed.refreshToken === 'string' ? parsed.refreshToken : undefined;
      const tokenInfo = extractInlineSecret(tokenFromFile);
      const refreshInfo = extractInlineSecret(refreshFromFile);
      hadTokenPlaceholder = tokenInfo.hadPlaceholder;
      hadRefreshPlaceholder = refreshInfo.hadPlaceholder;
      const tokenInline = tokenInfo.inlineValue;
      const refreshInline = refreshInfo.inlineValue;

      if (useKeyring && isMatchingStoredSingle) {
        let tokenStored = false;
        let refreshStored = false;
        if (tokenInline) tokenStored = await setToken(normalizedStoredSingleUrl, tokenInline);
        if (refreshInline) refreshStored = await setRefreshToken(normalizedStoredSingleUrl, refreshInline);

        const nextEntry: { bearerToken?: string; refreshToken?: string } = {};
        if (tokenFromFile !== undefined) {
          if (tokenStored || hadTokenPlaceholder) nextEntry.bearerToken = KEYCHAIN_TOKEN_PLACEHOLDER;
          else if (tokenInline) nextEntry.bearerToken = tokenInline;
        }
        if (refreshFromFile !== undefined) {
          if (refreshStored || hadRefreshPlaceholder) nextEntry.refreshToken = KEYCHAIN_TOKEN_PLACEHOLDER;
          else if (refreshInline) nextEntry.refreshToken = refreshInline;
        }
        writeConfigShape({
          defaultUrl: normalizedStoredSingleUrl,
          environments: Object.keys(nextEntry).length > 0 ? { [normalizedStoredSingleUrl]: nextEntry } : {},
        });
      }
    } else {
      effectiveUrl = normalizedBase;
      apiUrlOut = normalizedBase;
    }
  } else {
    const environments = parsed.environments ?? {};
    const defaultUrl = typeof parsed.defaultUrl === 'string' ? normalizeApiUrl(parsed.defaultUrl) : undefined;
    effectiveUrl = baseUrl ? normalizeApiUrl(baseUrl) : defaultUrl ?? Object.keys(environments)[0];
    if (!effectiveUrl) return {};
    apiUrlOut = effectiveUrl;
    const entry = environments[effectiveUrl];
    tokenFromFile = entry && typeof entry.bearerToken === 'string' ? entry.bearerToken : undefined;
    refreshFromFile = entry && typeof entry.refreshToken === 'string' ? entry.refreshToken : undefined;
    const tokenInfo = extractInlineSecret(tokenFromFile);
    const refreshInfo = extractInlineSecret(refreshFromFile);
    tokenFromFile = tokenInfo.inlineValue;
    refreshFromFile = refreshInfo.inlineValue;
    hadTokenPlaceholder = tokenInfo.hadPlaceholder;
    hadRefreshPlaceholder = refreshInfo.hadPlaceholder;
  }

  if (!effectiveUrl) return {};

  const fromKeyring = await getToken(effectiveUrl);
  let token = fromKeyring ?? null;
  if (!token && tokenFromFile) {
    if (useKeyring) {
      const stored = await setToken(effectiveUrl, tokenFromFile);
      token = tokenFromFile;
      if (stored) persistEnvironmentSentinel(path, effectiveUrl, { bearer: true });
    } else {
      token = tokenFromFile;
    }
  }
  if (hadTokenPlaceholder && !fromKeyring) {
    if (!isKeyringAvailable()) warnKeychainUnreachableOnce();
    token = null;
  }

  const fromKeyringRefresh = await getRefreshToken(effectiveUrl);
  let refreshToken = fromKeyringRefresh ?? null;
  if (!refreshToken && refreshFromFile) {
    if (useKeyring) {
      const stored = await setRefreshToken(effectiveUrl, refreshFromFile);
      refreshToken = refreshFromFile;
      if (stored) persistEnvironmentSentinel(path, effectiveUrl, { refresh: true });
    } else {
      refreshToken = refreshFromFile;
    }
  }
  if (hadRefreshPlaceholder && !fromKeyringRefresh) {
    if (!isKeyringAvailable()) warnKeychainUnreachableOnce();
    refreshToken = null;
  }

  const out: CliConfig = {};
  if (apiUrlOut) out.apiUrl = apiUrlOut;
  if (token) out.bearerToken = token;
  if (refreshToken) out.refreshToken = refreshToken;
  return out;
}
