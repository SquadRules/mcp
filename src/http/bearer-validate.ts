/**
 * Bearer JWT validation for OIDC (Keycloak). Verifies iss, aud, exp and signature via JWKS.
 * When KEYCLOAK_INTERNAL_URL is set, JWKS is fetched from that host so the app in Docker can reach Keycloak.
 */
import { createRemoteJWKSet, jwtVerify } from "jose";
import { decodeJwt } from "jose/jwt/decode";
import {
  KEYCLOAK_URL,
  KEYCLOAK_INTERNAL_URL,
  OIDC_BEARER_MERGE_USERINFO_GROUPS,
  OIDC_GROUPS_ALLOWLIST
} from "../config.js";
import { structuredLogger } from "../utils/structured-logger.js";
import {
  applyOidcGroupsAllowlist,
  enrichAuthPayloadFromVerifiedJwt,
  extractGroupsFromPayload,
  realmFromIssuer,
  type AccountKind
} from "./oidc-profile-claims.js";

export interface AuthPayload {
  sub: string;
  groups: string[];
  /** Raw issuer retained for deterministic space-id derivation across Keycloak hosts. */
  iss: string;
  /** Realm from token issuer (e.g. the deployment realm) for space isolation. */
  realm: string;
  preferred_username?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  email_verified?: boolean;
  identity_provider?: string;
  /** Set when profile claims allow derivation; omitted on older session cookies until re-login. */
  account_kind?: AccountKind;
  account_label?: string;
}

const JWKS_CACHE = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/**
 * Issuer URL base for server-side HTTP to Keycloak (JWKS, userinfo).
 * When KEYCLOAK_INTERNAL_URL is set and the token issuer matches KEYCLOAK_URL, use internal host
 * so Docker can reach Keycloak.
 */
function resolveOidcIssuerBaseForServerFetch(issuer: string): string {
  const base = issuer.replace(/\/$/, "");
  if (KEYCLOAK_INTERNAL_URL && KEYCLOAK_URL && base.startsWith(KEYCLOAK_URL.replace(/\/$/, ""))) {
    const internalBase = KEYCLOAK_INTERNAL_URL.replace(/\/$/, "");
    return `${internalBase}${new URL(base).pathname}`;
  }
  return base;
}

function getJwksFetchUrl(issuer: string): string {
  return `${resolveOidcIssuerBaseForServerFetch(issuer)}/protocol/openid-connect/certs`;
}

function getOidcUserinfoUrl(issuer: string): string {
  return `${resolveOidcIssuerBaseForServerFetch(issuer)}/protocol/openid-connect/userinfo`;
}

/**
 * When the access JWT has no `groups` claim (common if Group Membership is mapped to ID token / userinfo only),
 * fetch groups from OIDC Userinfo using the same Bearer token. Aligns MCP Bearer auth with browser sessions
 * that merge id_token groups in the OAuth callback.
 */
async function fetchGroupsFromOidcUserinfo(issuer: string, accessToken: string): Promise<string[]> {
  const url = getOidcUserinfoUrl(issuer);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) {
      structuredLogger.debug(`[auth] userinfo groups: HTTP ${res.status} url=${url}`);
      return [];
    }
    const body = (await res.json()) as Record<string, unknown>;
    const groups = extractGroupsFromPayload(body);
    if (groups.length === 0) {
      structuredLogger.info(
        `[auth] userinfo returned no groups — the issuing client likely lacks a Group Membership protocol mapper. ` +
        `Add the mapper to the realm's default client scope or the specific client to enable group spaces for DCR/MCP tokens.`
      );
    }
    return groups;
  } catch (err) {
    structuredLogger.debug(
      `[auth] userinfo groups: fetch failed url=${url} err=${err instanceof Error ? err.message : String(err)}`
    );
    return [];
  }
}

function getJwksForIssuer(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  const cached = JWKS_CACHE.get(issuer);
  if (cached) return cached;
  const url = getJwksFetchUrl(issuer);
  const jwks = createRemoteJWKSet(new URL(url));
  JWKS_CACHE.set(issuer, jwks);
  return jwks;
}

/** Decode JWT payload without verification (issuer check only). */
function decodePayload(jwt: string): Record<string, unknown> {
  return decodeJwt(jwt) as Record<string, unknown>;
}

/**
 * Validate Bearer JWT: iss in trusted list, aud in allowed list, exp not expired, signature valid.
 * Returns auth payload or null if invalid.
 */
export async function validateBearerToken(
  token: string,
  trustedIssuers: string[],
  allowedAudiences: string[]
): Promise<AuthPayload | null> {
  if (!token || trustedIssuers.length === 0 || allowedAudiences.length === 0) return null;
  let payload: Record<string, unknown>;
  try {
    const unverified = decodePayload(token);
    if (process.env["AUTH_TRACE"] === "true" || process.env["LOG_LEVEL"] === "trace") {
      structuredLogger.info(`[auth] TRACE Bearer unverified payload raw=${JSON.stringify(unverified)}`);
    }
    const iss = typeof unverified["iss"] === "string" ? unverified["iss"] : undefined;
    if (!iss || !trustedIssuers.includes(iss)) {
      structuredLogger.info(
        `[auth] Bearer rejected: issuer not trusted token_iss=${iss ?? "missing"} trusted=${JSON.stringify(trustedIssuers)}`
      );
      return null;
    }
    const jwks = getJwksForIssuer(iss);
    const getKey = (protectedHeader: Parameters<ReturnType<typeof createRemoteJWKSet>>[0]) => jwks(protectedHeader);
    const { payload: p } = await jwtVerify(token, getKey, { issuer: iss });
    payload = p as Record<string, unknown>;
    if (process.env["AUTH_TRACE"] === "true" || process.env["LOG_LEVEL"] === "trace") {
      structuredLogger.info(`[auth] TRACE Bearer payload raw=${JSON.stringify(payload)}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    structuredLogger.info(`[auth] Bearer rejected: JWT verify failed err=${msg}`);
    return null;
  }
  const aud = payload["aud"];
  const audList = Array.isArray(aud) ? aud : typeof aud === "string" ? [aud] : [];
  const issForAud = typeof payload["iss"] === "string" ? payload["iss"] : "";
  // Keycloak: accept aud "account", or empty aud when issuer is a Keycloak realm (some tokens omit aud).
  const keycloakAccountAud = audList.includes("account") && issForAud.includes("/realms/");
  const keycloakEmptyAud = audList.length === 0 && issForAud.includes("/realms/");
  const hasAudience =
    allowedAudiences.some((a) => audList.includes(a)) || keycloakAccountAud || keycloakEmptyAud;
  if (!hasAudience) {
    structuredLogger.info(
      `[auth] Bearer rejected: audience not allowed token_aud=${JSON.stringify(audList)} allowed=${JSON.stringify(allowedAudiences)}`
    );
    return null;
  }
  const sub = typeof payload["sub"] === "string" ? payload["sub"] : "";
  if (!sub) return null;
  const iss = typeof payload["iss"] === "string" ? payload["iss"] : "";
  if (!iss) return null;
  const realm = realmFromIssuer(iss);
  const groupsFromAccess = extractGroupsFromPayload(payload);
  let groups = groupsFromAccess;
  if (groupsFromAccess.length === 0) {
    const nestedIdToken = payload["id_token"];
    if (typeof nestedIdToken === "string" && nestedIdToken.length > 0) {
      try {
        groups = extractGroupsFromPayload(decodePayload(nestedIdToken));
      } catch {
        // Ignore malformed nested id_token and keep empty groups.
      }
    }
  }
  if (groups.length === 0) {
    groups = await fetchGroupsFromOidcUserinfo(iss, token);
  } else if (OIDC_BEARER_MERGE_USERINFO_GROUPS) {
    const fromUserinfo = await fetchGroupsFromOidcUserinfo(iss, token);
    if (fromUserinfo.length > 0) {
      groups = [...new Set([...groups, ...fromUserinfo])];
    }
  }
  groups = applyOidcGroupsAllowlist(groups, OIDC_GROUPS_ALLOWLIST);
  const enrich = enrichAuthPayloadFromVerifiedJwt(payload);
  const result: AuthPayload = {
    sub,
    groups,
    iss,
    realm,
    account_kind: enrich.account_kind,
    account_label: enrich.account_label,
  };
  if (enrich.preferred_username !== undefined) result.preferred_username = enrich.preferred_username;
  if (enrich.name !== undefined) result.name = enrich.name;
  if (enrich.given_name !== undefined) result.given_name = enrich.given_name;
  if (enrich.family_name !== undefined) result.family_name = enrich.family_name;
  if (enrich.email !== undefined) result.email = enrich.email;
  if (enrich.email_verified !== undefined) result.email_verified = enrich.email_verified;
  if (enrich.identity_provider !== undefined) result.identity_provider = enrich.identity_provider;
  return result;
}
