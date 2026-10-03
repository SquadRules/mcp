/**
 * Structured HTTP Access Logging for SQUADRULES MCP
 *
 * Uses shared Pino backend (log-core) for consistent JSON shape.
 * See the Testing and Observability topic in the project Wiki for levels, standard fields, and usage.
 *
 * Features:
 * - request_id, client_ip, duration_ms, error_code
 * - child(component, module) for context
 * - Proxy-safe client IP when TRUSTED_PROXY_CIDRS is set
 */

import pino from 'pino';
import type { Request, Response } from 'express';
import { createWriteStream, type WriteStream } from 'node:fs';
import { buildAuditLine } from './audit-log-events.js';
import { getBaseLogger } from './log-core.js';
import { AUDIT_LOG_FILE, LOG_LEVEL, LOG_FORMAT, TRANSPORT_TYPE } from '../config.js';

const TRUSTED_PROXY_CIDRS = (process.env['TRUSTED_PROXY_CIDRS'] || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function getClientIp(req: Request): string {
  const reqWithSocket = req as Request & { socket?: { remoteAddress?: string }; ip?: string };
  const remote = reqWithSocket?.socket?.remoteAddress ?? reqWithSocket?.ip ?? 'unknown';
  const xff = (req.headers && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']) : '');

  if (!xff) return remote;

  if (TRUSTED_PROXY_CIDRS.length > 0) {
    const first = xff.split(',')[0];
    return (first && first.trim()) || remote;
  }

  return remote;
}

const baseLogger = getBaseLogger();
let auditLogStream: WriteStream | null = null;
const MAX_AUDIT_LINE_BYTES = 65_536;
const MAX_AUDIT_DEPTH = 4;
const MAX_AUDIT_KEYS = 40;
const MAX_AUDIT_STRING_LEN = 2_048;

if (AUDIT_LOG_FILE) {
  try {
    auditLogStream = createWriteStream(AUDIT_LOG_FILE, { flags: 'a' });
  } catch {
    auditLogStream = null;
  }
}

/** Sanitize string for safe logging and audit write: neutralize line breaks first (CodeQL log-injection pattern), then other CTL. */
function sanitizeLogMessage(s: string, maxLen = 32_768): string {
  if (typeof s !== 'string') return '';
  const safe = s.replace(/[\r\n]/g, ' ').slice(0, maxLen);
  const noCtl = safe.replace(/[\x00-\x1f]/g, ' ');
  return noCtl.replace(/\s+/g, ' ').trim() || '(empty)';
}

const MAX_BINDING_KEY_LEN = 256;

/** Sanitize object keys before they appear in log/audit records (keys can carry CR/LF if bindings come from parsed JSON). */
function sanitizeBindingKey(key: string): string {
  const k = sanitizeLogMessage(key, MAX_BINDING_KEY_LEN);
  return k === '(empty)' ? '_key' : k;
}

type SafeAuditPrimitive = string | number | boolean | null;
interface SafeAuditRecord {
  [key: string]: SafeAuditValue;
}
type SafeAuditValue = SafeAuditPrimitive | SafeAuditRecord;

function toSafeAuditValue(value: unknown, depth = 0): SafeAuditValue {
  if (depth > MAX_AUDIT_DEPTH) return '[max depth]';
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return sanitizeLogMessage(value, MAX_AUDIT_STRING_LEN);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return sanitizeLogMessage(value.toString(), 128);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    const out: SafeAuditRecord = {
      name: sanitizeLogMessage(value.name || 'Error', 128),
      message: sanitizeLogMessage(value.message, MAX_AUDIT_STRING_LEN)
    };
    if (typeof value.stack === 'string' && value.stack) {
      out['stack'] = sanitizeLogMessage(value.stack, MAX_AUDIT_STRING_LEN);
    }
    return out;
  }
  if (Array.isArray(value)) {
    const out: SafeAuditRecord = { kind: 'array', item_count: value.length };
    if (value.length > 0) out['first_item'] = toSafeAuditValue(value[0], depth + 1);
    return out;
  }
  if (typeof value === 'object') {
    const out: SafeAuditRecord = {};
    const entries = Object.entries(value as Record<string, unknown>);
    const limit = Math.min(entries.length, MAX_AUDIT_KEYS);
    for (let i = 0; i < limit; i++) {
      const entry = entries[i];
      if (!entry) continue;
      const [k, v] = entry;
      out[sanitizeBindingKey(k)] = toSafeAuditValue(v, depth + 1);
    }
    if (entries.length > MAX_AUDIT_KEYS) out['_omitted_key_count'] = entries.length - MAX_AUDIT_KEYS;
    return out;
  }
  return sanitizeLogMessage(String(value), 256);
}

/** Convert arbitrary bindings to a safe audit-only shape before any file write. */
function sanitizeBindingsForAudit(bindings: Record<string, unknown>): SafeAuditRecord {
  const safe = toSafeAuditValue(bindings);
  return (safe !== null && typeof safe === 'object' && !Array.isArray(safe)) ? safe as SafeAuditRecord : {};
}

/**
 * Pino accepts arbitrary objects; JSON round-trip yields a plain data-only payload so no prototype
 * or unexpected getters reach the serializer (defense-in-depth for structured log sinks).
 */
function cloneSafeRecordForPino(record: SafeAuditRecord): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
  } catch {
    return { category: 'error', log_clone_failed: true };
  }
}

function maybeWriteAuditLine(level: 'info' | 'warn' | 'error', bindings: SafeAuditRecord): void {
  if (!auditLogStream) return;
  try {
    const line = buildAuditLine(level, bindings);
    if (line && Buffer.byteLength(line, 'utf8') <= MAX_AUDIT_LINE_BYTES) auditLogStream.write(line);
  } catch {
    // Never fail request path because audit side-stream write fails.
  }
}

// Public audit write API for modules outside this file. No-ops when AUDIT_LOG_FILE is unset.
export function writeAuditLine(level: 'info' | 'warn' | 'error', bindings: Record<string, unknown>): void {
  if (!auditLogStream) return;
  maybeWriteAuditLine(level, sanitizeBindingsForAudit(bindings));
}
// HTTP logging middleware
const httpLogger = (req: Request, res: Response, next: Function): void => {
  const start = Date.now();
  const startTime = new Date().toISOString();
  const requestId = (req.headers['x-request-id'] as string) || `req-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  (req as Request & { requestId?: string }).requestId = requestId;

  const startBindings = sanitizeBindingsForAudit({
    time: startTime,
    http: { method: req.method, path: req.url, protocol: `HTTP/${req.httpVersion}` },
    client: { ip: getClientIp(req) },
    user_agent: req.headers['user-agent'],
    request_id: requestId
  });
  baseLogger.info(cloneSafeRecordForPino(startBindings), 'HTTP request received');

  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusCode = (res as Response & { statusCode?: number }).statusCode ?? 500;
    const methodName = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    const rid = (req as Request & { requestId?: string }).requestId ?? req.headers['x-request-id'];
    const finishBindings = sanitizeBindingsForAudit({
      time: new Date().toISOString(),
      http: { method: req.method, path: req.url, protocol: `HTTP/${req.httpVersion}` },
      status: statusCode,
      response_time_ms: duration,
      client: { ip: getClientIp(req) },
      user_agent: req.headers['user-agent'],
      request_id: rid
    });
    (baseLogger as pino.Logger)[methodName](cloneSafeRecordForPino(finishBindings), 'HTTP request completed');
  });

  next();
};

export type ToolOperation = 'search' | 'store' | 'update' | 'delete' | 'retrieve' | 'upsert' | 'rate';

export interface ErrorLogOptions {
  error_code?: string;
  request_id?: string;
  [key: string]: unknown;
}

export interface StructuredLoggerApi {
  debug(message: string): void;
  debug(bindings: Record<string, unknown>, message: string): void;
  info(message: string): void;
  info(bindings: Record<string, unknown>, message: string): void;
  warn(message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
  error(message: string, error?: Error | unknown): void;
  error(message: string, error: Error | unknown, options: ErrorLogOptions): void;
  tool(toolName: string, operation: ToolOperation, details: string): void;
  success(operation: string, details: string): void;
  requestTimeout(operation: string, timeoutMs: number): void;
  getTransportType(): 'stdio' | 'http';
  getLogFormat(): 'text' | 'json';
  getPinoLogger(): pino.Logger;
  child(bindings: Record<string, unknown>): StructuredLoggerApi;
}

function wrapPino(pinoInstance: pino.Logger): StructuredLoggerApi {
  const includeStack = LOG_LEVEL === 'debug' || process.env['NODE_ENV'] === 'development';
  return {
    // Keep free-form log text on one auditable sanitization path for every sink.
    debug(msgOrBindings: string | Record<string, unknown>, message?: string): void {
      if (typeof msgOrBindings === 'string') {
        const bindings = sanitizeBindingsForAudit({ category: 'debug' });
        const safeMsg = sanitizeLogMessage(msgOrBindings);
        pinoInstance.debug(cloneSafeRecordForPino(bindings), safeMsg.replace(/[\r\n]/g, ''));
        return;
      }
      const existingCategory = typeof msgOrBindings['category'] === 'string'
        ? msgOrBindings['category']
        : undefined;
      const rawBindings = existingCategory
        ? { ...msgOrBindings }
        : { ...msgOrBindings, category: 'debug' };
      const safeBindings = sanitizeBindingsForAudit(rawBindings);
      const safeMsg = sanitizeLogMessage(message ?? '');
      pinoInstance.debug(cloneSafeRecordForPino(safeBindings), safeMsg.replace(/[\r\n]/g, ''));
    },

    info(msgOrBindings: string | Record<string, unknown>, message?: string): void {
      if (typeof msgOrBindings === 'string') {
        const bindings = sanitizeBindingsForAudit({ category: 'info' });
        const safeMsg = sanitizeLogMessage(msgOrBindings);
        pinoInstance.info(cloneSafeRecordForPino(bindings), safeMsg.replace(/[\r\n]/g, ''));
        maybeWriteAuditLine('info', bindings);
      } else {
        const existingCategory = typeof msgOrBindings['category'] === 'string'
          ? msgOrBindings['category']
          : undefined;
        const rawBindings = existingCategory
          ? { ...msgOrBindings }
          : { ...msgOrBindings, category: 'info' };
        const bindings = sanitizeBindingsForAudit(rawBindings);
        const finalMessage = sanitizeLogMessage(message ?? '');
        pinoInstance.info(cloneSafeRecordForPino(bindings), finalMessage.replace(/[\r\n]/g, ''));
        maybeWriteAuditLine('info', bindings);
      }
    },

    warn(msgOrBindings: string | Record<string, unknown>, message?: string): void {
      if (typeof msgOrBindings === 'string') {
        const bindings = sanitizeBindingsForAudit({ category: 'warning' });
        const safeMsg = sanitizeLogMessage(msgOrBindings);
        pinoInstance.warn(cloneSafeRecordForPino(bindings), safeMsg.replace(/[\r\n]/g, ''));
        maybeWriteAuditLine('warn', bindings);
        return;
      }
      const existingCategory = typeof msgOrBindings['category'] === 'string'
        ? msgOrBindings['category']
        : undefined;
      const rawBindings = existingCategory
        ? { ...msgOrBindings }
        : { ...msgOrBindings, category: 'warning' };
      const bindings = sanitizeBindingsForAudit(rawBindings);
      const finalMessage = sanitizeLogMessage(message ?? '');
      pinoInstance.warn(cloneSafeRecordForPino(bindings), finalMessage.replace(/[\r\n]/g, ''));
      maybeWriteAuditLine('warn', bindings);
    },

    error(message: string, error?: Error | unknown, options?: ErrorLogOptions): void {
      const rawBindings: Record<string, unknown> = { category: 'error' };
      if (options && options['error_code']) rawBindings['error_code'] = options['error_code'];
      if (options && options['request_id']) rawBindings['request_id'] = options['request_id'];
      if (options) {
        Object.keys(options).forEach(k => {
          if (k !== 'error_code' && k !== 'request_id') rawBindings[k] = (options as Record<string, unknown>)[k];
        });
      }
      if (error) {
        rawBindings['error'] = error instanceof Error
          ? { message: error.message, stack: includeStack ? error.stack : undefined }
          : error;
      }
      const bindings = sanitizeBindingsForAudit(rawBindings);
      const safeMessage = sanitizeLogMessage(message);
      pinoInstance.error(cloneSafeRecordForPino(bindings), safeMessage.replace(/[\r\n]/g, ''));
      maybeWriteAuditLine('error', bindings);
    },

    tool(toolName: string, operation: ToolOperation, details: string): void {
      const msg = sanitizeLogMessage(`[${toolName}] ${operation.toUpperCase()} ${details}`);
      const bindings = sanitizeBindingsForAudit({
        tool: toolName,
        operation: operation.toUpperCase(),
        details,
        category: 'tool_operation'
      });
      pinoInstance.info(cloneSafeRecordForPino(bindings), msg.replace(/[\r\n]/g, ''));
    },

    success(operation: string, details: string): void {
      const bindings = sanitizeBindingsForAudit({ operation, details, category: 'success' });
      const msg = sanitizeLogMessage(`[${operation}] ${details}`);
      pinoInstance.info(cloneSafeRecordForPino(bindings), msg.replace(/[\r\n]/g, ''));
    },

    requestTimeout(operation: string, timeoutMs: number): void {
      const bindings = sanitizeBindingsForAudit({
        operation,
        timeoutMs,
        category: 'timeout',
        note: 'Client did not receive response'
      });
      pinoInstance.error(cloneSafeRecordForPino(bindings), 'Request timeout');
    },

    getTransportType(): 'stdio' | 'http' {
      return TRANSPORT_TYPE;
    },

    getLogFormat(): 'text' | 'json' {
      return LOG_FORMAT === 'json' ? 'json' : 'text';
    },

    getPinoLogger(): pino.Logger {
      return pinoInstance;
    },

    child(bindings: Record<string, unknown>): StructuredLoggerApi {
      return wrapPino(pinoInstance.child(bindings));
    }
  };
}

const structuredLogger = wrapPino(baseLogger);

export {
  structuredLogger,
  structuredLogger as logger,
  httpLogger,
  getClientIp,
  sanitizeLogMessage,
  sanitizeBindingsForAudit,
  buildAuditLine
};
export type { Request, Response };
