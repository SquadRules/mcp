/**
 * Whitelisted OIDC claims for session, Bearer auth, and GET /api/me.
 * Do not echo full JWTs — only explicitly allowed keys reduce risk of leaking future custom claims.
 *
 * If identity_provider is missing for broker/SSO users, add a Keycloak protocol mapper
 * (e.g. user session note → token claim) in the realm — that is realm configuration, not only app code.
 */
import { fromBase64url } from "@exodus/bytes/base64.js";
import { utf8toString } from "@exodus/bytes/utf8.js";

export type AccountKind = "local" | "sso";

/** IdPs treated as realm-local (not federated SSO) for UX labelling. */
const LOCAL_IDENTITY_PROVIDERS = new Set(["", "keycloak", "local"]);

const SSO_LABEL_OVERRIDES: Record<string, string> = {
  google: "Google",
  okta: "Okta",
  github: "GitHub",
  microsoft: "Microsoft",
  azuread: "Microsoft",
};

export interface WhitelistedProfileFields {
  preferred_username?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  email_verified?: boolean;
  identity_provider?: string;
}

export interface AccountLabels {
  account_kind: AccountKind;
  account_label: string;
}

export interface MergedCallbackClaims {
  sub: string;
  groups: string[];
  /** Raw token issuer used for deterministic space-id derivation. */
  iss: string;
  realm: string;
  preferred_username?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  email_verified?: boolean;
  identity_provider?: string;
  account_kind: AccountKind;
  account_label: string;
}

/** Decode JWT payload object from compact serialization (same pattern as auth callback; not a signature verify). */
export function decodeJwtPayloadSegment(jwt: string): Record<string, unknown> | null {
  try {
    const segment = jwt.split(".")[1];
    if (!segment) return null;
    return JSON.parse(utf8toString(fromBase64url(segment))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Extract realm segment from issuer URL (e.g. …/realms/squadrules-dev → squadrules-dev). */
export function realmFromIssuer(iss: string): string {
  const match = /\/realms\/([^/]+)/.exec(iss);
  const segment = match?.[1] ?? iss.split("/").filter(Boolean).pop();
  return typeof segment === "string" ? segment : "default";
}

/**
 * Normalize Keycloak / OIDC `groups` into string paths. Handles array, single path string,
 * or JSON array string (some gateways serialize oddly).
 */
export function extractGroupsFromPayload(payload: Record<string, unknown>): string[] {
  const g = payload["groups"];
  if (Array.isArray(g)) return g.filter((x): x is string => typeof x === "string");
  if (typeof g === "string") {
    const t = g.trim();
    if (!t) return [];
    if (t.startsWith("[")) {
      try {
        const parsed = JSON.parse(t) as unknown;
        if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
      } catch {
        return [t];
      }
    }
    return [t];
  }
  return [];
}

function groupStringVariants(g: string): string[] {
  const t = g.trim();
  if (!t) return [];
  return [t, t.replace(/^\//, ""), t.startsWith("/") ? t : `/${t}`];
}

/** Path form with a single leading slash (for prefix checks on full-path groups). */
function groupPathForm(g: string): string {
  const t = g.trim();
  if (!t) return "";
  return t.startsWith("/") ? t : `/${t.replace(/^\//, "")}`;
}

/**
 * Keep only token groups that match an allowlist entry:
 * - **Exact:** plain name or path (`squadrules-auditor`, `/squadrules-auditor`) — slash optional on either side.
 * - **Prefix:** entry ends with `/` (e.g. `/squadrules-shares/`) — keep any JWT group whose path form starts with that prefix (after normalizing a leading slash on the entry).
 * - **Default (no filter):** empty allowlist keeps **all** JWT groups (same membership the IdP issued).
 *   Set a non-empty allowlist to restrict which paths become SQUADRULES spaces.
 * Keycloak's Group Membership mapper lists every group the user belongs to; use this on SQUADRULES
 * to restrict which entries become session/API groups when you configure an allowlist.
 */
export function applyOidcGroupsAllowlist(groups: string[], allowlist: readonly string[]): string[] {
  if (allowlist.length === 0) return [...groups];
  const exact = new Set<string>();
  const exactLower = new Set<string>();
  const prefixes: string[] = [];
  const prefixLower: string[] = [];
  for (const e of allowlist) {
    const t = e.trim();
    if (!t) continue;
    if (t.endsWith("/")) {
      const p = t.startsWith("/") ? t : `/${t}`;
      prefixes.push(p);
      prefixLower.push(p.toLowerCase());
      continue;
    }
    for (const v of groupStringVariants(t)) {
      exact.add(v);
      exactLower.add(v.toLowerCase());
    }
  }
  return groups.filter((g) => {
    const variants = groupStringVariants(g);
    if (variants.length === 0) return false;
    if (variants.some((v) => exact.has(v) || exactLower.has(v.toLowerCase()))) return true;
    const pathForm = groupPathForm(g);
    if (!pathForm) return false;
    const pathLower = pathForm.toLowerCase();
    for (let i = 0; i < prefixes.length; i++) {
      const p = prefixes[i]!;
      const pl = prefixLower[i]!;
      if (pathForm.startsWith(p) || pathLower.startsWith(pl)) return true;
    }
    return false;
  });
}

function pickNonEmptyString(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Whitelisted profile-style claims from a single verified (or callback-trusted) payload.
 */
export function extractWhitelistedProfileFromPayload(payload: Record<string, unknown>): WhitelistedProfileFields {
  const out: WhitelistedProfileFields = {};
  const pu = pickNonEmptyString(payload, "preferred_username");
  if (pu !== undefined) out.preferred_username = pu;
  const name = pickNonEmptyString(payload, "name");
  if (name !== undefined) out.name = name;
  const gn = pickNonEmptyString(payload, "given_name");
  if (gn !== undefined) out.given_name = gn;
  const fn = pickNonEmptyString(payload, "family_name");
  if (fn !== undefined) out.family_name = fn;
  const email = pickNonEmptyString(payload, "email");
  if (email !== undefined) out.email = email;
  const ev = payload["email_verified"];
  if (ev === true || ev === false) out.email_verified = ev;
  const idp = pickNonEmptyString(payload, "identity_provider");
  if (idp !== undefined) out.identity_provider = idp;
  return out;
}

export function deriveAccountKindAndLabel(identityProvider: string | undefined): AccountLabels {
  const raw = typeof identityProvider === "string" ? identityProvider.trim() : "";
  const lower = raw.toLowerCase();
  if (!raw || LOCAL_IDENTITY_PROVIDERS.has(lower)) {
    return { account_kind: "local", account_label: "Local" };
  }
  const base = SSO_LABEL_OVERRIDES[lower] ?? raw.charAt(0).toUpperCase() + raw.slice(1);
  return { account_kind: "sso", account_label: `${base} (SSO)` };
}

/**
 * Merge id_token and access_token payloads after login:
 * — sub from id token when present; otherwise access. If both subs exist and differ, fail.
 * — groups prefer access token; fallback to id.
 * — iss from id token when present; otherwise access; fallback to synthetic realm issuer.
 * — realm from id token iss, else access iss, else fallbackRealm.
 * — profile / email claims prefer id token; if id absent, fall back to access for CLI-style flows.
 */
export function mergeCallbackTokenPayloads(input: {
  idPayload: Record<string, unknown> | null;
  accessPayload: Record<string, unknown> | null;
  fallbackRealm: string;
}): { ok: true; merged: MergedCallbackClaims } | { ok: false; error: string } {
  const { idPayload, accessPayload, fallbackRealm } = input;
  const idSub = idPayload && typeof idPayload["sub"] === "string" ? idPayload["sub"] : "";
  const accessSub = accessPayload && typeof accessPayload["sub"] === "string" ? accessPayload["sub"] : "";
  let sub: string;
  if (idSub.length > 0) {
    sub = idSub;
    if (accessSub.length > 0 && accessSub !== idSub) {
      return { ok: false, error: "mismatched_sub" };
    }
  } else if (accessSub.length > 0) {
    sub = accessSub;
  } else {
    return { ok: false, error: "missing_sub" };
  }

  const accessGroups = accessPayload ? extractGroupsFromPayload(accessPayload) : [];
  const idGroups = idPayload ? extractGroupsFromPayload(idPayload) : [];
  const groups = accessGroups.length > 0 ? accessGroups : idGroups;

  let realm = fallbackRealm;
  const idIss = idPayload && typeof idPayload["iss"] === "string" ? idPayload["iss"] : "";
  const accessIss = accessPayload && typeof accessPayload["iss"] === "string" ? accessPayload["iss"] : "";
  const iss = idIss.length > 0 ? idIss : accessIss.length > 0 ? accessIss : `realm:${fallbackRealm}`;
  if (idIss.length > 0) realm = realmFromIssuer(idIss);
  else if (accessIss.length > 0) realm = realmFromIssuer(accessIss);

  const profileFromId = idPayload ? extractWhitelistedProfileFromPayload(idPayload) : {};
  const profileFromAccess = accessPayload ? extractWhitelistedProfileFromPayload(accessPayload) : {};
  const profile =
    Object.keys(profileFromId).length > 0
      ? profileFromId
      : profileFromAccess;

  const { account_kind, account_label } = deriveAccountKindAndLabel(profile.identity_provider);

  const merged: MergedCallbackClaims = {
    sub,
    groups,
    iss,
    realm,
    account_kind,
    account_label,
  };
  if (profile.preferred_username !== undefined) merged.preferred_username = profile.preferred_username;
  if (profile.name !== undefined) merged.name = profile.name;
  if (profile.given_name !== undefined) merged.given_name = profile.given_name;
  if (profile.family_name !== undefined) merged.family_name = profile.family_name;
  if (profile.email !== undefined) merged.email = profile.email;
  if (profile.email_verified !== undefined) merged.email_verified = profile.email_verified;
  if (profile.identity_provider !== undefined) merged.identity_provider = profile.identity_provider;
  return { ok: true, merged };
}

export type AuthProfileEnrichment = Pick<
  MergedCallbackClaims,
  | "preferred_username"
  | "name"
  | "given_name"
  | "family_name"
  | "email"
  | "email_verified"
  | "identity_provider"
  | "account_kind"
  | "account_label"
>;

/** Attach profile + account labels to auth after Bearer verify (single token payload). */
export function enrichAuthPayloadFromVerifiedJwt(payload: Record<string, unknown>): AuthProfileEnrichment {
  const profile = extractWhitelistedProfileFromPayload(payload);
  const { account_kind, account_label } = deriveAccountKindAndLabel(profile.identity_provider);
  const out: AuthProfileEnrichment = {
    account_kind,
    account_label,
  };
  if (profile.preferred_username !== undefined) out.preferred_username = profile.preferred_username;
  if (profile.name !== undefined) out.name = profile.name;
  if (profile.given_name !== undefined) out.given_name = profile.given_name;
  if (profile.family_name !== undefined) out.family_name = profile.family_name;
  if (profile.email !== undefined) out.email = profile.email;
  if (profile.email_verified !== undefined) out.email_verified = profile.email_verified;
  if (profile.identity_provider !== undefined) out.identity_provider = profile.identity_provider;
  return out;
}
