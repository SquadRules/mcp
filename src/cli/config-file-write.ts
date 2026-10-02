// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
/**
 * Persist CLI config / merge secrets (keyring + file). See config-file.ts for read API.
 */

import {
    deleteRefreshToken,
    deleteToken,
    getKeyringUnavailableReason,
    isKeyringAvailable,
    setRefreshToken,
    setToken,
} from './keyring.js';
import { writeStderr } from './output.js';
import {
  type ConfigFileShape,
  type EnvironmentEntry,
  getConfigPath,
  isSingleEnvFlatConfig,
  KEYCHAIN_TOKEN_PLACEHOLDER,
  normalizeApiUrl,
  parseConfigFile,
  writeConfigShape,
} from './config-file-internals.js';

let fallbackWarned = false;

function warnFallbackOnce(): void {
    if (fallbackWarned) return;
    fallbackWarned = true;
    const reason = getKeyringUnavailableReason();
    if (reason) {
        writeStderr(`Keyring unavailable (${reason}); storing token in config file.`);
    } else {
        writeStderr('Keyring unavailable; storing token in config file.');
    }
}

export type WriteConfigInput = {
    apiUrl?: string;
    bearerToken?: string | null;
    refreshToken?: string | null;
};

export async function writeConfig(partial: WriteConfigInput): Promise<void> {
  const path = getConfigPath();
  const parsed = parseConfigFile(path);
  const useKeyring = isKeyringAvailable();

  let defaultUrl: string | undefined;
  let environments: Record<string, EnvironmentEntry>;

  if (!parsed || isSingleEnvFlatConfig(parsed)) {
    defaultUrl = typeof parsed?.KAIROS_API_URL === 'string' ? normalizeApiUrl(parsed.KAIROS_API_URL) : undefined;
    environments = {};
    if (defaultUrl) {
      const entry: EnvironmentEntry = {};
      if (typeof parsed?.bearerToken === 'string') entry.bearerToken = parsed.bearerToken;
      if (typeof parsed?.refreshToken === 'string') entry.refreshToken = parsed.refreshToken;
      if (Object.keys(entry).length > 0) environments[defaultUrl] = entry;
    }
  } else {
    defaultUrl = typeof parsed.defaultUrl === 'string' ? normalizeApiUrl(parsed.defaultUrl) : undefined;
    environments = { ...(parsed.environments ?? {}) };
  }

  const partialUrl = partial.apiUrl !== undefined ? normalizeApiUrl(partial.apiUrl) : undefined;
  const setEnvTokenPlaceholder = (url: string, key: 'bearerToken' | 'refreshToken'): void => {
    const entry = environments[url] ?? {};
    entry[key] = KEYCHAIN_TOKEN_PLACEHOLDER;
    environments[url] = entry;
  };

  if (partialUrl !== undefined) {
    defaultUrl = partialUrl;
    if (!environments[partialUrl]) environments[partialUrl] = {};

    if (partial.bearerToken === null) {
      if (useKeyring) await deleteToken(partialUrl);
      if (useKeyring) await deleteRefreshToken(partialUrl);
      delete environments[partialUrl].bearerToken;
      delete environments[partialUrl].refreshToken;
    } else if (partial.bearerToken !== undefined) {
      if (useKeyring) {
        const stored = await setToken(partialUrl, partial.bearerToken);
        if (stored) {
          setEnvTokenPlaceholder(partialUrl, 'bearerToken');
        } else {
          warnFallbackOnce();
          environments[partialUrl].bearerToken = partial.bearerToken;
        }
      } else {
        warnFallbackOnce();
        environments[partialUrl].bearerToken = partial.bearerToken;
      }
    }

    if (partial.refreshToken === null) {
      if (useKeyring) await deleteRefreshToken(partialUrl);
      delete environments[partialUrl].refreshToken;
    } else if (partial.refreshToken !== undefined) {
      if (useKeyring) {
        const stored = await setRefreshToken(partialUrl, partial.refreshToken);
        if (stored) {
          setEnvTokenPlaceholder(partialUrl, 'refreshToken');
        } else {
          warnFallbackOnce();
          environments[partialUrl].refreshToken = partial.refreshToken;
        }
      } else {
        warnFallbackOnce();
        environments[partialUrl].refreshToken = partial.refreshToken;
      }
    }

    const entPartial = environments[partialUrl];
    if (entPartial && Object.keys(entPartial).length === 0) delete environments[partialUrl];
  } else if (partial.bearerToken === null && defaultUrl) {
    if (useKeyring) await deleteToken(defaultUrl);
    if (useKeyring) await deleteRefreshToken(defaultUrl);
    const ent = environments[defaultUrl];
    if (ent) {
      delete ent.bearerToken;
      delete ent.refreshToken;
      if (Object.keys(ent).length === 0) delete environments[defaultUrl];
    }
  } else if (partial.bearerToken !== undefined && partial.bearerToken !== null && defaultUrl) {
    if (useKeyring) {
      const stored = await setToken(defaultUrl, partial.bearerToken);
      if (stored) {
        setEnvTokenPlaceholder(defaultUrl, 'bearerToken');
      } else {
        warnFallbackOnce();
        const ent = environments[defaultUrl] ?? {};
        ent.bearerToken = partial.bearerToken;
        environments[defaultUrl] = ent;
      }
    } else {
      warnFallbackOnce();
      const ent = environments[defaultUrl] ?? {};
      ent.bearerToken = partial.bearerToken;
      environments[defaultUrl] = ent;
    }
  } else if (partial.refreshToken === null && defaultUrl) {
    if (useKeyring) await deleteRefreshToken(defaultUrl);
    const ent = environments[defaultUrl];
    if (ent) {
      delete ent.refreshToken;
      if (Object.keys(ent).length === 0) delete environments[defaultUrl];
    }
  } else if (partial.refreshToken !== undefined && partial.refreshToken !== null && defaultUrl) {
    if (useKeyring) {
      const stored = await setRefreshToken(defaultUrl, partial.refreshToken);
      if (stored) {
        setEnvTokenPlaceholder(defaultUrl, 'refreshToken');
      } else {
        warnFallbackOnce();
        const ent = environments[defaultUrl] ?? {};
        ent.refreshToken = partial.refreshToken;
        environments[defaultUrl] = ent;
      }
    } else {
      warnFallbackOnce();
      const ent = environments[defaultUrl] ?? {};
      ent.refreshToken = partial.refreshToken;
      environments[defaultUrl] = ent;
    }
  }

  const next: ConfigFileShape = defaultUrl !== undefined ? { defaultUrl, environments } : { environments };
  writeConfigShape(next);
}
