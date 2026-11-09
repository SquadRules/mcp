import express from 'express';
import type { Server } from 'node:http';
import { register } from './services/metrics/registry.js';
import { structuredLogger } from './utils/structured-logger.js';
import { METRICS_PORT } from './config.js';
// Import system metrics to ensure they're initialized
import './services/metrics/system-metrics.js';

/**
 * Start dedicated metrics server on separate port.
 * 
 * This server ONLY exposes /metrics endpoint for Prometheus scraping.
 * 
 * Production benefits:
 * - Complete isolation from application traffic
 * - Can be restricted to internal networks only
 * - No impact on application performance
 * - Standard Prometheus deployment pattern
 *
 * Returns the listener so the shutdown handler can close it: a metrics socket that
 * is still accepting scrapes holds the event loop open, which would keep the
 * process alive after SIGTERM.
 */
export function startMetricsServer(port: number = METRICS_PORT): Server {
  const app = express();
  
  // ONLY route: /metrics endpoint
  app.get('/metrics', async (req, res) => {
    try {
      res.set('Content-Type', register.contentType);
      const metrics = await register.metrics();
      res.end(metrics);
    } catch (error) {
      structuredLogger.error('Error generating metrics', error);
      res.status(500).end('Error generating metrics');
    }
  });
  
  // Health check for metrics server (optional but recommended)
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', service: 'metrics' });
  });
  
  return app.listen(port, () => {
    structuredLogger.info(`Metrics server listening on port ${port}`);
    structuredLogger.info(`Metrics endpoint: http://localhost:${port}/metrics`);
  });
}

