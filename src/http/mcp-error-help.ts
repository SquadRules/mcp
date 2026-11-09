/**
 * Client-safe error help for the HTTP MCP endpoint.
 *
 * Extracted from `http-mcp-handler.ts` to keep per-file line counts within the
 * ESLint `max-lines` budget; behavior is unchanged.
 */
import { SquadrulesError } from '../types/index.js';

function sanitizeMcpErrorDetails(details: unknown): Record<string, unknown> {
  if (!details || typeof details !== 'object') return {};
  try { return JSON.parse(JSON.stringify(details)) as Record<string, unknown>; }
  catch { return {}; }
}

/** Help text and error_code for clients; never expose internal error details. */
export function mcpErrorToHelp(error: unknown): { message: string; error_code: string; retry_hint: string; details?: Record<string, unknown> } {
  if (error instanceof SquadrulesError) {
    const details = sanitizeMcpErrorDetails(error.details);
    const nextAction = typeof details['next_action'] === 'string' ? details['next_action'] : undefined;
    return {
      message: error.message,
      error_code: typeof error.code === 'string' && error.code.length > 0 ? error.code : 'SERVER_ERROR',
      retry_hint: nextAction ?? 'Adjust the request and retry.',
      ...(Object.keys(details).length > 0 ? { details } : {})
    };
  }
  const msg = error instanceof Error ? error.message : String(error);
  // Defensive: should not trigger with per-request servers; kept as safety net.
  if (msg.includes('Already connected to a transport')) {
    return { message: 'Server is busy with another request. Wait a few seconds and retry; if it continues, start a new MCP session.', error_code: 'CONNECTION_CONFLICT', retry_hint: 'Wait a few seconds and retry the same request; if repeated, start a new MCP session.' };
  }
  return { message: 'An unexpected error occurred. Please retry. If the problem continues, start a new MCP session.', error_code: 'SERVER_ERROR', retry_hint: 'Retry the request; if it persists, start a new MCP session.' };
}
