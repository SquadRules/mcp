/**
 * Shared Pino-based logging core for SQUADRULES MCP.
 * Single source of truth for LOG_LEVEL, LOG_FORMAT, TRANSPORT_TYPE.
 * Used by both logger.ts and structured-logger.ts so JSON shape is identical.
 */

import pino from 'pino';
import type { Request, Response } from 'express';
import { Writable } from 'stream';
import { LOG_LEVEL, LOG_FORMAT, TRANSPORT_TYPE } from '../config.js';

const REDACT_PATHS = [
  'req.headers.authorization',
  '*.password',
  '*.secret',
  'user.ssn',
  'req.headers.cookie',
  'res.headers["set-cookie"]'
];

function textFormatStream(transportType: 'stdio' | 'http'): Writable {
  const out = transportType === 'stdio' ? process.stderr : process.stdout;
  return new Writable({
    write(chunk: Buffer, _enc, cb) {
      try {
        const line = chunk.toString();
        if (!line.trim()) {
          cb();
          return;
        }
        const data = JSON.parse(line) as Record<string, unknown>;
        const time = typeof data['time'] === 'string' ? data['time'].slice(11, 19) : '00:00:00';
        const level = (String(data['level'] ?? 'info')).toUpperCase().padEnd(7);
        const msg = (data['msg'] ?? '').toString();
        out.write(`[${time}] [${level}] ${msg}\n`);
      } catch {
        out.write(chunk.toString());
      }
      cb();
    }
  });
}

function createBaseLogger(): pino.Logger {
  const dest = LOG_FORMAT === 'text'
    ? textFormatStream(TRANSPORT_TYPE)
    : TRANSPORT_TYPE === 'stdio'
      ? process.stderr
      : process.stdout;

  const serializers: Record<string, pino.SerializerFn> = {
    req(req: Request) {
      return {
        method: req?.method,
        url: req?.url,
        headers: {
          'user-agent': req?.headers?.['user-agent'],
          'x-request-id': req?.headers?.['x-request-id']
        }
      };
    },
    res(res: Response) {
      return { statusCode: res?.statusCode };
    }
  };

  return pino({
    level: LOG_LEVEL,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    serializers
  }, dest);
}

let baseLoggerInstance: pino.Logger | null = null;

/**
 * Returns the shared Pino logger. Creates it on first call.
 */
export function getBaseLogger(): pino.Logger {
  if (!baseLoggerInstance) {
    baseLoggerInstance = createBaseLogger();
  }
  return baseLoggerInstance;
}
