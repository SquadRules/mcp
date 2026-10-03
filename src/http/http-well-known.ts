/**
 * OAuth 2.0 well-known metadata endpoints for MCP authorization discovery.
 *
 * Protected Resource Metadata (RFC 9728):
 *   GET /.well-known/oauth-protected-resource       (root - fallback)
 *   GET /.well-known/oauth-protected-resource/mcp   (path-specific - tried first by spec-compliant clients)
 *
 * Authorization Server Metadata (RFC 8414 proxy):
 *   GET /.well-known/oauth-authorization-server
 *
 *   Proxies Keycloak's realm OpenID configuration. registration_endpoint is preserved so
 *   MCP hosts that require Dynamic Client Registration (e.g. Cursor streamable HTTP) work.
 *   Adds client_id_metadata_document_supported: true (MCP spec 2025-11-25) so clients that
 *   support Client ID Metadata Documents can prefer them over DCR when applicable.
 *   Operators should constrain DCR in Keycloak realm settings if client sprawl is a concern.
 *
 * See: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
 */
import type { Express, Request, Response } from 'express';
import {
  AUTH_CALLBACK_BASE_URL,
  KEYCLOAK_URL,
  KEYCLOAK_INTERNAL_URL,
  KEYCLOAK_REALM,
  KEYCLOAK_CLI_CLIENT_ID,
  OIDC_SCOPES_SUPPORTED
} from '../config.js';
import { structuredLogger } from '../utils/structured-logger.js';
import { setupClientRegistrationProxy } from './http-client-registration-proxy.js';

export function buildProtectedResourceMetadata(): Record<string, unknown> {
  const base = AUTH_CALLBACK_BASE_URL.replace(/\/$/, '');
  const resource = `${base}/mcp`;
  const issuer = KEYCLOAK_URL
    ? `${KEYCLOAK_URL.replace(/\/$/, '')}/realms/${KEYCLOAK_REALM}`
    : '';

  const metadata: Record<string, unknown> = {
    resource,
    authorization_servers: issuer ? [issuer] : [],
    scopes_supported: OIDC_SCOPES_SUPPORTED,
    bearer_methods_supported: ['header'],
    resource_name: 'SquadRules MCP'
  };
  if (issuer) {
    metadata['authorization_endpoint'] = `${issuer}/protocol/openid-connect/auth`;
    metadata['token_endpoint'] = `${issuer}/protocol/openid-connect/token`;
  }
  metadata['authorization_request_parameters'] = { prompt: 'login' };
  if (KEYCLOAK_CLI_CLIENT_ID) {
    // Dual emission: retain the older field for existing clients, add new alias
    // for SquadRules-aware clients. Both carry the same value.
    metadata['squadrules_cli_client_id'] = KEYCLOAK_CLI_CLIENT_ID;
    metadata['squadrules_cli_client_id'] = KEYCLOAK_CLI_CLIENT_ID;
  }
  return metadata;
}

export function setupWellKnown(app: Express): void {
  if (!AUTH_CALLBACK_BASE_URL) {
    structuredLogger.warn(
      '[well-known] AUTH_CALLBACK_BASE_URL is empty — Protected Resource Metadata will use relative URIs (non-compliant with RFC 9728). Set AUTH_CALLBACK_BASE_URL for production.'
    );
  }

  const handler = (req: Request, res: Response) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.json(buildProtectedResourceMetadata());
  };

  const optionsHandler = (req: Request, res: Response) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).end();
  };

  app.get('/.well-known/oauth-protected-resource', handler);
  app.get('/.well-known/oauth-protected-resource/mcp', handler);
  app.options('/.well-known/oauth-protected-resource', optionsHandler);
  app.options('/.well-known/oauth-protected-resource/mcp', optionsHandler);

  setupClientRegistrationProxy(app);

  setupAuthorizationServerMetadata(app);
}

// ---------------------------------------------------------------------------
// Authorization Server Metadata proxy (RFC 8414)
// ---------------------------------------------------------------------------

/** Cache upstream metadata to avoid per-request round-trips. */
let authServerMetadataCache: { data: Record<string, unknown>; expiresAt: number } | null = null;
const AUTH_SERVER_METADATA_CACHE_SEC = 300; // 5 min

/**
 * Resolve the Keycloak base URL for server-side fetches (Docker: use internal URL).
 * Same logic as bearer-validate.ts resolveOidcIssuerBaseForServerFetch.
 */
function keycloakFetchBase(): string {
  const external = KEYCLOAK_URL ? KEYCLOAK_URL.replace(/\/$/, '') : '';
  if (KEYCLOAK_INTERNAL_URL && external) {
    return KEYCLOAK_INTERNAL_URL.replace(/\/$/, '');
  }
  return external;
}

function rewriteInternalKeycloakUrls<T>(value: T): T {
  const external = KEYCLOAK_URL ? KEYCLOAK_URL.replace(/\/$/, '') : '';
  const internal = KEYCLOAK_INTERNAL_URL ? KEYCLOAK_INTERNAL_URL.replace(/\/$/, '') : '';
  if (!external || !internal || external === internal) {
    return value;
  }

  if (typeof value === 'string') {
    if (value === internal || value.startsWith(`${internal}/`)) {
      return `${external}${value.slice(internal.length)}` as T;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => rewriteInternalKeycloakUrls(entry)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, rewriteInternalKeycloakUrls(entry)])
    ) as T;
  }

  return value;
}

async function fetchUpstreamAuthServerMetadata(): Promise<Record<string, unknown> | null> {
  const now = Date.now();
  if (authServerMetadataCache && now < authServerMetadataCache.expiresAt) {
    return authServerMetadataCache.data;
  }

  const base = keycloakFetchBase();
  if (!base) return null;

  const url = `${base}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration`;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      structuredLogger.warn(`[well-known] upstream auth server metadata HTTP ${res.status} url=${url}`);
      return null;
    }
    const data = (await res.json()) as Record<string, unknown>;
    authServerMetadataCache = { data, expiresAt: now + AUTH_SERVER_METADATA_CACHE_SEC * 1000 };
    return data;
  } catch (err) {
    structuredLogger.warn(
      `[well-known] upstream auth server metadata fetch failed url=${url} err=${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

export function buildAuthorizationServerMetadata(upstream: Record<string, unknown>): Record<string, unknown> {
  const metadata = rewriteInternalKeycloakUrls({ ...upstream });

  // Preserve registration_endpoint from Keycloak — MCP hosts (e.g. Cursor streamable HTTP)
  // require it for Dynamic Client Registration. Stripping it causes:
  //   "Incompatible auth server: does not support dynamic client registration"
  // Operators should constrain DCR in Keycloak realm settings if client sprawl is a concern.

  metadata['client_id_metadata_document_supported'] = true;
  const base = AUTH_CALLBACK_BASE_URL?.trim().replace(/\/$/, '');
  metadata['registration_endpoint'] = base
    ? `${base}/.well-known/clients-registrations/openid-connect`
    : '/.well-known/clients-registrations/openid-connect';

  return metadata;
}

function setupAuthorizationServerMetadata(app: Express): void {
  const handler = async (req: Request, res: Response) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    const upstream = await fetchUpstreamAuthServerMetadata();
    // When no upstream auth server is configured (e.g. SIMPLE mode without Keycloak),
    // return a minimal static metadata document instead of 502 so that clients that
    // probe /.well-known/openid-configuration for DCR support still receive a valid
    // 200 response with the local registration_endpoint.
    res.json(buildAuthorizationServerMetadata(upstream ?? {}));
  };

  const optionsHandler = (req: Request, res: Response) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).end();
  };

  app.get('/.well-known/oauth-authorization-server', handler);
  app.options('/.well-known/oauth-authorization-server', optionsHandler);

  app.get('/.well-known/openid-configuration', handler);
  app.options('/.well-known/openid-configuration', optionsHandler);
}
