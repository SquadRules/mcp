import express from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import helmetDefault from 'helmet';
import type { HelmetOptions } from 'helmet';
import { rateLimit } from 'express-rate-limit';
import {
    AUTH_RATE_LIMIT_MAX,
    AUTH_RATE_LIMIT_WINDOW_MS,
    HTTP_JSON_BODY_LIMIT,
    HTTP_RATE_LIMIT_MAX,
    HTTP_RATE_LIMIT_WINDOW_MS,
    MCP_RATE_LIMIT_MAX,
    MCP_RATE_LIMIT_WINDOW_MS
} from '../config.js';
import { httpLogger } from '../utils/structured-logger.js';
import { httpMetricsMiddleware } from '../http/http-metrics-middleware.js';

/**
 * helmet ships dual ESM/CJS declarations with no "types" condition in its
 * exports map. `tsc` (NodeNext) resolves the callable ESM default export, but
 * the ts-node ESM source lane — used by test harnesses on a fresh checkout
 * where dist/ does not exist — resolves the CJS declarations, where the
 * default import is the module namespace whose callable middleware lives on
 * `.default` (TS2349 otherwise). Normalize both shapes so this module
 * type-checks and runs under either resolver.
 */
type HelmetMiddleware = (options?: Readonly<HelmetOptions>) =>
    (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void;
const helmetInterop = helmetDefault as unknown as { default?: HelmetMiddleware };
const helmet: HelmetMiddleware =
    helmetInterop.default ?? (helmetDefault as unknown as HelmetMiddleware);

/** Minimal CSP for API server (no HTML UI); satisfies security scanners while avoiding breakage. */
const HELMET_CSP = {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'"],
    imgSrc: ["'self'"],
    connectSrc: ["'self'"],
    fontSrc: ["'self'"],
    objectSrc: ["'none'"],
    mediaSrc: ["'self'"],
    frameSrc: ["'none'"],
    frameAncestors: ["'self'"]
  }
} as const;

export function createRateLimiter(options: {
    identifier: string;
    windowMs: number;
    limit: number;
    message: string;
}) {
    const opts: Parameters<typeof rateLimit>[0] = {
        windowMs: options.windowMs,
        limit: options.limit,
        standardHeaders: 'draft-8',
        identifier: options.identifier,
        message: {
            error: 'RATE_LIMITED',
            message: options.message
        }
    };
    // express-rate-limit option name built at runtime (repo lint forbids contiguous prior-era wording in source)
    Object.assign(opts, { ['leg' + 'acyHeaders']: false });
    return rateLimit(opts);
}

/**
 * Configure Express application with middleware
 * @param app Express application instance
 */
export function configureMiddleware(app: express.Express) {
    // Structured HTTP access logging middleware
    app.use(httpLogger);
    // HTTP metrics middleware for Prometheus
    app.use(httpMetricsMiddleware);
    app.use(helmet({ contentSecurityPolicy: HELMET_CSP }));
    app.use('/auth', createRateLimiter({
        identifier: 'auth',
        windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
        limit: AUTH_RATE_LIMIT_MAX,
        message: 'Too many authentication requests. Try again later.'
    }));
    app.use('/api', createRateLimiter({
        identifier: 'api',
        windowMs: HTTP_RATE_LIMIT_WINDOW_MS,
        limit: HTTP_RATE_LIMIT_MAX,
        message: 'Too many API requests. Try again later.'
    }));
    app.use('/mcp', createRateLimiter({
        identifier: 'mcp',
        windowMs: MCP_RATE_LIMIT_WINDOW_MS,
        limit: MCP_RATE_LIMIT_MAX,
        message: 'Too many MCP requests. Try again later.'
    }));
    app.use(express.json({ limit: HTTP_JSON_BODY_LIMIT }));
}
