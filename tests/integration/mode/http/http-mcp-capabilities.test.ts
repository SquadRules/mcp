/**
 * HTTP transport: comprehensive MCP server capabilities verification.
 * Mirrors the stdio smoke test but connects over Streamable HTTP to a running server.
 * Validates all cacheable operations per the 2026-07-28 spec.
 *
 * Runs only when TRANSPORT_TYPE=http (CLUSTER lane).
 */

import { createMcpConnection } from '../../../utils/mcp-client-utils.js';
import { isHttpTransport } from '../../../utils/auth-headers.js';
import { verifyMcpServerCapabilities } from '../../../utils/mcp-capabilities-verify.js';

const _d = isHttpTransport() ? describe : describe.skip;

_d('HTTP MCP server capabilities (spec 2026-07-28)', () => {
  test('capabilities, tools, resources, templates, prompts — all cacheable methods verified', async () => {
    const conn = await createMcpConnection();
    try {
      await verifyMcpServerCapabilities(conn.client);
    } finally {
      await conn.close();
    }
  }, 45000);
});
