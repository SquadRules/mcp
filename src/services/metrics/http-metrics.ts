import { Counter, Histogram, Gauge } from 'prom-client';
import { register } from './registry.js';


/**
 * HTTP Server Metrics
 * 
 * Tracks HTTP requests, response times, and payload sizes.
 */

export const httpRequests = new Counter({
  name: 'squadrules_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status', 'tenant_id'],
  registers: [register]
});

export const httpRequestDuration = new Histogram({
  name: 'squadrules_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status', 'tenant_id'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register]
});

export const httpRequestSize = new Histogram({
  name: 'squadrules_http_request_size_bytes',
  help: 'HTTP request payload size in bytes',
  labelNames: ['method', 'route', 'tenant_id'],
  buckets: [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
  registers: [register]
});

export const httpResponseSize = new Histogram({
  name: 'squadrules_http_response_size_bytes',
  help: 'HTTP response payload size in bytes',
  labelNames: ['method', 'route', 'status', 'tenant_id'],
  buckets: [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
  registers: [register]
});

export const httpActiveConnections = new Gauge({
  name: 'squadrules_http_active_connections',
  help: 'Current number of active HTTP connections',
  labelNames: ['tenant_id'],
  registers: [register]
});





