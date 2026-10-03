/**
 * Ensure host/dynamic OAuth clients receive group claims and can access group spaces via MCP.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { decodeJwtPayloadSegment, extractGroupsFromPayload } from '../../../../src/http/oidc-profile-claims.js';
import { parseMcpJson, withRawOnFail } from '../../../utils/expect-with-raw.js';
import {
  getAuthHeaders,
  getTestAuthBaseUrl,
  getTestKeycloakUrl,
  hasAuthToken,
  serverRequiresAuth,
  isHttpTransport
} from '../../../utils/auth-headers.js';
import {
  REALM,
  TEST_PASSWORD,
  TEST_USERNAME,
  getAdminToken,
  getTestUserTokenFromKeycloak
} from '../../../utils/keycloak-container.js';
import {
  createPublicClient,
  deleteClientByClientId
} from '../../../utils/keycloak-client-admin.js';
import { MOCK_REVIEW_EVIDENCE } from '../../../utils/mock-review-evidence.js';

const BASE_URL = getTestAuthBaseUrl().replace(/\/$/, '');
const MCP_URL = `${BASE_URL}/mcp`;
const _d = isHttpTransport() ? describe : describe.skip;

function mdWithTitle(title: string): string {
  return `# ${title}

## Activation Patterns
Host client group test.

## Step 1
Body.

\`\`\`json
{"contract": {"type": "comment", "comment": {"min_length": 10}, "required": true}}
\`\`\`

## Reward Signal
Done.`;
}

async function createMcpConnectionWithToken(token: string) {
  const client = new Client({
    name: 'mcp-host-client-groups-test',
    version: '1.0.0'
  });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: (input, init) => {
      const headers = new Headers(init?.headers ?? {});
      headers.set('Authorization', `Bearer ${token}`);
      return fetch(input, { ...init, headers });
    }
  });
  await client.connect(transport);
  return {
    client,
    close: async () => {
      try {
        await client.close();
      } catch {
        // ignore
      }
    }
  };
}

_d('MCP host client groups', () => {
  test('host-style client token includes groups and MCP can train into group space', async () => {
    if (!serverRequiresAuth() || !hasAuthToken()) {
      console.warn('[mcp-host-client-groups] skip: auth disabled or missing token');
      return;
    }

    const keycloakUrl = getTestKeycloakUrl();
    const adminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD ?? '';
    if (!keycloakUrl || !adminPassword) {
      console.warn('[mcp-host-client-groups] skip: missing Keycloak admin access');
      return;
    }

    const meRes = await fetch(`${BASE_URL}/api/me`, { headers: getAuthHeaders() });
    if (!meRes.ok) {
      console.warn('[mcp-host-client-groups] skip: /api/me not available');
      return;
    }
    const me = (await meRes.json()) as { groups?: string[] };
    if (!Array.isArray(me.groups) || me.groups.length === 0) {
      throw new Error(
        '[mcp-host-client-groups] /api/me has no groups — baseline session must expose group membership (GitHub #278: Keycloak groups claim + squadrules-groups scope)'
      );
    }

    const adminToken = await getAdminToken(
      keycloakUrl,
      process.env.KEYCLOAK_ADMIN_USERNAME ?? 'admin',
      adminPassword
    );
    const realm = process.env.KEYCLOAK_REALM ?? REALM;
    const tempClientId = `mcp-host-${Date.now()}`;

    await createPublicClient(keycloakUrl, adminToken, tempClientId, realm);

    let mcp: Awaited<ReturnType<typeof createMcpConnectionWithToken>> | null = null;
    try {
      const accessToken = await getTestUserTokenFromKeycloak(
        keycloakUrl,
        realm,
        tempClientId,
        TEST_USERNAME,
        TEST_PASSWORD
      );
      const payload = decodeJwtPayloadSegment(accessToken);
      const groups = extractGroupsFromPayload(payload ?? {});
      expect(groups.length).toBeGreaterThan(0);

      mcp = await createMcpConnectionWithToken(accessToken);
      const spacesRes = await mcp.client.callTool({
        name: 'spaces',
        arguments: { include_adapter_titles: false }
      });
      const spacesParsed = parseMcpJson(spacesRes, 'spaces-host-client');
      const rows = (spacesParsed.spaces ?? []) as Array<{ name: string; type: string }>;
      expect(rows.some((s) => s.type === 'group')).toBe(true);

      const group = rows.find((s) => s.type === 'group');
      if (!group) {
        throw new Error('Expected group space in MCP spaces output');
      }

      const title = `HostClientGroup ${Date.now()}`;
      const trainCall = {
        name: 'train',
        arguments: {
          content: mdWithTitle(title),
          llm_model_id: 'test-host-client-group',
          space: group.name,
          force_update: true,
          review_evidence: MOCK_REVIEW_EVIDENCE
        }
      };
      const trainRes = await mcp.client.callTool(trainCall);
      const trained = parseMcpJson(trainRes, 'train-host-client-group');
      withRawOnFail({ call: trainCall, result: trainRes }, () => {
        expect(['stored', 'updated']).toContain(trained.status);
      });
      const adapterUri = trained.items?.[0]?.adapter_uri as string | undefined;
      if (adapterUri) {
        await mcp.client.callTool({ name: 'delete', arguments: { uris: [adapterUri] } });
      }
    } finally {
      if (mcp) await mcp.close();
      await deleteClientByClientId(keycloakUrl, adminToken, tempClientId, realm);
    }
  }, 120000);
});
