// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
/**
 * Auth headers for integration tests when AUTH_ENABLED=true.
 * Reads .test-auth-env.dev.json written by globalSetup (when server requires auth).
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { v5 as uuidv5 } from 'uuid';

function getEnvSuffix(): string {
  return process.env.ENV || 'dev';
}

/** Same convention as global-setup-auth: .test-auth-env.<env>.json */
function getAuthEnvFilePath(): string {
  return join(process.cwd(), `.test-auth-env.${getEnvSuffix()}.json`);
}

export const TEST_USERNAME = 'kairos-tester';
export const TEST_PASSWORD = 'kairos-tester-secret';

interface TestAuthEnv {
  bearerToken?: string;
  baseUrl?: string;
  keycloakUrl?: string;
  /** Space of kairos-tester (user:realm:sub from token); use for activate space_id so tests use actual test user scope */
  spaceId?: string;
}

const SPACE_ID_NAMESPACE = '1b671a64-40d5-491e-99b0-da01ff1f3341';

function realmFromIssuer(iss: string): string {
  const match = /\/realms\/([^/]+)/.exec(iss);
  const segment = match?.[1] ?? iss.split('/').filter(Boolean).pop();
  return typeof segment === 'string' ? segment : 'default';
}

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

let cached: TestAuthEnv | null | undefined = undefined;

function readAuthEnv(): TestAuthEnv | null {
  if (cached !== undefined) return cached;
  const path = getAuthEnvFilePath();
  if (!existsSync(path)) {
    cached = null;
    return null;
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    cached = JSON.parse(raw) as TestAuthEnv;
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

/** Invalidate cached auth env file so next read re-reads from disk. */
export function invalidateAuthEnvCache(): void {
  cached = undefined;
}

async function fetchKeycloakToken(
  keycloakUrl: string,
  realm: string,
  clientId: string,
  username: string,
  password: string
): Promise<string> {
  const tokenUrl = `${keycloakUrl.replace(/\/$/, '')}/realms/${realm}/protocol/openid-connect/token`;
  /** Include `kairos-groups` so access token + userinfo carry Group Membership (integration / #278). */
  const scope =
    process.env.KAIROS_TEST_OIDC_SCOPE?.trim() || 'openid kairos-groups';
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: clientId,
      username,
      password,
      scope
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Keycloak token failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error('No access_token in Keycloak response');
  return data.access_token;
}

/**
 * Fetch a fresh Keycloak token and update `.test-auth-env.dev.json`.
 * Works from `process.env` alone (KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_CLIENT_ID) so integration
 * tests get `kairos-groups` + password grant even when the auth file is missing or stale (#278).
 */
export async function refreshTestAuthToken(): Promise<boolean> {
  if (process.env.AUTH_ENABLED !== 'true') return false;
  const keycloakUrl = process.env.KEYCLOAK_URL?.replace(/\/$/, '');
  const realm = process.env.KEYCLOAK_REALM?.trim();
  const clientId = process.env.KEYCLOAK_CLIENT_ID?.trim();
  if (!keycloakUrl || !realm || !clientId) return false;
  const port = process.env['SERVER_PORT'] || '3300';
  const baseUrl =
    readAuthEnv()?.baseUrl?.trim() ||
    process.env.KAIROS_TEST_BASE_URL?.trim() ||
    `http://localhost:${port}`;
  const username = process.env.TEST_USERNAME?.trim() || TEST_USERNAME;
  const password = process.env.TEST_PASSWORD?.trim() || TEST_PASSWORD;
  try {
    const token = await fetchKeycloakToken(keycloakUrl, realm, clientId, username, password);
    const spaceId = spaceIdFromToken(token);
    const prev = readAuthEnv();
    const next: TestAuthEnv = {
      ...(prev ?? {}),
      bearerToken: token,
      baseUrl,
      keycloakUrl,
      ...(spaceId && { spaceId })
    };
    writeFileSync(getAuthEnvFilePath(), JSON.stringify(next));
    invalidateAuthEnvCache();
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns headers to attach to requests when running with auth.
 * When the env-specific auth file exists and has bearerToken, returns { Authorization: 'Bearer <token>' }; otherwise {}.
 */
export function getAuthHeaders(): Record<string, string> {
  const env = readAuthEnv();
  if (env?.bearerToken) return { Authorization: `Bearer ${env.bearerToken}` };
  return {};
}

/**
 * Base URL for the app. When AUTH_ENABLED=true and the auth file exists, use its baseUrl; otherwise http://localhost:SERVER_PORT.
 */
export function getTestAuthBaseUrl(): string {
  if (process.env.AUTH_ENABLED === 'true') {
    const env = readAuthEnv();
    if (env?.baseUrl) return env.baseUrl;
  }
  const port = process.env['SERVER_PORT'] || '3300';
  return `http://localhost:${port}`;
}

/** Keycloak base URL from auth env (preferred) or KEYCLOAK_URL fallback. */
export function getTestKeycloakUrl(): string | undefined {
  const env = readAuthEnv();
  if (env?.keycloakUrl) return env.keycloakUrl;
  const fallback = process.env.KEYCLOAK_URL?.trim();
  return fallback ? fallback.replace(/\/$/, '') : undefined;
}

/** True when server requires auth (from .env). */
export function serverRequiresAuth(): boolean {
  return process.env.AUTH_ENABLED === 'true';
}

/** True when we have a token (e.g. env-specific auth file written by globalSetup). */
export function hasAuthToken(): boolean {
  return readAuthEnv()?.bearerToken != null;
}

/** Raw bearer token from the test auth file (MCP transport, CLI subprocess env). */
export function getMcpTestBearerToken(): string | undefined {
  return readAuthEnv()?.bearerToken ?? undefined;
}

/** Stable activate/write scope for kairos-tester when AUTH_ENABLED. Prefer the human-oriented selector over raw UUID-derived ids in tests. */
export function getTestSpaceId(): string | undefined {
  if (process.env.AUTH_ENABLED !== 'true') return undefined;
  const env = readAuthEnv();
  if (!env?.bearerToken) return undefined;
  return 'personal';
}

/**
 * True when the active transport is HTTP (i.e. not stdio).
 * Tests that call HTTP endpoints directly (not via MCP tool) should check this
 * and skip when running under stdio transport (no HTTP server).
 */
export function isHttpTransport(): boolean {
  return process.env.TRANSPORT_TYPE !== 'stdio';
}

