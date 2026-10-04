import { describe, expect, test } from "@jest/globals";
import {
  applyOidcGroupsAllowlist,
  deriveAccountKindAndLabel,
  extractGroupsFromPayload,
  extractWhitelistedProfileFromPayload,
  mergeCallbackTokenPayloads,
} from "../../src/http/oidc-profile-claims.js";

describe("oidc-profile-claims", () => {
  test("extractWhitelistedProfileFromPayload picks only allowed string and boolean claims", () => {
    const raw = {
      sub: "x",
      name: "N",
      email: "e@x",
      email_verified: true,
      preferred_username: "u",
      given_name: "G",
      family_name: "F",
      identity_provider: "google",
      admin: true,
      custom_secret: "nope",
    };
    const out = extractWhitelistedProfileFromPayload(raw);
    expect(out).toEqual({
      name: "N",
      email: "e@x",
      email_verified: true,
      preferred_username: "u",
      given_name: "G",
      family_name: "F",
      identity_provider: "google",
    });
    expect(out).not.toHaveProperty("sub");
  });

  test("deriveAccountKindAndLabel treats missing and keycloak as local", () => {
    expect(deriveAccountKindAndLabel(undefined)).toEqual({ account_kind: "local", account_label: "Local" });
    expect(deriveAccountKindAndLabel("")).toEqual({ account_kind: "local", account_label: "Local" });
    expect(deriveAccountKindAndLabel("keycloak")).toEqual({ account_kind: "local", account_label: "Local" });
  });

  test("deriveAccountKindAndLabel maps known IdPs to SSO labels", () => {
    expect(deriveAccountKindAndLabel("google")).toEqual({ account_kind: "sso", account_label: "Google (SSO)" });
    expect(deriveAccountKindAndLabel("okta")).toEqual({ account_kind: "sso", account_label: "Okta (SSO)" });
  });

  test("mergeCallbackTokenPayloads uses sub from id token and merges groups from access", () => {
    const idPayload = { sub: "same", iss: "http://k/realms/r1", name: "IdP Name", email: "id@x" };
    const accessPayload = {
      sub: "same",
      iss: "http://k/realms/r1",
      groups: ["group-a", "group-b"],
    };
    const r = mergeCallbackTokenPayloads({
      idPayload,
      accessPayload,
      fallbackRealm: "fallback",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.merged.sub).toBe("same");
    expect(r.merged.groups).toEqual(["group-a", "group-b"]);
    expect(r.merged.name).toBe("IdP Name");
    expect(r.merged.email).toBe("id@x");
    expect(r.merged.realm).toBe("r1");
  });

  test("mergeCallbackTokenPayloads rejects mismatched subs", () => {
    const r = mergeCallbackTokenPayloads({
      idPayload: { sub: "a" },
      accessPayload: { sub: "b", groups: ["g"] },
      fallbackRealm: "x",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("mismatched_sub");
  });

  test("mergeCallbackTokenPayloads falls back to id token groups when access has none", () => {
    const r = mergeCallbackTokenPayloads({
      idPayload: { sub: "u", groups: ["from-id"] },
      accessPayload: { sub: "u" },
      fallbackRealm: "fr",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.merged.groups).toEqual(["from-id"]);
  });

  test("mergeCallbackTokenPayloads uses access-only sub when no id token", () => {
    const r = mergeCallbackTokenPayloads({
      idPayload: null,
      accessPayload: { sub: "acc-only", groups: ["r"] },
      fallbackRealm: "fr",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.merged.sub).toBe("acc-only");
    expect(r.merged.groups).toEqual(["r"]);
  });

  test("applyOidcGroupsAllowlist with empty allowlist passes through all groups", () => {
    expect(applyOidcGroupsAllowlist(["a", "b"], [])).toEqual(["a", "b"]);
  });

  test("applyOidcGroupsAllowlist intersects with names and slash paths", () => {
    expect(applyOidcGroupsAllowlist(["/squadrules-auditor", "other"], ["squadrules-auditor"])).toEqual([
      "/squadrules-auditor",
    ]);
    expect(applyOidcGroupsAllowlist(["squadrules-auditor"], ["/squadrules-auditor"])).toEqual(["squadrules-auditor"]);
    expect(applyOidcGroupsAllowlist(["squadrules-auditor", "x"], ["squadrules-auditor", "y"])).toEqual([
      "squadrules-auditor",
    ]);
  });

  test("applyOidcGroupsAllowlist prefix entries match path prefixes", () => {
    expect(
      applyOidcGroupsAllowlist(
        ["/squadrules-auditor", "/squadrules-shares/squadrules-operator", "/other/root"],
        ["/squadrules-shares/"]
      )
    ).toEqual(["/squadrules-shares/squadrules-operator"]);
    expect(
      applyOidcGroupsAllowlist(["/squadrules-shares/squadrules-operator"], ["squadrules-shares/"])
    ).toEqual(["/squadrules-shares/squadrules-operator"]);
    expect(applyOidcGroupsAllowlist(["/squadrules-shares"], ["/squadrules-shares/"])).toEqual([]);
  });

  test("applyOidcGroupsAllowlist matches group paths case-insensitively against allowlist prefix", () => {
    expect(applyOidcGroupsAllowlist(["/SHARED/PE-TEAM"], ["/shared/"])).toEqual(["/SHARED/PE-TEAM"]);
  });

  test("applyOidcGroupsAllowlist matches exact entries case-insensitively", () => {
    expect(applyOidcGroupsAllowlist(["/Squadrules-Auditor"], ["squadrules-auditor"])).toEqual(["/Squadrules-Auditor"]);
  });

  test("extractGroupsFromPayload accepts string and JSON array string", () => {
    expect(extractGroupsFromPayload({ groups: ["/a", "/b"] })).toEqual(["/a", "/b"]);
    expect(extractGroupsFromPayload({ groups: "/shared/pe-team" })).toEqual(["/shared/pe-team"]);
    expect(extractGroupsFromPayload({ groups: '["/x","/y"]' })).toEqual(["/x", "/y"]);
    expect(extractGroupsFromPayload({ groups: "" })).toEqual([]);
  });

  test("mergeCallbackTokenPayloads does not map realm_access roles into groups", () => {
    const r = mergeCallbackTokenPayloads({
      idPayload: null,
      accessPayload: { sub: "acc-only", realm_access: { roles: ["offline_access"] } },
      fallbackRealm: "fr",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.merged.groups).toEqual([]);
  });
});
