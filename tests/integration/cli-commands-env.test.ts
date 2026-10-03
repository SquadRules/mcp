/**
 * CLI Commands Environment Variable and Error Handling Tests
 * Tests SQUADRULES_API_URL environment variable and error scenarios
 */

import {
  execAsync,
  execAsyncNoAuth,
  execAsyncWithConfig,
  BASE_URL,
  CLI_PATH,
  TEST_FILE,
  setupServerCheck,
  setupCliConfigWithLogin,
  requireMcpServerAndCliLogin
} from './cli-commands-shared.js';
import { serverRequiresAuth, isHttpTransport } from '../utils/auth-headers.js';

const AUTH_ERROR_PATTERN =
  /Authentication required|Unauthorized|Bearer token invalid|expired|login|Log in|SSO|invalid_token|sign in/i;

const describeAuthNoToken = serverRequiresAuth() && isHttpTransport() ? describe : describe.skip;
const _d = isHttpTransport() ? describe : describe.skip;

_d('CLI Commands Environment & Error Tests', () => {
  let serverAvailable = false;
  let cliLoggedIn = false;

  beforeAll(async () => {
    serverAvailable = await setupServerCheck();
    cliLoggedIn = await setupCliConfigWithLogin();
  }, 60000);

  describe('CLI via npm script', () => {
    test('npm run cli -- activate with --url returns choices when server is up', async () => {
      requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);

      const { stdout } = await execAsync(
        `npm run cli --silent -- --url ${BASE_URL} activate "test query"`,
        { timeout: 20000 }
      );
      const result = JSON.parse(stdout.trim());
      expect(result).toHaveProperty('must_obey');
      expect(result).toHaveProperty('choices');
    }, 25000);
  });

  describe('SQUADRULES_API_URL environment variable', () => {
    test('activate uses SQUADRULES_API_URL environment variable', async () => {
      requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);

      const { stdout, stderr } = await execAsync(
        `SQUADRULES_API_URL=${BASE_URL} node ${CLI_PATH} activate "test query"`
      );

      expect(stderr).toBe('');
      const result = JSON.parse(stdout);
      // V2 unified response shape
      expect(result).toHaveProperty('must_obey');
      expect(result).toHaveProperty('choices');
      expect(result).toHaveProperty('choices');
    }, 30000);

    test('forward uses SQUADRULES_API_URL environment variable with URI', async () => {
      requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);

      // Train test protocol then activate to get a valid URI (no longer rely on built-in mem docs)
      await execAsync(
        `SQUADRULES_API_URL=${BASE_URL} node ${CLI_PATH} train --force "${TEST_FILE}"`
      );
      const searchResult = await execAsync(
        `SQUADRULES_API_URL=${BASE_URL} node ${CLI_PATH} activate "Minimal CLI Test Document"`
      );
      const searchData = JSON.parse(searchResult.stdout);
      // V2: extract URI from choices array (first match)
      const matchChoice = Array.isArray(searchData.choices)
        ? searchData.choices.find((c: any) => c.role === 'match')
        : null;
      const uri = matchChoice?.uri;
      expect(uri).toBeDefined();

      const { stdout, stderr } = await execAsync(
        `SQUADRULES_API_URL=${BASE_URL} node ${CLI_PATH} forward "${uri}"`
      );

      expect(stderr).toBe('');
      const result = JSON.parse(stdout);
      // V2: next_action replaces protocol_status
      expect(result).toHaveProperty('must_obey');
      expect(result).toHaveProperty('next_action');
      expect(result).toHaveProperty('contract');
      expect(result.current_layer).toBeDefined();
    }, 30000);

    test('train uses SQUADRULES_API_URL environment variable', async () => {
      requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);

      // Use --force to handle case where the adapter already exists from previous test runs
      const { stdout, stderr } = await execAsync(
        `SQUADRULES_API_URL=${BASE_URL} node ${CLI_PATH} train --force "${TEST_FILE}"`
      );

      expect(stderr).toBe('');
      const result = JSON.parse(stdout);
      expect(result).toHaveProperty('status');
    }, 30000);

    test('--url parameter overrides SQUADRULES_API_URL environment variable', async () => {
      requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);

      // Set env var to wrong URL, but --url should override
      const { stdout, stderr } = await execAsync(
        `SQUADRULES_API_URL=http://wrong-url:9999 node ${CLI_PATH} activate --url ${BASE_URL} "test query"`
      );

      expect(stderr).toBe('');
      const result = JSON.parse(stdout);
      // V2 unified response shape
      expect(result).toHaveProperty('must_obey');
      expect(result).toHaveProperty('choices');
      expect(result).toHaveProperty('choices');
    }, 30000);
  });

  describeAuthNoToken('Auth required (no token)', () => {
    test('activate without token fails with auth message when server requires auth', async () => {
      expect(serverAvailable).toBe(true);

      try {
        await execAsyncNoAuth(
          `node ${CLI_PATH} activate --url ${BASE_URL} "test query"`,
          { timeout: 15000 }
        );
        expect('CLI should have exited with auth error').toBe(false);
      } catch (err: unknown) {
        const e = err as { code?: number; stdout?: string; stderr?: string };
        expect(e.code).not.toBe(0);
        const out = [e.stdout, e.stderr].filter(Boolean).join('\n');
        expect(out).toMatch(AUTH_ERROR_PATTERN);
      }
    }, 20000);

    test('activate with invalid token in config fails with auth message when server requires auth', async () => {
      expect(serverAvailable).toBe(true);

      try {
        await execAsyncWithConfig(
          `node ${CLI_PATH} activate --url ${BASE_URL} "test query"`,
          { SQUADRULES_API_URL: BASE_URL, bearerToken: 'invalid-token' },
          { timeout: 15000 }
        );
        expect('CLI should have exited with auth error').toBe(false);
      } catch (err: unknown) {
        const e = err as { code?: number; stdout?: string; stderr?: string };
        expect(e.code).not.toBe(0);
        const out = [e.stdout, e.stderr].filter(Boolean).join('\n');
        expect(out).toMatch(AUTH_ERROR_PATTERN);
      } finally {
        await setupCliConfigWithLogin();
      }
    }, 20000);
  });

  describe('Error handling with --url', () => {
    test('activate fails with invalid --url', async () => {
      requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);

      await expect(
        execAsync(`node ${CLI_PATH} activate --url http://invalid-url:9999 "test query"`)
      ).rejects.toThrow();
    }, 30000);

    test('forward fails with invalid --url', async () => {
      requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);

      // URI can be any; we are asserting the client rejects when server URL is invalid
      await expect(
        execAsync(
          `node ${CLI_PATH} forward --url http://invalid-url:9999 "squadrules://adapter/invalid-adapter-slug"`
        )
      ).rejects.toThrow();
    }, 30000);

    test('train fails with invalid --url', async () => {
      requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);

      await expect(
        execAsync(`node ${CLI_PATH} train --url http://invalid-url:9999 "${TEST_FILE}"`)
      ).rejects.toThrow();
    }, 30000);
  });
});

