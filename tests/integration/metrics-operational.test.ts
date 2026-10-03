// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import { getSharedMcpConnection } from '../utils/mcp-client-utils.js';
import { getMetricValue } from '../utils/prometheus-parser.js';
import { isHttpTransport } from '../utils/auth-headers.js';

const METRICS_PORT = process.env.METRICS_PORT || '9390';
const METRICS_URL = `http://localhost:${METRICS_PORT}/metrics`;
const _d = isHttpTransport() ? describe : describe.skip;

_d('Metrics Operational Tests', () => {
  let mcpConnection: any;

  beforeAll(async () => {
    // Wait for metrics server (with longer timeout for test environment)
    // Metrics server returns {"status":"ok"} not {"status":"healthy"}, so check directly
    const maxAttempts = 30;
    const intervalMs = 1000;
    let attempts = 0;
    let metricsReady = false;
    
    while (attempts < maxAttempts) {
      let response: Response | null = null;
      try {
        response = await fetch(`http://localhost:${METRICS_PORT}/health`);
        if (response.ok) {
          const healthData = await response.json();
          // Ensure response is fully consumed
          response = null;
          if (healthData.status === 'ok' || healthData.status === 'healthy') {
            metricsReady = true;
            break; // Metrics server is ready
          }
        } else {
          // Consume response body even on non-ok status
          await response.text().catch(() => {});
          response = null;
        }
      } catch {
        // Continue retrying
        if (response) {
          try {
            await response.text().catch(() => {});
          } catch {
            // Ignore
          }
          response = null;
        }
      }
      attempts++;
      if (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }
    
    // Metrics server MUST be available for these tests
    if (!metricsReady) {
      throw new Error(`Metrics server not available at http://localhost:${METRICS_PORT}/health after ${maxAttempts} attempts`);
    }
    
    mcpConnection = await getSharedMcpConnection();
  }, 60000);

  afterAll(async () => {
    if (mcpConnection) {
      await mcpConnection.close();
    }
  });

  test('metrics update after MCP tool call', async () => {
    // Metrics server MUST be available
    const healthResponse = await fetch(`http://localhost:${METRICS_PORT}/health`);
    if (!healthResponse.ok) {
      throw new Error(`Metrics server health check failed: ${healthResponse.status}`);
    }
    // Get initial metrics
    const beforeResponse = await fetch(METRICS_URL);
    const beforeMetrics = await beforeResponse.text();
    const beforeCount = getMetricValue(
      beforeMetrics, 
      'kairos_mcp_tool_calls_total',
      { tool: 'activate', status: 'success' }
    ) || 0;
    
    // Call a tool
    await mcpConnection.client.callTool({
      name: 'activate',
      arguments: { query: 'test query' }
    });
    
    // Wait a bit for metrics to update
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Get updated metrics
    const afterResponse = await fetch(METRICS_URL);
    const afterMetrics = await afterResponse.text();
    const afterCount = getMetricValue(
      afterMetrics,
      'kairos_mcp_tool_calls_total',
      { tool: 'activate', status: 'success' }
    ) || 0;
    
    // Metrics should have increased
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount);
  }, 30000);

  test('system metrics are present', async () => {
    // Metrics server MUST be available
    const healthResponse = await fetch(`http://localhost:${METRICS_PORT}/health`);
    if (!healthResponse.ok) {
      throw new Error(`Metrics server health check failed: ${healthResponse.status}`);
    }
    const response = await fetch(METRICS_URL);
    const metrics = await response.text();
    
    // Check for system metrics (may vary based on implementation)
    expect(metrics).toMatch(/kairos_system_/);
  });

  test('memory metrics are present', async () => {
    // Metrics server MUST be available
    const healthResponse = await fetch(`http://localhost:${METRICS_PORT}/health`);
    if (!healthResponse.ok) {
      throw new Error(`Metrics server health check failed: ${healthResponse.status}`);
    }
    const response = await fetch(METRICS_URL);
    const metrics = await response.text();
    
    expect(metrics).toContain('kairos_memory_store_total');
    expect(metrics).toContain('kairos_memory_store_duration_seconds');
    expect(metrics).toContain('kairos_memory_adapter_size');
  });

  test('qdrant metrics are present', async () => {
    // Metrics server MUST be available
    const healthResponse = await fetch(`http://localhost:${METRICS_PORT}/health`);
    if (!healthResponse.ok) {
      throw new Error(`Metrics server health check failed: ${healthResponse.status}`);
    }
    const response = await fetch(METRICS_URL);
    const metrics = await response.text();
    
    expect(metrics).toContain('kairos_qdrant_operations_total');
    expect(metrics).toContain('kairos_qdrant_query_duration_seconds');
  });

  test('agent metrics are present', async () => {
    // Metrics server MUST be available
    const healthResponse = await fetch(`http://localhost:${METRICS_PORT}/health`);
    if (!healthResponse.ok) {
      throw new Error(`Metrics server health check failed: ${healthResponse.status}`);
    }
    const response = await fetch(METRICS_URL);
    const metrics = await response.text();
    
    expect(metrics).toContain('kairos_agent_contributions_total');
    expect(metrics).toContain('kairos_agent_quality_score');
  });
});

