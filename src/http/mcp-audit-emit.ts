/**
 * MCP audit event emission and response utilities.
 *
 * Isolated from http-mcp-handler.ts to keep that file under the max-lines lint
 * limit. Called from the MCP HTTP handler after tool execution completes.
 */

import { randomUUID } from 'node:crypto';
import type express from 'express';
import { writeAuditLine } from '../utils/structured-logger.js';
import { AUDIT_LOG_LEVEL } from '../config.js';
import { getBuildVersion } from '../utils/build-version.js';
import { summarizeRequestArgs, summarizeResponse, extractErrorCode } from '../utils/audit-mcp-summary.js';

export { AUDIT_LOG_LEVEL };

/**
 * MCP-allocated protocol error codes (2026-07-28 spec).
 * @see https://modelcontextprotocol.io/specification/2026-07-28/basic
 */
export const MCP_ERROR_CODES = {
  HEADER_MISMATCH: -32020,
  MISSING_REQUIRED_CLIENT_CAPABILITY: -32021,
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
} as const;

/**
 * Capture the JSON response body written by `toNodeHandler` for audit level 3.
 * In `responseMode: "json"`, the handler writes the full JSON-RPC response
 * via `res.end(body)` in a single call.
 */
export function captureResponseBody(res: express.Response): { getBody: () => unknown } {
  let capturedBody: unknown = null;
  const originalEnd = res.end.bind(res);
  const originalWrite = res.write.bind(res);

  (res as any).write = function (chunk: unknown, ...args: unknown[]): boolean {
    if (chunk) {
      try {
        const text = typeof chunk === 'string' ? chunk : chunk instanceof Uint8Array ? new TextDecoder().decode(chunk) : String(chunk);
        capturedBody = JSON.parse(text);
      } catch { /* non-JSON chunk, skip */ }
    }
    return originalWrite(chunk, ...args as [any]);
  };

  res.end = function (chunk?: unknown, ...args: unknown[]): express.Response {
    if (chunk && !capturedBody) {
      try {
        const text = typeof chunk === 'string' ? chunk : chunk instanceof Uint8Array ? new TextDecoder().decode(chunk) : String(chunk);
        capturedBody = JSON.parse(text);
      } catch { /* non-JSON chunk, skip */ }
    }
    return originalEnd(chunk, ...args as [any]) as express.Response;
  };

  return { getBody: () => capturedBody };
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
