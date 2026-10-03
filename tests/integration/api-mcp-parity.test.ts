/**
 * API-MCP parity tests: same operation via MCP and HTTP must return identical response shapes.
 * No stripping of metadata; if HTTP adds fields (e.g. metadata) that MCP does not have, tests fail.
 * Schema conformance: MCP and HTTP responses must parse against the canonical Zod output schemas.
 */

import { createMcpConnection } from '../utils/mcp-client-utils.js';
import { getAuthHeaders, getTestAuthBaseUrl, isHttpTransport } from '../utils/auth-headers.js';
import { parseMcpJson } from '../utils/expect-with-raw.js';
import { spacesOutputSchema } from '../../src/tools/spaces_schema.js';
import { activateOutputSchema } from '../../src/tools/activate_schema.js';
import { exportOutputSchema } from '../../src/tools/export_schema.js';
import { deleteOutputSchema } from '../../src/tools/delete_schema.js';
import { forwardOutputSchema } from '../../src/tools/forward_schema.js';
import { rewardOutputSchema } from '../../src/tools/reward_schema.js';

const BASE_URL = getTestAuthBaseUrl().replace(/\/$/, '');
const API_BASE = `${BASE_URL}/api`;
const _d = isHttpTransport() ? describe : describe.skip;

/** Boot-injected creation adapter (by slug) — valid export input. */
const SAMPLE_EXPORT_URI = 'squadrules://adapter/create-new-protocol';

function httpFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: { ...getAuthHeaders(), ...(init.headers as Record<string, string>) }
  });
}

function sortedKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).sort();
}

_d('API-MCP parity: identical response shapes', () => {
  let mcpConnection: { client: { callTool: (arg: { name: string; arguments: Record<string, unknown> }) => Promise<unknown> }; close: () => Promise<void> };

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  }, 60000);

  afterAll(async () => {
    if (mcpConnection) await mcpConnection.close();
  });

  describe('spaces', () => {
    test('MCP and HTTP responses have identical key sets', async () => {
      expect.hasAssertions();

      const mcpResult = await mcpConnection.client.callTool({
        name: 'spaces',
        arguments: { include_adapter_titles: false }
      });
      const mcpParsed = parseMcpJson(mcpResult, 'spaces MCP');

      const httpRes = await httpFetch(`${API_BASE}/spaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ include_adapter_titles: false })
      });
      expect(httpRes.ok).toBe(true);
      const httpParsed = (await httpRes.json()) as Record<string, unknown>;

      expect(sortedKeys(mcpParsed)).toEqual(sortedKeys(httpParsed));
    });
  });

  describe('activate', () => {
    test('MCP and HTTP responses have identical key sets', async () => {
      expect.hasAssertions();

      const query = `ParityTest ${Date.now()}`;
      const mcpResult = await mcpConnection.client.callTool({
        name: 'activate',
        arguments: { query }
      });
      const mcpParsed = parseMcpJson(mcpResult, 'activate MCP');

      const httpRes = await httpFetch(`${API_BASE}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      expect(httpRes.ok).toBe(true);
      const httpParsed = (await httpRes.json()) as Record<string, unknown>;

      expect(sortedKeys(mcpParsed)).toEqual(sortedKeys(httpParsed));
    });
  });

  describe('export', () => {
    test('MCP and HTTP responses have identical key sets for same URI', async () => {
      expect.hasAssertions();

      const uri = SAMPLE_EXPORT_URI;
      const mcpResult = await mcpConnection.client.callTool({
        name: 'export',
        arguments: { uri, format: 'markdown' }
      });
      const mcpParsed = parseMcpJson(mcpResult, 'export MCP');

      const httpRes = await httpFetch(`${API_BASE}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uri, format: 'markdown' })
      });
      expect(httpRes.ok).toBe(true);
      const httpParsed = (await httpRes.json()) as Record<string, unknown>;

      expect(sortedKeys(mcpParsed)).toEqual(sortedKeys(httpParsed));
    });
  });

  describe('delete', () => {
    test('MCP and HTTP responses have identical key sets', async () => {
      expect.hasAssertions();

      const uris = ['squadrules://layer/00000000-0000-0000-0000-000000000000'];
      const mcpResult = await mcpConnection.client.callTool({
        name: 'delete',
        arguments: { uris }
      });
      const mcpParsed = parseMcpJson(mcpResult, 'delete MCP');

      const httpRes = await httpFetch(`${API_BASE}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris })
      });
      expect(httpRes.ok).toBe(true);
      const httpParsed = (await httpRes.json()) as Record<string, unknown>;

      expect(sortedKeys(mcpParsed)).toEqual(sortedKeys(httpParsed));
    });
  });

  describe('Schema conformance: outputSchema.parse(response)', () => {
    test('spaces: MCP response parses against spacesOutputSchema', async () => {
      expect.hasAssertions();
      const mcpResult = await mcpConnection.client.callTool({
        name: 'spaces',
        arguments: { include_adapter_titles: false }
      });
      const mcpParsed = parseMcpJson(mcpResult, 'spaces MCP');
      const parsed = spacesOutputSchema.safeParse(mcpParsed);
      expect(parsed.success).toBe(true);
    });

    test('spaces: HTTP response parses against spacesOutputSchema', async () => {
      expect.hasAssertions();
      const httpRes = await httpFetch(`${API_BASE}/spaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const httpParsed = (await httpRes.json()) as Record<string, unknown>;
      const parsed = spacesOutputSchema.safeParse(httpParsed);
      expect(parsed.success).toBe(true);
    });

    test('activate: MCP response parses against activateOutputSchema', async () => {
      expect.hasAssertions();
      const mcpResult = await mcpConnection.client.callTool({
        name: 'activate',
        arguments: { query: 'SchemaConformance' }
      });
      const mcpParsed = parseMcpJson(mcpResult, 'activate MCP');
      const parsed = activateOutputSchema.safeParse(mcpParsed);
      expect(parsed.success).toBe(true);
    });

    test('activate: HTTP response parses against activateOutputSchema', async () => {
      expect.hasAssertions();
      const httpRes = await httpFetch(`${API_BASE}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'SchemaConformance' })
      });
      const httpParsed = (await httpRes.json()) as Record<string, unknown>;
      const parsed = activateOutputSchema.safeParse(httpParsed);
      expect(parsed.success).toBe(true);
    });

    test('export: MCP response parses against exportOutputSchema', async () => {
      expect.hasAssertions();
      const mcpResult = await mcpConnection.client.callTool({
        name: 'export',
        arguments: { uri: SAMPLE_EXPORT_URI, format: 'markdown' }
      });
      const mcpParsed = parseMcpJson(mcpResult, 'export MCP');
      const parsed = exportOutputSchema.safeParse(mcpParsed);
      expect(parsed.success).toBe(true);
    });

    test('delete: MCP response parses against deleteOutputSchema', async () => {
      expect.hasAssertions();
      const mcpResult = await mcpConnection.client.callTool({
        name: 'delete',
        arguments: { uris: ['squadrules://layer/00000000-0000-0000-0000-000000000000'] }
      });
      const mcpParsed = parseMcpJson(mcpResult, 'delete MCP');
      const parsed = deleteOutputSchema.safeParse(mcpParsed);
      expect(parsed.success).toBe(true);
    });

    test('activate includes forward_first_call parity and slug URI format', async () => {
      const query = 'refine search';
      const mcpResult = await mcpConnection.client.callTool({
        name: 'activate',
        arguments: { query }
      });
      const mcpParsed = parseMcpJson(mcpResult, 'activate MCP parity next-call');
      const httpRes = await httpFetch(`${API_BASE}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      const httpParsed = (await httpRes.json()) as Record<string, unknown>;
      expect(sortedKeys(mcpParsed)).toEqual(sortedKeys(httpParsed));
      for (const choice of (mcpParsed.choices as Array<Record<string, unknown>>)) {
        if (choice.role === 'create') {
          expect(choice.forward_first_call).toBeNull();
          continue;
        }
        const f = choice.forward_first_call as Record<string, unknown>;
        expect(typeof f?.uri).toBe('string');
        expect(String(f.uri)).toMatch(/^squadrules:\/\/adapter\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i);
      }
    });

    test('forward start/middle/terminal include next_call parity', async () => {
      const beginMcp = await mcpConnection.client.callTool({
        name: 'forward',
        arguments: { uri: 'squadrules://adapter/refine-search' }
      });
      const beginPayload = parseMcpJson(beginMcp, 'forward MCP begin parity');
      const beginHttpRes = await httpFetch(`${API_BASE}/forward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uri: 'squadrules://adapter/refine-search' })
      });
      const beginHttpPayload = (await beginHttpRes.json()) as Record<string, unknown>;
      expect(forwardOutputSchema.safeParse(beginPayload).success).toBe(true);
      expect(forwardOutputSchema.safeParse(beginHttpPayload).success).toBe(true);
      expect((beginPayload.next_call as Record<string, unknown>).kind).toBe(
        (beginHttpPayload.next_call as Record<string, unknown>).kind
      );
      const beginUri = String((beginPayload.next_call as any).args.uri);
      expect(beginUri).toMatch(/^squadrules:\/\/layer\/[0-9a-f-]{36}\?execution_id=[0-9a-f-]{36}$/i);

      const middleMcp = await mcpConnection.client.callTool({
        name: 'forward',
        arguments: {
          uri: beginUri,
          solution: { type: 'comment', comment: { text: 'parity check solution text' } }
        }
      });
      const middlePayload = parseMcpJson(middleMcp, 'forward MCP middle parity');
      expect(forwardOutputSchema.safeParse(middlePayload).success).toBe(true);
      const middleNextCall = middlePayload.next_call as Record<string, unknown>;
      expect(typeof (middleNextCall.args as Record<string, unknown>).uri).toBe('string');
      expect(String((middleNextCall.args as Record<string, unknown>).uri)).toMatch(
        /^squadrules:\/\/layer\/[0-9a-f-]{36}\?execution_id=[0-9a-f-]{36}$/i
      );
      if (middleNextCall.kind === 'reward') {
        const rewardUri = String((middleNextCall.args as Record<string, unknown>).uri);
        const rewardMcp = await mcpConnection.client.callTool({
          name: 'reward',
          arguments: { uri: rewardUri, outcome: 'success' }
        });
        const rewardPayload = parseMcpJson(rewardMcp, 'reward MCP terminal parity');
        expect(rewardOutputSchema.safeParse(rewardPayload).success).toBe(true);
        expect(rewardPayload.next_call).toBeNull();
      }
    });
  });
});
