/**
 * Auth middleware: when AUTH_ENABLED, require session or Bearer for /api and /mcp.
 * Unauthenticated browser GET -> redirect to Keycloak; otherwise 401 with login_url.
 * When AUTH_MODE=oidc_bearer, Bearer tokens are validated (issuer, audience, exp); req.auth is set from session or validated Bearer.
 */
import type { Request, Response, NextFunction } from 'express';
import { METHODS } from 'node:http';
import crypto from 'crypto';
import {
  createOidcLoginUrlForApiResponse,
  redirectBrowserToOidcLogin,
  safeCreateOidcLoginUrlForApiResponse
} from './http-auth-oidc-redirect.js';
import { fromBase64url, toBase64url } from '@exodus/bytes/base64.js';
import { utf8toString } from '@exodus/bytes/utf8.js';
import {
  AUTH_ENABLED,
  AUTH_CALLBACK_BASE_URL,
  SESSION_SECRET,
  AUTH_MODE,
  AUTH_TRUSTED_ISSUERS,
  AUTH_ALLOWED_AUDIENCES,
  OIDC_GROUPS_ALLOWLIST
} from '../config.js';
import { applyOidcGroupsAllowlist } from './oidc-profile-claims.js';
import { validateBearerToken, type AuthPayload } from './bearer-validate.js';
import { getSpaceContext, runWithSpaceContext, type SpaceContext } from '../utils/tenant-context.js';
import { structuredLogger } from '../utils/structured-logger.js';
import { setWwwAuthenticate } from './http-www-authenticate.js';
import { buildJsonRpcAuthError } from './mcp-ui-offerings-auth-jsonrpc.js';
export { setWwwAuthenticate };

export type { AuthPayload };

// Cookie name retained as kairos_session for deployment compatibility.
// Renaming requires dual-emit with matching security attributes, coordinated
// logout clearing, and refresh handling. Deferred to a separate decision.
const SESSION_COOKIE_NAME = 'kairos_session';
/** Alternative cookie name accepted on read for forward-compatibility during SquadRules migration. */
const SESSION_COOKIE_NAME_ALT = 'squadrules_session';
const KNOWN_HTTP_METHODS = new Set<string>(METHODS);

function jsonInvalidTokenResponse(message: string): Record<string, unknown> {
  const loginUrl = safeCreateOidcLoginUrlForApiResponse();
  return {
    error: 'invalid_token',
    message,
    reauth_required: true,
    ...(loginUrl ? { login_url: loginUrl } : {})
  };
}

function getSessionCookie(req: Request): string | null {
  const raw = req.get('cookie');
  if (!raw) return null;
  const cookies = raw.split(';').map((s) => s.trim());
  // Primary cookie takes precedence; fall back to the alternative name
  // for clients that have already adopted squadrules_session.
  for (const name of [SESSION_COOKIE_NAME, SESSION_COOKIE_NAME_ALT]) {
    const match = cookies.find((s) => s.startsWith(name + '='));
    if (match) {
      const value = match.slice((name + '=').length).trim();
      if (value) return decodeURIComponent(value);
    }
  }
  return null;
}

function hasValidSession(req: Request): boolean {
  return getSessionPayload(req) !== null;
}

/** Verify HMAC and parse session cookie JSON; does not check exp/sub. */
function parseVerifiedSessionRecord(req: Request): Record<string, unknown> | null {
  const cookie = getSessionCookie(req);
  if (!cookie || !SESSION_SECRET) return null;
  try {
    const [payloadB64, sig] = cookie.split('.');
    if (!payloadB64 || !sig) return null;
    const expectedSig = toBase64url(
      new Uint8Array(crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest())
    );
    if (sig !== expectedSig) return null;
    return JSON.parse(utf8toString(fromBase64url(payloadB64))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * OIDC id_token from login callback, stored only in the httpOnly session cookie for RP-initiated logout
 * (id_token_hint → Keycloak can skip the static logged-out confirmation screen when configured).
 */
export function peekOidcIdTokenHintFromSession(req: Request): string | null {
  const payload = parseVerifiedSessionRecord(req);
  if (!payload) return null;
  const exp = payload['exp'];
  if (typeof exp === 'number' && exp < Date.now() / 1000) return null;
  const t = payload['oidc_id_token'];
  return typeof t === 'string' && t.length > 0 ? t : null;
}

/** Decode and verify session cookie; returns AuthPayload or null. */
function getSessionPayload(req: Request): AuthPayload | null {
  const payload = parseVerifiedSessionRecord(req);
  if (!payload) return null;
  const exp = payload['exp'];
  if (typeof exp === 'number' && exp < Date.now() / 1000) return null;
  const sub = typeof payload['sub'] === 'string' ? payload['sub'] : '';
  if (!sub) return null;
  const rawGroups = Array.isArray(payload['groups'])
    ? payload['groups'].filter((g): g is string => typeof g === 'string')
    : [];
  const groups = applyOidcGroupsAllowlist(rawGroups, OIDC_GROUPS_ALLOWLIST);
  const realm = typeof payload['realm'] === 'string' ? payload['realm'] : 'default';
  const issRaw = payload['iss'];
  const iss =
    typeof issRaw === 'string' && issRaw.length > 0
      ? issRaw
      : `realm:${realm}`;
  const result: AuthPayload = { sub, groups, realm, iss };
  const pu = payload['preferred_username'];
  if (typeof pu === 'string' && pu.length > 0) result.preferred_username = pu;
  const name = payload['name'];
  if (typeof name === 'string' && name.length > 0) result.name = name;
  const gn = payload['given_name'];
  if (typeof gn === 'string' && gn.length > 0) result.given_name = gn;
  const fn = payload['family_name'];
  if (typeof fn === 'string' && fn.length > 0) result.family_name = fn;
  const em = payload['email'];
  if (typeof em === 'string' && em.length > 0) result.email = em;
  const ev = payload['email_verified'];
  if (ev === true || ev === false) result.email_verified = ev;
  const idp = payload['identity_provider'];
  if (typeof idp === 'string' && idp.length > 0) result.identity_provider = idp;
  const ak = payload['account_kind'];
  if (ak === 'local' || ak === 'sso') result.account_kind = ak;
  const al = payload['account_label'];
  if (typeof al === 'string' && al.length > 0) result.account_label = al;
  return result;
}

function getBearerToken(req: Request): string | null {
  const auth = req.get('authorization');
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) return null;
  return auth.slice(7).trim() || null;
}

function hasBearer(req: Request): boolean {
  return getBearerToken(req) !== null;
}

/** True only when the verb is a real HTTP method and GET (avoids odd client verbs in auth branches). */
function isRecognizedGetRequest(req: Request): boolean {
  const method = req.method;
  return typeof method === 'string' && KNOWN_HTTP_METHODS.has(method) && method === 'GET';
}

/** Paths that require auth when AUTH_ENABLED: /api, /api/*, /mcp, and /ui (SPA). */
function isProtectedPath(path: string): boolean {
  return (
    path === '/api' ||
    path.startsWith('/api/') ||
    path === '/mcp' ||
    path === '/ui' ||
    path.startsWith('/ui/')
  );
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
      spaceContext?: SpaceContext;
      requestId?: string;
    }
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!AUTH_ENABLED) {
    next();
    return;
  }
  if (req.path === '/auth/callback') {
    next();
    return;
  }
  if (req.method === 'OPTIONS') {
    next();
    return;
  }
  if (!isProtectedPath(req.path)) {
    next();
    return;
  }

  const hasSession = hasValidSession(req);
  const hasBearerReq = hasBearer(req);
  structuredLogger.debug(
    `[auth] protected ${req.method} ${req.path} session=${hasSession} bearer=${!!hasBearerReq}`
  );

  function runNext(ctx: SpaceContext): void {
    const requestId = req.requestId || req.get('x-request-id') || '';
    ctx = { ...ctx, requestId };
    const spaceParam = (req.query?.['space'] ?? req.query?.['space_id']) as string | undefined;
    if (spaceParam && typeof spaceParam === 'string') {
      if (!ctx.allowedSpaceIds.includes(spaceParam)) {
        res.status(403).json({ error: 'forbidden', message: 'Requested space is not in your allowed spaces' });
        return;
      }
      const personalSnapshot =
        ctx.personalSpaceId && ctx.personalSpaceId.trim().length > 0
          ? ctx.personalSpaceId
          : ctx.defaultWriteSpaceId?.startsWith('user:')
            ? ctx.defaultWriteSpaceId
            : '';
      ctx = {
        ...ctx,
        allowedSpaceIds: [spaceParam],
        defaultWriteSpaceId: spaceParam,
        ...(personalSnapshot && { personalSpaceId: personalSnapshot })
      };
    }
    req.spaceContext = ctx;
    runWithSpaceContext(ctx, () => next());
  }

  if (hasSession) {
    const payload = getSessionPayload(req);
    if (payload) req.auth = payload;
    structuredLogger.debug(`[auth] allowed session ${req.method} ${req.path}`);
    runNext(getSpaceContext(req));
    return;
  }

  // codeql[js/user-controlled-bypass]: Bearer is an alternate auth path; token is validated or rejected against configured issuer and audience.
  if (hasBearerReq) {
    if (process.env['AUTH_TRACE'] === 'true' || process.env['LOG_LEVEL'] === 'trace') {
      structuredLogger.info(
        `[auth] TRACE raw call ${req.method} ${req.path} bearer=true trusted_issuers=${JSON.stringify(AUTH_TRUSTED_ISSUERS)} allowed_audiences=${JSON.stringify(AUTH_ALLOWED_AUDIENCES)}`
      );
    }
    const hasIssuerAndAudience = AUTH_TRUSTED_ISSUERS.length > 0 && AUTH_ALLOWED_AUDIENCES.length > 0;
    const canValidateBearer =
      hasIssuerAndAudience && (AUTH_MODE === 'oidc_bearer' || AUTH_ENABLED);
    structuredLogger.info(
      `[auth] Bearer check path=${req.path} canValidate=${canValidateBearer} AUTH_MODE=${AUTH_MODE} trusted_issuers=${AUTH_TRUSTED_ISSUERS.length} allowed_audiences=${AUTH_ALLOWED_AUDIENCES.length}`
    );
    if (!canValidateBearer) {
      structuredLogger.info(`[auth] 401 ${req.method} ${req.path} bearer_not_validated (config missing)`);
      setWwwAuthenticate(res);
      res.status(401).json({
        error: 'bearer_not_validated',
        message:
          'Bearer tokens are not validated when issuer/audience are not configured. Set AUTH_TRUSTED_ISSUERS and AUTH_ALLOWED_AUDIENCES (and AUTH_MODE=oidc_bearer or AUTH_ENABLED) to use Bearer auth.'
      });
      return;
    }
    const token = getBearerToken(req);
    try {
      const payload = await validateBearerToken(token!, AUTH_TRUSTED_ISSUERS, AUTH_ALLOWED_AUDIENCES);
      if (payload) {
        req.auth = payload;
        structuredLogger.debug(`[auth] allowed bearer ${req.method} ${req.path}`);
        runNext(getSpaceContext(req));
      } else {
        structuredLogger.info(`[auth] 401 ${req.method} ${req.path} bearer invalid or expired`);
        setWwwAuthenticate(res, {
          error: 'invalid_token',
          error_description:
            'SSO session or access token rejected; sign in again and reconnect MCP if the host caches tokens'
        });
        res.status(401).json(
          jsonInvalidTokenResponse(
            'Your SSO session or access token is no longer accepted. Sign in again and reconnect this MCP server if your host still uses old credentials.'
          )
        );
      }
    } catch {
      structuredLogger.info(`[auth] 401 ${req.method} ${req.path} bearer validation failed`);
      setWwwAuthenticate(res, {
        error: 'invalid_token',
        error_description:
          'Could not validate SSO credentials; sign in again and reconnect MCP if the host caches tokens'
      });
      res.status(401).json(
        jsonInvalidTokenResponse(
          'Your SSO credentials could not be validated. Sign in again and reconnect this MCP server if your host caches tokens.'
        )
      );
    }
    return;
  }

  if (!AUTH_CALLBACK_BASE_URL) {
    res.status(503).json({
      error: 'Auth misconfigured',
      message: 'AUTH_CALLBACK_BASE_URL is required when AUTH_ENABLED is true. Set it in .env (e.g. http://localhost:3500).'
    });
    return;
  }

  // MCP client must receive 401 + WWW-Authenticate to show "Needs authentication" / Connect.
  // Redirect (302) would prevent discovery; always return 401 for /mcp.
  const isMcp = req.path === '/mcp';
  // codeql[js/user-controlled-bypass]: Redirect only when method is GET and listed in node:http METHODS; any other verb gets 401 JSON.
  if (isRecognizedGetRequest(req) && !isMcp) {
    structuredLogger.info(`[auth] 302 ${req.method} ${req.path} redirect to login`);
    redirectBrowserToOidcLogin(res);
    return;
  }

  const loginUrlForJson = createOidcLoginUrlForApiResponse();

  structuredLogger.info(
    `[auth] 401 ${req.method} ${req.path}${isMcp ? ' (announcing auth need for MCP client)' : ''}`
  );
  setWwwAuthenticate(res);

  // Return a JSON-RPC 2.0 error envelope when the request is a JSON-RPC call to /mcp,
  // so MCP clients can parse a structured error instead of a generic 401 body.
  const body = req.body as Record<string, unknown> | undefined;
  const isJsonRpc = isMcp && body?.['jsonrpc'] === '2.0';
  if (isJsonRpc) {
    res.status(401).json(buildJsonRpcAuthError(body?.['id'], 'Authentication required', loginUrlForJson));
  } else {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required',
      login_url: loginUrlForJson
    });
  }
}

export { SESSION_COOKIE_NAME };
