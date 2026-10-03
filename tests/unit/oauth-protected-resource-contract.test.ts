// squadrules-compat-surface: references Keycloak realm/client or keyring service names (kairos-dev / kairos-prod / kairos-cli) provisioned in existing deployments
import { beforeAll, describe, expect, it } from '@jest/globals';

let buildProtectedResourceMetadata: () => Record<string, unknown>;
let buildAuthorizationServerMetadata: (upstream: Record<string, unknown>) => Record<string, unknown>;
let DEFAULT_OIDC_SCOPES_SUPPORTED: readonly string[];
let parseOidcScopesSupported: (raw: string | undefined) => readonly string[];

beforeAll(async () => {
    process.env['AUTH_CALLBACK_BASE_URL'] = 'http://localhost:3300';
    process.env['KEYCLOAK_URL'] = 'http://keycloak.local:8180';
    process.env['KEYCLOAK_INTERNAL_URL'] = 'http://keycloak:8080';
    process.env['KEYCLOAK_REALM'] = 'kairos-dev';
    process.env['KEYCLOAK_CLI_CLIENT_ID'] = 'kairos-cli';

    const mod = await import('../../src/http/http-well-known.js');
    const oidcScopes = await import('../../src/http/oidc-scopes.js');
    buildProtectedResourceMetadata = mod.buildProtectedResourceMetadata;
    buildAuthorizationServerMetadata = mod.buildAuthorizationServerMetadata;
    DEFAULT_OIDC_SCOPES_SUPPORTED = oidcScopes.DEFAULT_OIDC_SCOPES_SUPPORTED;
    parseOidcScopesSupported = oidcScopes.parseOidcScopesSupported;
});

// ---------------------------------------------------------------------------
// Bug: authorization_servers points to SQUADRULES app instead of Keycloak issuer.
// MCP clients fetch /.well-known/oauth-authorization-server from that server,
// which strips registration_endpoint → "does not support dynamic client registration".
// ---------------------------------------------------------------------------

describe('Protected Resource Metadata (buildProtectedResourceMetadata)', () => {
    it('authorization_servers must point to Keycloak issuer, not SQUADRULES app base', () => {
        const meta = buildProtectedResourceMetadata();
        const servers = meta['authorization_servers'] as string[];

        expect(servers).toHaveLength(1);
        // Must be the Keycloak realm issuer — NOT the SQUADRULES app base URL.
        expect(servers[0]).toBe('http://keycloak.local:8180/realms/kairos-dev');
        expect(servers[0]).not.toBe('http://localhost:3300');
    });

    it('token_endpoint issuer must match authorization_servers[0]', () => {
        const meta = buildProtectedResourceMetadata();
        const servers = meta['authorization_servers'] as string[];
        const tokenEndpoint = meta['token_endpoint'] as string;

        const issuerFromToken = tokenEndpoint.replace(/\/protocol\/openid-connect\/token$/, '');
        expect(servers[0]).toBe(issuerFromToken);
    });

    it('scopes_supported uses the default configured OIDC scopes', () => {
        const meta = buildProtectedResourceMetadata();
        expect(meta['scopes_supported']).toEqual(DEFAULT_OIDC_SCOPES_SUPPORTED);
    });
});

// ---------------------------------------------------------------------------
// Bug: buildAuthorizationServerMetadata strips registration_endpoint from
// Keycloak metadata. MCP hosts (e.g. Cursor streamable HTTP) require it for
// Dynamic Client Registration. Stripping causes the connection failure.
// ---------------------------------------------------------------------------

describe('Authorization Server Metadata (buildAuthorizationServerMetadata)', () => {
    const UPSTREAM_KEYCLOAK = {
        issuer: 'http://keycloak.local:8180/realms/kairos-dev',
        authorization_endpoint: 'http://keycloak.local:8180/realms/kairos-dev/protocol/openid-connect/auth',
        token_endpoint: 'http://keycloak.local:8180/realms/kairos-dev/protocol/openid-connect/token',
        registration_endpoint: 'http://keycloak.local:8180/realms/kairos-dev/clients-registrations/openid-connect',
        mtls_endpoint_aliases: {
            registration_endpoint: 'http://keycloak.local:8180/realms/kairos-dev/clients-registrations/openid-connect',
        },
    };

    it('must construct registration_endpoint from AUTH_CALLBACK_BASE_URL (local DCR proxy)', () => {
        const result = buildAuthorizationServerMetadata({ ...UPSTREAM_KEYCLOAK });
        // registration_endpoint is now served locally by the app, not proxied from Keycloak
        expect(result['registration_endpoint']).toBe(
            'http://localhost:3300/.well-known/clients-registrations/openid-connect'
        );
    });

    it('must rewrite internal Keycloak URLs back to the public issuer', () => {
        const result = buildAuthorizationServerMetadata({
            issuer: 'http://keycloak:8080/realms/kairos-dev',
            authorization_endpoint: 'http://keycloak:8080/realms/kairos-dev/protocol/openid-connect/auth',
            token_endpoint: 'http://keycloak:8080/realms/kairos-dev/protocol/openid-connect/token',
            registration_endpoint: 'http://keycloak:8080/realms/kairos-dev/clients-registrations/openid-connect',
            mtls_endpoint_aliases: {
                registration_endpoint: 'http://keycloak:8080/realms/kairos-dev/clients-registrations/openid-connect',
            },
        });

        expect(result['issuer']).toBe('http://keycloak.local:8180/realms/kairos-dev');
        expect(result['authorization_endpoint']).toBe(
            'http://keycloak.local:8180/realms/kairos-dev/protocol/openid-connect/auth'
        );
        expect(result['token_endpoint']).toBe(
            'http://keycloak.local:8180/realms/kairos-dev/protocol/openid-connect/token'
        );
        expect(result['registration_endpoint']).toBe(
            'http://localhost:3300/.well-known/clients-registrations/openid-connect'
        );
        expect((result['mtls_endpoint_aliases'] as Record<string, unknown>)['registration_endpoint']).toBe(
            'http://keycloak.local:8180/realms/kairos-dev/clients-registrations/openid-connect'
        );
    });

    it('must preserve registration_endpoint in mtls_endpoint_aliases', () => {
        const result = buildAuthorizationServerMetadata({ ...UPSTREAM_KEYCLOAK });
        const aliases = result['mtls_endpoint_aliases'] as Record<string, unknown>;
        expect(aliases['registration_endpoint']).toBe(
            UPSTREAM_KEYCLOAK.mtls_endpoint_aliases.registration_endpoint
        );
    });

    it('must set client_id_metadata_document_supported', () => {
        const result = buildAuthorizationServerMetadata({ ...UPSTREAM_KEYCLOAK });
        expect(result['client_id_metadata_document_supported']).toBe(true);
    });

    it('must pass through all other upstream fields unchanged', () => {
        const result = buildAuthorizationServerMetadata({ ...UPSTREAM_KEYCLOAK });
        expect(result['issuer']).toBe(UPSTREAM_KEYCLOAK.issuer);
        expect(result['authorization_endpoint']).toBe(UPSTREAM_KEYCLOAK.authorization_endpoint);
        expect(result['token_endpoint']).toBe(UPSTREAM_KEYCLOAK.token_endpoint);
    });
});

describe('OIDC scopes parser', () => {
    it('uses the default scopes when env is unset', () => {
        expect(parseOidcScopesSupported(undefined)).toEqual([
            'openid',
            'profile',
            'email',
            'kairos-groups',
            'offline_access',
        ]);
    });

    it('accepts env override with trimming and dedupe', () => {
        expect(parseOidcScopesSupported('openid, profile,offline_access,openid,kairos-groups')).toEqual([
            'openid',
            'profile',
            'offline_access',
            'kairos-groups',
        ]);
    });

    it('falls back to defaults when the env resolves to an empty list', () => {
        expect(parseOidcScopesSupported(' , , ')).toEqual(DEFAULT_OIDC_SCOPES_SUPPORTED);
    });
});
