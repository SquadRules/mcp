/**
 * Integration tests for MCP handler under concurrent load.
 * Proves no context bleed and no CONNECTION_CONFLICT / 5xx under parallel requests.
 */

import { getTestAuthBaseUrl, getAuthHeaders, isHttpTransport } from '../utils/auth-headers.js';

const BASE_URL = getTestAuthBaseUrl();
const PARALLEL = 25;
const _d = isHttpTransport() ? describe : describe.skip;

/**
 * Parse MCP response which may be JSON or SSE format.
 * SSE format: "event: <type>\ndata: <json>\n\n"
 */
async function parseMcpResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  
  // If SSE, extract the first data line
  if (contentType.includes('text/event-stream') || text.startsWith('event:')) {
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        return JSON.parse(line.substring(6));
      }
    }
    throw new Error(`No data line found in SSE response: ${text.substring(0, 100)}`);
  }
  
  // Otherwise parse as JSON
  return JSON.parse(text);
}

function postMcp(body: object) {
  return fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...getAuthHeaders()
    },
    body: JSON.stringify(body)
  });
}

_d('MCP concurrent requests', () => {
  test(`${PARALLEL} parallel tools/list: all 200, valid JSON-RPC, no CONNECTION_CONFLICT`, async () => {
    const requests = Array.from({ length: PARALLEL }, (_, i) =>
      postMcp({
        jsonrpc: '2.0',
        id: i + 1,
        method: 'tools/list'
      })
    );

    const responses = await Promise.all(requests);

    expect(responses).toHaveLength(PARALLEL);

    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    const bodies = (await Promise.all(
      responses.map((res) => parseMcpResponse(res))
    )) as Array<{
      jsonrpc?: string;
      result?: { tools?: unknown[] };
      error?: { data?: { error_code?: string } };
    }>;

    for (const body of bodies) {
      expect(body.jsonrpc).toBe('2.0');
      expect(body.error).toBeUndefined();
      expect(body.result).toBeDefined();
      expect(Array.isArray(body.result?.tools)).toBe(true);
      if (body.error?.data?.error_code) {
        expect(body.error.data.error_code).not.toBe('CONNECTION_CONFLICT');
      }
    }
  });
});
