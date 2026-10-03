// squadrules-compat-surface: references Keycloak realm/client or keyring service names (kairos-dev / kairos-prod / kairos-cli) provisioned in existing deployments
import { readFileSync } from 'fs';
import path from 'path';
import { getMcpTestBearerToken, hasAuthToken, serverRequiresAuth, isHttpTransport } from '../../../utils/auth-headers.js';

function parseJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 2) throw new Error('Invalid JWT format');
  return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf-8')) as Record<string, unknown>;
}

function readRealmAccessTokenLifespanSec(): number {
  const root = process.cwd();
  const realm = process.env.KEYCLOAK_REALM?.trim() || 'kairos-dev';
  const realmPath = path.join(root, 'scripts', 'keycloak', 'import', `${realm}-realm.json`);
  const raw = readFileSync(realmPath, 'utf-8');
  const parsed = JSON.parse(raw) as { accessTokenLifespan?: unknown };
  const v = parsed.accessTokenLifespan;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw new Error(`Invalid accessTokenLifespan in ${realmPath}`);
  }
  return v;
}

function readConfigDefaultSessionMaxAgeSec(): number {
  const root = process.cwd();
  const p = path.join(root, 'src', 'config.ts');
  const raw = readFileSync(p, 'utf-8');
  const match = raw.match(/getEnvInt\(\s*'SESSION_MAX_AGE_SEC'\s*,\s*([0-9_]+)\s*\)/);
  if (!match?.[1]) throw new Error(`SESSION_MAX_AGE_SEC default missing from ${p}`);
  const parsed = parseInt(match[1].replace(/_/g, ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid SESSION_MAX_AGE_SEC default in ${p}`);
  return parsed;
}

function readTemplateSessionMaxAgeSec(): number {
  const root = process.cwd();
  const p = path.join(root, 'scripts', 'env', '.env.template');
  const raw = readFileSync(p, 'utf-8');
  const match = raw.match(/^\s*SESSION_MAX_AGE_SEC\s*=\s*([0-9]+)\s*$/m);
  if (!match?.[1]) throw new Error(`SESSION_MAX_AGE_SEC missing from ${p}`);
  const parsed = parseInt(match[1], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid SESSION_MAX_AGE_SEC in ${p}`);
  return parsed;
}

const _d = isHttpTransport() ? describe : describe.skip;

_d('Session TTL alignment', () => {
  test('session TTL resolves from token TTL when available', async () => {
    const { resolveSessionMaxAgeSec } = await import('../../../../src/http/http-auth-callback.js');
    const nowSec = 1000;
    expect(
      resolveSessionMaxAgeSec({
        nowSec,
        sessionMaxAgeSecFallback: 25_200,
        tokenExpiresIn: 28_800,
        accessTokenExp: null
      })
    ).toBe(28_740);
    expect(
      resolveSessionMaxAgeSec({
        nowSec,
        sessionMaxAgeSecFallback: 25_200,
        tokenExpiresIn: null,
        accessTokenExp: nowSec + 28_800
      })
    ).toBe(28_740);
    expect(
      resolveSessionMaxAgeSec({
        nowSec,
        sessionMaxAgeSecFallback: 25_200,
        tokenExpiresIn: null,
        accessTokenExp: null
      })
    ).toBe(25_200);
  });

  test('src/config.ts default SESSION_MAX_AGE_SEC is 25200', () => {
    expect(readConfigDefaultSessionMaxAgeSec()).toBe(25_200);
  });

  test('repo default session TTL is lower than realm accessTokenLifespan', async () => {
    const sessionTtl = readTemplateSessionMaxAgeSec();
    const realmTtl = readRealmAccessTokenLifespanSec();
    expect(sessionTtl).toBe(25_200);
    expect(sessionTtl).toBeLessThan(realmTtl);
  });

  test('minted access token TTL is >= repo default session TTL (when auth is enabled)', async () => {
    if (!serverRequiresAuth() || !hasAuthToken()) return;
    const token = getMcpTestBearerToken();
    if (!token) return;

    const sessionTtl = readTemplateSessionMaxAgeSec();
    const realmTtl = readRealmAccessTokenLifespanSec();
    const payload = parseJwtPayload(token);
    const exp = payload.exp;
    const iat = payload.iat;
    expect(typeof exp).toBe('number');
    expect(typeof iat).toBe('number');
    if (typeof exp !== 'number' || typeof iat !== 'number') return;

    const tokenTtl = exp - iat;
    expect(tokenTtl).toBeGreaterThan(0);
    expect(tokenTtl).toBeGreaterThanOrEqual(sessionTtl);

    const usingRepoManagedKeycloak = (process.env.KEYCLOAK_URL?.trim() || '') === '';
    if (usingRepoManagedKeycloak) {
      expect(tokenTtl).toBeGreaterThanOrEqual(realmTtl - 30);
      expect(tokenTtl).toBeLessThanOrEqual(realmTtl + 30);
    }
  }, 60000);
});
