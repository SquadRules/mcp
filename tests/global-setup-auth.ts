/**
 * Jest globalSetup when AUTH_ENABLED=true.
 * Provisions Keycloak (if needed) and test token; app must already be running (e.g. npm run dev:deploy).
 * Cleans stale auth state at start so tests never rely on old tokens or wrong baseUrl.
 */

import { execSync } from 'child_process';
import { writeFileSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';
import { v5 as uuidv5 } from 'uuid';
import {
  startKeycloakWithTestUser,
  useExistingKeycloakFromEnv
} from './utils/keycloak-container';

/** Same as src/http/bearer-validate realmFromIssuer (globalSetup cannot import src — runs before ts-jest ESM hooks). */
function realmFromIssuer(iss: string): string {
  const match = /\/realms\/([^/]+)/.exec(iss);
  const segment = match?.[1] ?? iss.split('/').filter(Boolean).pop();
  return typeof segment === 'string' ? segment : 'default';
}

const SPACE_ID_NAMESPACE = '1b671a64-40d5-491e-99b0-da01ff1f3341';

function normalizeRealmSlug(realm: string): string {
  const raw = (realm || '').trim().toLowerCase();
  const slug = raw.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'default';
}

function normalizeIssuer(iss: string, realmSlug: string): string {
  const trimmed = (iss || '').trim();
  if (!trimmed) return `realm:${realmSlug}`;
  return trimmed.replace(/\/+$/, '');
}

/** Env suffix for test auth file (e.g. .test-auth-env.dev.json). */
function getEnvSuffix(): string {
  return process.env.ENV || 'dev';
}

function getAuthEnvFile(root: string): string {
  return join(root, `.test-auth-env.${getEnvSuffix()}.json`);
}
function getAuthStateFile(root: string): string {
  return join(root, `.test-auth-state.${getEnvSuffix()}.json`);
}

/**
 * Decode JWT payload (no verify) to build personal space id in the same format
 * as runtime tenant context:
 * user:<realmSlug>:<uuidv5(iss + "\nuser\n" + sub)>
 * Realm must match bearer-validate (issuer URL), not a stray JWT `realm` claim, or activate/train space params fail resolution.
 */
/**
 * Fail fast when Keycloak has no group membership for the test user (spaces would omit type:group — #278).
 * Only for existing Keycloak from .env; Testcontainers setup does not run deploy-configure-keycloak-realms.py.
 */
async function assertOidcUserinfoHasGroups(bearerToken: string): Promise<void> {
  const keycloakUrl = process.env.KEYCLOAK_URL?.replace(/\/$/, '');
  const realm = process.env.KEYCLOAK_REALM?.trim() || 'squadrules-dev';
  if (!keycloakUrl) return;
  const url = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/userinfo`;
  let body: Record<string, unknown>;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${bearerToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) {
      throw new Error(`userinfo HTTP ${res.status}`);
    }
    body = (await res.json()) as Record<string, unknown>;
  } catch (e) {
    throw new Error(
      `globalSetup: OIDC userinfo failed (${e instanceof Error ? e.message : String(e)}). ` +
        'Check KEYCLOAK_URL / realm and that the test password grant token is valid.'
    );
  }
  const groups = body['groups'];
  const ok = Array.isArray(groups) && groups.some((g) => typeof g === 'string' && g.length > 0);
  if (!ok) {
    throw new Error(
      'globalSetup: OIDC userinfo has no non-empty `groups` for the test user. ' +
        'Assign squadrules-tester to at least one realm group (e.g. /shared/ci-test) and run ' +
        '`python3 scripts/deploy-configure-keycloak-realms.py` against this Keycloak.'
    );
  }
}

function spaceIdFromToken(token: string): string | undefined {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()) as { sub?: string; iss?: string };
    const sub = payload.sub;
    if (!sub || typeof sub !== 'string') return undefined;
    const iss = typeof payload.iss === 'string' ? payload.iss : '';
    if (!iss) return undefined;
    const realmSlug = normalizeRealmSlug(realmFromIssuer(iss));
    const issuerKey = normalizeIssuer(iss, realmSlug);
    const personalUuid = uuidv5(`${issuerKey}\nuser\n${sub}`, SPACE_ID_NAMESPACE);
    return `user:${realmSlug}:${personalUuid}`;
  } catch {
    return undefined;
  }
}

interface AuthState {
  containerId?: string;
  serverPid?: number | null;
}

function cleanStaleAuthState(root: string): void {
  const statePath = getAuthStateFile(root);
  if (existsSync(statePath)) {
    try {
      const state = JSON.parse(readFileSync(statePath, 'utf-8')) as AuthState;
      if (state.serverPid) {
        try {
          process.kill(state.serverPid, 'SIGTERM');
        } catch {
          // already gone
        }
      }
      if (state.containerId) {
        try {
          execSync(`docker stop ${state.containerId}`, { stdio: 'ignore' });
        } catch {
          // already stopped
        }
      }
    } catch {
      // ignore parse/read errors
    }
    try {
      unlinkSync(statePath);
    } catch {
      // ignore
    }
  }
  const envPath = getAuthEnvFile(root);
  if (existsSync(envPath)) {
    try {
      unlinkSync(envPath);
    } catch {
      // ignore
    }
  }
}

function normalizeRedisUrl(rawUrl: string | undefined, rawPassword: string | undefined): string {
  const url = (rawUrl || '').trim();
  const password = (rawPassword || '').trim();
  if (!url || !password) return url;
  try {
    const parsed = new URL(url);
    if ((parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') || parsed.username || parsed.password) {
      return url;
    }
    parsed.password = password;
    return parsed.toString();
  } catch {
    return url;
  }
}

function loadEnv(): void {
  const root = process.cwd();
  const env = process.env.ENV || 'dev';
  const envFile = join(root, `.env.${env}`);
  // Load .env as base first, then .env.${ENV} with override so profile-specific
  // values (e.g. empty REDIS_URL in stdio mode) win over the base .env.
  if (existsSync(join(root, '.env'))) config({ path: join(root, '.env'), override: false });
  if (existsSync(envFile)) config({ path: envFile, override: true });
  
  // Normalize Redis URL with password if available
  const normalizedRedisUrl = normalizeRedisUrl(process.env.REDIS_URL, process.env.REDIS_PASSWORD);
  if (normalizedRedisUrl) {
    process.env.REDIS_URL = normalizedRedisUrl;
  }
}

/** Run scripts/deploy-configure-keycloak-realms.py so realm and squadrules-cli client exist (required for CLI auth E2E). */
function configureKeycloakRealms(root: string): void {
  const script = join(root, 'scripts', 'deploy-configure-keycloak-realms.py');
  if (!existsSync(script)) return;
  const keycloakUrl = process.env.KEYCLOAK_URL ?? '';
  const hostReachable =
    /^https?:\/\/keycloak:/.test(keycloakUrl)
      ? 'http://localhost:8080'
      : keycloakUrl;
  const env = { ...process.env, KEYCLOAK_URL: hostReachable || 'http://localhost:8080' };
  try {
    execSync(`python3 "${script}"`, { stdio: 'pipe', env, cwd: root });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`deploy-configure-keycloak-realms.py failed: ${msg}`);
  }
}

export default async function globalSetup(): Promise<void> {
  loadEnv();
  cleanStaleAuthState(process.cwd());
  if (process.env.AUTH_ENABLED !== 'true') return;

  const port = process.env['SERVER_PORT'] || '3300';
  const useExisting =
    process.env.KEYCLOAK_URL != null && process.env.KEYCLOAK_URL.trim() !== '';
  const baseUrl = `http://localhost:${port}`;

  if (useExisting) {
    configureKeycloakRealms(process.cwd());
  }

  const env = useExisting
    ? await useExistingKeycloakFromEnv()
    : await startKeycloakWithTestUser();
  const bearerToken = await env.getTestUserToken();
  if (useExisting) {
    await assertOidcUserinfoHasGroups(bearerToken);
  }
  const containerId = env.container?.getId();
  const spaceId = spaceIdFromToken(bearerToken);
  const cwd = process.cwd();
  writeFileSync(
    getAuthEnvFile(cwd),
    JSON.stringify({ bearerToken, baseUrl, keycloakUrl: env.keycloakUrl, ...(spaceId && { spaceId }) })
  );
  writeFileSync(getAuthStateFile(cwd), JSON.stringify({ containerId: containerId ?? undefined, serverPid: undefined }));
}
