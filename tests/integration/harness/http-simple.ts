/**
 * HTTP + no-auth harness for integration tests against an HTTP server with auth disabled.
 */

import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { serverRequiresAuth } from '../../utils/auth-headers.js';
import { SCENARIOS } from './scenario.js';
import type { TestHarness } from './types.js';
import { callToolJson } from './helpers/mcp-call-normalize.js';

export async function createHttpSimpleHarness(): Promise<TestHarness> {
  if (serverRequiresAuth()) {
    throw new Error(
      'createHttpSimpleHarness requires AUTH_ENABLED!=true (HTTP transport with auth disabled).'
    );
  }
  const conn = await createMcpConnection();
  return {
    scenario: SCENARIOS['http-simple'],
    callTool: (name, args) => callToolJson(conn.client, name, args),
    close: conn.close
  };
}
