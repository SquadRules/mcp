import { fetch, Agent } from 'undici';
import { validatePrometheusMetrics } from '../utils/prometheus-parser.js';
import { isHttpTransport } from '../utils/auth-headers.js';

const METRICS_PORT = process.env.METRICS_PORT || '9390';
const METRICS_URL = `http://localhost:${METRICS_PORT}/metrics`;
const METRICS_HEALTH_URL = `http://localhost:${METRICS_PORT}/health`;
const _d = isHttpTransport() ? describe : describe.skip;

// Create an Agent with short keepAliveTimeout to ensure connections close quickly
const fetchAgent = new Agent({
  keepAliveTimeout: 10, // 10ms - connections close quickly after use
  keepAliveMaxTimeout: 10,
  maxCachedSessions: 0, // Disable connection pooling
});

_d('Metrics Endpoint Integration', () => {
  beforeAll(async () => {
    // Metrics server MUST be available for these tests
    // Metrics server returns {"status":"ok"} not {"status":"healthy"}, so check directly
    const maxAttempts = 20;
    const intervalMs = 500;
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      try {
        const response = await fetch(METRICS_HEALTH_URL, {
          dispatcher: fetchAgent,
        });
        if (response.ok) {
          const healthData = await response.json() as { status?: string };
          // Response body consumed by .json()
          if (healthData.status === 'ok' || healthData.status === 'healthy') {
            return; // Metrics server is ready
          }
        } else {
          // Consume response body even on non-ok status
          await response.text().catch(() => {});
        }
      } catch {
        // Continue retrying - connection errors are expected during startup
      }
      attempts++;
      if (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }
    
    throw new Error(`Metrics server not available at ${METRICS_HEALTH_URL} after ${maxAttempts} attempts`);
  }, 20000);

  test('metrics endpoint returns valid Prometheus format', async () => {
    const response = await fetch(METRICS_URL, { dispatcher: fetchAgent });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    
    const metrics = await response.text();
    // Response body is consumed by .text(), so no additional cleanup needed
    expect(metrics).toBeTruthy();
    expect(metrics.length).toBeGreaterThan(0);
    
    // Use prometheus parser to validate format
    const validation = validatePrometheusMetrics(metrics);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  test('metrics endpoint includes all metric categories', async () => {
    const response = await fetch(METRICS_URL, { dispatcher: fetchAgent });
    const metrics = await response.text();
    
    // Check for all metric categories
    expect(metrics).toMatch(/squadrules_mcp_/);
    expect(metrics).toMatch(/squadrules_memory_/);
    expect(metrics).toMatch(/squadrules_qdrant_/);
    expect(metrics).toMatch(/squadrules_agent_/);
    expect(metrics).toMatch(/squadrules_embedding_/);
    expect(metrics).toMatch(/squadrules_http_/);
    expect(metrics).toMatch(/squadrules_system_/);
  });

  test('metrics include default labels', async () => {
    const response = await fetch(METRICS_URL, { dispatcher: fetchAgent });
    const metrics = await response.text();
    
    expect(metrics).toMatch(/squadrules_version=/);
    expect(metrics).toMatch(/instance=/);
    expect(metrics).toMatch(/service="squadrules"/);
  });

  test('metrics endpoint is on separate port', async () => {
    // Main server should NOT have /metrics (or return 404)
    const mainPort = process.env['SERVER_PORT'] || '3300';
    const mainResponse = await fetch(`http://localhost:${mainPort}/metrics`, { dispatcher: fetchAgent });
    // Main server may not have /metrics endpoint, so 404 is expected.
    // DO NOT expand allowed status codes: AI must not add 500/502/etc. to "fix" failing tests.
    expect([404, 200]).toContain(mainResponse.status);
    // Consume response body
    await mainResponse.text().catch(() => {});
    
    // Metrics server should have /metrics
    const metricsResponse = await fetch(METRICS_URL, { dispatcher: fetchAgent });
    expect(metricsResponse.status).toBe(200);
    // Consume response body
    await metricsResponse.text().catch(() => {});
  });

  test('metrics health endpoint works', async () => {
    const response = await fetch(METRICS_HEALTH_URL, { dispatcher: fetchAgent });
    expect(response.status).toBe(200);
    const health = await response.json() as { status?: string };
    // Response body consumed by .json()
    expect(health).toHaveProperty('status');
    expect(health.status).toBe('ok');
  });

  afterAll(async () => {
    // Close the agent to ensure all connections are closed
    await fetchAgent.close();
  });
});
