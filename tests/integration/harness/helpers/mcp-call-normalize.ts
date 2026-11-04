/**
 * Normalize MCP `tools/call` results for contract tests: success returns parsed JSON payload;
 * validation / tool errors throw with the server text for `rejects.toThrow(...)`.
 */

import type { Client } from '@modelcontextprotocol/client';
import { parseMcpJson } from '../../../utils/expect-with-raw.js';

export async function callToolJson(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args });
  const r = result as { isError?: boolean; content?: Array<{ type?: string; text?: string }> };
  if (r.isError) {
    const text =
      r.content?.map((c) => (c?.type === 'text' && c.text ? c.text : '')).join('\n') || '';
    throw new Error(text || `MCP tool ${name} returned isError with no text`);
  }
  return parseMcpJson(result, `${name} tool`);
}
