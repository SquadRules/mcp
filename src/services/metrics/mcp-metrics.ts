// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import { Counter, Histogram } from 'prom-client';
import { register } from './registry.js';


/**
 * MCP Tool Metrics
 * 
 * Tracks all kairos_* tool invocations, duration, errors, and payload sizes.
 */

export const mcpToolCalls = new Counter({
  name: 'kairos_mcp_tool_calls_total',
  help: 'Total number of MCP tool invocations',
  labelNames: ['tool', 'status', 'tenant_id'],
  registers: [register]
});

export const mcpToolDuration = new Histogram({
  name: 'kairos_mcp_tool_duration_seconds',
  help: 'MCP tool execution duration in seconds',
  labelNames: ['tool', 'status', 'tenant_id'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register]
});

export const mcpToolErrors = new Counter({
  name: 'kairos_mcp_tool_errors_total',
  help: 'Total number of MCP tool execution errors',
  labelNames: ['tool', 'status', 'tenant_id'],
  registers: [register]
});

export const mcpToolInputSize = new Histogram({
  name: 'kairos_mcp_tool_input_size_bytes',
  help: 'MCP tool input payload size in bytes',
  labelNames: ['tool', 'tenant_id'],
  buckets: [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
  registers: [register]
});

export const mcpToolOutputSize = new Histogram({
  name: 'kairos_mcp_tool_output_size_bytes',
  help: 'MCP tool output payload size in bytes',
  labelNames: ['tool', 'tenant_id'],
  buckets: [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
  registers: [register]
});

/** Incremented when forward quality update (quality_metadata/metrics) fails. */
export const kairosQualityUpdateErrors = new Counter({
  name: 'kairos_quality_update_errors_total',
  help: 'Quality update failures in forward (log-and-continue path)',
  labelNames: ['tenant_id'],
  registers: [register]
});

/** Incremented when train returns SIMILAR_MEMORY_FOUND (MCP or HTTP). */
export const kairosTrainSimilarAdapterFound = new Counter({
  name: 'kairos_train_similar_adapter_found_total',
  help: 'Times train returned SIMILAR_MEMORY_FOUND (agent must inspect the similar adapter before deciding)',
  labelNames: ['transport', 'tenant_id'],
  registers: [register]
});