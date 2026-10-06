# Appendix: Google sign-in for Keycloak (dev)

**Not part of `docs/install/`.** For operators who already run Keycloak (or an
equivalent IdP) **at their own discretion**. SquadRules talks to Keycloak for OIDC;
below adds Google as a broker in the **`squadrules`** realm. Layout and ports:
[Infrastructure (project Wiki)](https://github.com/SquadRules/mcp/wiki).

## Prerequisites

- Keycloak reachable and **`squadrules`** (or your target realm) under your control
- Local dev stack running (`npm run infra:up` — brings up Qdrant, Valkey,
  Postgres, Keycloak via `compose/infra.yaml`), or your own deployment
- Admin access to the local Keycloak realm
- A Google OAuth client created in Google Cloud

## 1. Create the Google OAuth client

In Google Cloud Console, create an **OAuth client ID** of type
**Web application** and add this redirect URI exactly:

```text
http://localhost:8080/realms/squadrules/broker/google/endpoint
```

Copy the resulting client ID and client secret.

## 2. Put the Google credentials in `.env`

Add these values to the **`.env`** next to your **`compose/infra.yaml`** for the full-stack setup:

```ini
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

You also need the usual Keycloak-related values such as
`KEYCLOAK_ADMIN_PASSWORD`.

## 3. Start infra and configure the IdP

Start the full local auth stack and configure realms:

```bash
npm run infra:up
```

In **Keycloak Admin Console** (realm **squadrules**): **Identity providers** → **Google** (or **OpenID Connect v1.0**). Set **Client ID** and **Client secret** from your Google OAuth client (same values as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env`). Save. Confirm the Google redirect URI in Google Cloud still matches **§1** above.

Use [Keycloak identity broker](https://www.keycloak.org/docs/latest/server_admin/#_identity_broker) if you need provider-specific options.

## 4. Verify the login flow

Start or restart the app if needed, then open a browser login flow that uses
the `squadrules-mcp` client. For the default local callback base:

```text
http://localhost:8080/realms/squadrules/protocol/openid-connect/auth?client_id=squadrules-mcp&redirect_uri=http%3A%2F%2Flocalhost%3A3300%2Fauth%2Fcallback&response_type=code&scope=openid
```

If your local setup uses a different `AUTH_CALLBACK_BASE_URL`, replace the
encoded `redirect_uri` accordingly.

Expected result:

1. Keycloak shows a **Google** login option.
2. After successful Google authentication, Keycloak redirects back to the
   SquadRules callback.
3. The server sets the session cookie and redirects to `/ui/`.

## Troubleshooting

### `invalid_client` or `The OAuth client was not found`

This usually means the Google OAuth client was created incorrectly or the
redirect URI does not match exactly. Re-check the Google Cloud OAuth client and
make sure it includes:

```text
http://localhost:8080/realms/squadrules/broker/google/endpoint
```

### Keycloak does not show the Google button

Re-check the IdP in **Identity providers** (enabled, correct client ID/secret). Also verify that:

- `GOOGLE_CLIENT_ID` is set
- `GOOGLE_CLIENT_SECRET` is set
- `KEYCLOAK_ADMIN_PASSWORD` matches the local Keycloak bootstrap admin password

### The app redirects somewhere unexpected

Check:

- `AUTH_CALLBACK_BASE_URL`
- `KEYCLOAK_URL`
- whether the app is running on the host (`http://localhost:3300`) or in
  Docker with a different externally reachable URL
