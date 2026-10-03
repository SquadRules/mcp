// squadrules-compat-surface: references Keycloak realm identities/groups (kairos-tester / kairos-auditor / kairos-groups / kairos-shares) provisioned in existing deployments
/**
 * MCP Client Connection Utilities for Integration Tests
 * Provides reusable connection setup and teardown functions.
 * When AUTH_ENABLED=true, globalSetup creates the test user and token; we send it so all tests use auth.
 * When TRANSPORT_TYPE=stdio, connections use a shared stdio subprocess instead of HTTP.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  getMcpTestBearerToken,
  getTestAuthBaseUrl,
  refreshTestAuthToken,
  serverRequiresAuth
} from './auth-headers.js';

/** True when the test runner should use stdio transport (dev_stdio profile). */
function isStdioTransport(): boolean {
  return process.env.TRANSPORT_TYPE === 'stdio';
}

// ── HTTP transport setup ────────────────────────────────────────────────────

/** Base URL of the app (same server for MCP and health). From MCP_URL env or getTestAuthBaseUrl() (e.g. .test-auth-env.json when auth server runs). */
const BASE_URL = process.env.MCP_URL
  ? process.env.MCP_URL.replace(/\/mcp\/?$/, '').replace(/\/$/, '')
  : getTestAuthBaseUrl().replace(/\/$/, '');
const MCP_URL = `${BASE_URL}/mcp`;

async function buildAuthHeaders(headersInit?: HeadersInit): Promise<Headers> {
  const headers = new Headers(headersInit);
  if (!serverRequiresAuth()) {
    return headers;
  }
  if (!getMcpTestBearerToken()) {
    await refreshTestAuthToken();
  }
  const token = getMcpTestBearerToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

async function authedFetch(input: URL | RequestInfo, init?: RequestInit): Promise<Response> {
  const firstResponse = await fetch(input, {
    ...init,
    headers: await buildAuthHeaders(init?.headers)
  });
  if (!serverRequiresAuth() || firstResponse.status !== 401) {
    return firstResponse;
  }

  await firstResponse.body?.cancel().catch(() => undefined);
  const refreshed = await refreshTestAuthToken();
  if (!refreshed) {
    return firstResponse;
  }

  return fetch(input, {
    ...init,
    headers: await buildAuthHeaders(init?.headers)
  });
}

// ── Stdio transport setup (shared subprocess with ref-counting) ─────────────

const BOOTSTRAP_PATH = path.resolve(process.cwd(), 'dist/bootstrap.js');
const SOURCE_BOOTSTRAP_PATH = path.resolve(process.cwd(), 'src/bootstrap.ts');
const ROOT_ENV_PATH = path.resolve(process.cwd(), '.env');
const ACTIVE_PROFILE_ENV_PATH = (() => {
  const envName = process.env.ENV;
  if (!envName) return null;
  const profilePath = path.resolve(process.cwd(), `.env.${envName}`);
  return fs.existsSync(profilePath) ? profilePath : null;
})();

function readDotEnv(pathname: string): Record<string, string> {
  if (!fs.existsSync(pathname)) return {};
  return parseDotenv(fs.readFileSync(pathname, 'utf8'));
}

const STDIO_FILE_ENV = {
  ...readDotEnv(ROOT_ENV_PATH),
  ...(ACTIVE_PROFILE_ENV_PATH ? readDotEnv(ACTIVE_PROFILE_ENV_PATH) : {})
};

let stdioClient: Client | null = null;
let stdioTransport: StdioClientTransport | null = null;

function createStdioChildEnv(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    result[key] = value ?? '';
  }
  for (const [key, value] of Object.entries(STDIO_FILE_ENV)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  result.TRANSPORT_TYPE = 'stdio';
  result.AUTH_ENABLED = process.env.AUTH_ENABLED ?? STDIO_FILE_ENV.AUTH_ENABLED ?? 'false';
  result.PORT = process.env.PORT ?? STDIO_FILE_ENV.PORT ?? '4300';
  result.METRICS_PORT = 'disabled';
  result.REDIS_URL = process.env.REDIS_URL ?? STDIO_FILE_ENV.REDIS_URL ?? '';
  return result;
}

const STDIO_CONNECT_TIMEOUT_MS = 60_000;

async function createStdioMcpConnection() {
  if (!stdioClient) {
    const env = createStdioChildEnv();
    const args = fs.existsSync(BOOTSTRAP_PATH)
      ? [BOOTSTRAP_PATH]
      : ['--loader', 'ts-node/esm', SOURCE_BOOTSTRAP_PATH];

    const client = new Client({ name: 'kb-integration-tests-stdio', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args,
      env,
      cwd: process.cwd()
    });

    // Race the connect against a timeout so a hung child process fails fast
    // instead of blocking the entire test suite indefinitely.
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        client.connect(transport),
        new Promise<never>((_, reject) => {
          connectTimer = setTimeout(() => reject(new Error(`MCP stdio connect timed out after ${STDIO_CONNECT_TIMEOUT_MS}ms`)), STDIO_CONNECT_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      // Reset so the next call creates a fresh child process
      try { await transport.close?.(); } catch { /* ignore */ }
      throw err;
    } finally {
      // Always clear the timer — an uncleared setTimeout keeps the event loop alive
      if (connectTimer) clearTimeout(connectTimer);
    }

    // Only assign after successful connect
    stdioClient = client;
    stdioTransport = transport;
  }

  const capturedClient = stdioClient;
  const capturedTransport = stdioTransport;
  return {
    client: capturedClient,
    transport: null,
    close: async () => {
      // Close the shared stdio transport so the child process exits and its
      // pipes don't keep Jest's event loop alive. The next createMcpConnection()
      // call spawns a fresh child.
      if (capturedTransport) {
        try { await capturedTransport.close(); } catch { /* ignore */ }
      }
      if (capturedClient) {
        try { await capturedClient.close(); } catch { /* ignore */ }
      }
      // Reset singleton so the next call creates a fresh child process
      if (stdioTransport === capturedTransport) stdioTransport = null;
      if (stdioClient === capturedClient) stdioClient = null;
    }
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

// McpConnection JSDoc typedef (converted from TypeScript interface)
/**
 * @typedef {Object} McpConnection
 * @property {Client} client
 * @property {StreamableHTTPClientTransport|null} transport
 * @property {() => Promise<void>} close
 */

/**
 * Creates a new MCP client connection.
 * Uses HTTP (StreamableHTTPClientTransport) by default, or stdio (shared subprocess) when TRANSPORT_TYPE=stdio.
 * @returns Promise that resolves to an McpConnection object
 */
export async function createMcpConnection() {
  if (isStdioTransport()) {
    return createStdioMcpConnection();
  }

  // Refresh password-grant token so it includes optional scopes (e.g. kairos-groups) and matches server OIDC merge.
  if (serverRequiresAuth()) {
    await refreshTestAuthToken();
  }

  const client = new Client({
    name: 'kb-integration-tests',
    version: '1.0.0'
  });

  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: authedFetch
  });
  await client.connect(transport);

  // Return connection object with cleanup function
  return {
    client,
    transport,
    close: async () => {
      try {
        await client.close();
      } catch (error) {
        console.warn('Error closing MCP client:', error);
      }
    }
  };
}

/**
 * Creates a shared MCP connection suitable for multiple test files
 * This is a singleton pattern to avoid multiple connections
 */
type McpConnection = Awaited<ReturnType<typeof createMcpConnection>>;
let sharedConnection: McpConnection | null = null;
let sharedConnectionPromise: Promise<McpConnection> | null = null;

export async function getSharedMcpConnection() {
  if (sharedConnection) {
    return sharedConnection;
  }

  if (!sharedConnectionPromise) {
    sharedConnectionPromise = createMcpConnection();
  }

  sharedConnection = await sharedConnectionPromise;
  return sharedConnection;
}
