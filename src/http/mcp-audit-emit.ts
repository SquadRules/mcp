/**
 * MCP audit event emission.
 *
 * Isolated from http-mcp-handler.ts to keep that file under the max-lines lint
 * limit. Called from the MCP HTTP handler after tool execution completes.
 */

import { randomUUID } from 'node:crypto';
import { writeAuditLine } from '../utils/structured-logger.js';
import { AUDIT_LOG_LEVEL } from '../config.js';
import { getBuildVersion } from '../utils/build-version.js';
import { summarizeRequestArgs, summarizeResponse, extractErrorCode } from '../utils/audit-mcp-summary.js';
import type { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node/streamableHttp';
import type { JSONRPCMessage } from '@modelcontextprotocol/server';

export { AUDIT_LOG_LEVEL };

/**
 * Capture JSON-RPC response for audit level 3.
 *
 * The MCP SDK's NodeStreamableHTTPServerTransport sends responses via transport.send(),
 * NOT through Express res.json()/res.end(). We intercept at the transport level.
 */
export function installResponseCapture(transport: NodeStreamableHTTPServerTransport): { getResponse: () => unknown } {
  let captured: unknown = null;
  const originalSend = transport.send.bind(transport);

  transport.send = async function (message: JSONRPCMessage, options?: Parameters<typeof originalSend>[1]): Promise<void> {
    // Capture JSON-RPC responses (have 'result' or 'error' and an 'id')
    if (message && typeof message === 'object' && ('result' in message || 'error' in message)) {
      captured = message;
    }
    return originalSend(message, options);
  };

  return { getResponse: () => captured };
}

/** Generate a correlation ID for grouping related MCP requests. */
export function generateCorrelationId(): string {
  return `corr-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

/** Emit mcp_request_start audit event (before space context, tenant_id unknown). */
export function emitRequestStart(correlationId: string, requestId: string, method: string, toolName: string): void {
  if (AUDIT_LOG_LEVEL <= 0) return;
  writeAuditLine('info', {
    category: 'audit.mcp',
    event: 'mcp_request_start',
    correlation_id: correlationId,
    tenant_id: 'unknown',
    request_id: requestId,
    mcp_method: method,
    tool_name: toolName,
    server_version: getBuildVersion()
  });
}

/** Emit mcp_request_end audit event (in response finish handler). */
export function emitRequestEnd(correlationId: string, requestId: string, toolName: string, durationMs: number): void {
  if (AUDIT_LOG_LEVEL <= 0) return;
  writeAuditLine('info', {
    category: 'audit.mcp',
    event: 'mcp_request_end',
    correlation_id: correlationId,
    tenant_id: 'unknown',
    request_id: requestId,
    tool_name: toolName,
    tool_count: 1,
    duration_ms: durationMs,
    server_version: getBuildVersion()
  });
}

/**
 * Emit mcp_tool_call audit event.
 * Called from the response finish handler with pre-captured tenantId.
 */
export function emitToolCallAudit(
  correlationId: string,
  requestId: string,
  toolName: string,
  requestStart: number,
  capturedResponse: unknown,
  requestArgs: unknown,
  tenantId: string
): void {
  if (AUDIT_LOG_LEVEL <= 0) return;

  const durationMs = Date.now() - requestStart;
  const isError = capturedResponse !== null &&
    typeof capturedResponse === 'object' &&
    'error' in (capturedResponse as Record<string, unknown>);

  const auditBindings: Record<string, unknown> = {
    category: 'audit.mcp',
    event: 'mcp_tool_call',
    stage: 'response',
    correlation_id: correlationId,
    tenant_id: tenantId,
    request_id: requestId,
    tool_name: toolName,
    status: isError ? 'error' : 'success',
    duration_ms: durationMs,
    error_code: isError ? extractErrorCode(capturedResponse) : undefined
  };

  if (AUDIT_LOG_LEVEL >= 2) {
    auditBindings['request'] = summarizeRequestArgs(toolName, requestArgs);
  }
  if (AUDIT_LOG_LEVEL >= 3 && capturedResponse) {
    const rpcResult = capturedResponse as Record<string, unknown>;
    auditBindings['response'] = summarizeResponse(toolName, rpcResult['result'] ?? rpcResult['error']);
  }

  writeAuditLine('info', auditBindings);
}
