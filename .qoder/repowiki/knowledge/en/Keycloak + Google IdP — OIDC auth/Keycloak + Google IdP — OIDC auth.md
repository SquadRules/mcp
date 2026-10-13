---
kind: external_dependency
name: Keycloak + Google IdP — OIDC auth
slug: keycloak-google-idp
category: external_dependency
category_hints:
    - auth_protocol
scope:
    - '**'
---

### Keycloak + Google IdP
- Role: Identity provider chain for the HTTP server; Keycloak is the RP-facing OIDC provider backed by Google as an upstream IdP.
- Integration points: `src/http/http-auth-oidc-redirect.ts`, `src/http/http-auth-callback.ts`, `src/http/http-auth-middleware.ts`, `src/http/http-client-registration-proxy.ts`, `src/http/oidc-profile-claims.ts`, `src/http/oidc-scopes.ts`.
- Auth protocol: standard OpenID Connect (authorization-code flow with client registration proxy); secrets (client id/secret, issuer URL) are injected at boot via the config system.
- Setup reference: `docs/keycloak/` (referenced from `docs/README.md`); verify exact OIDC scopes and claim mapping against the Keycloak realm configuration.