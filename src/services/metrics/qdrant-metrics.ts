// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import { Counter, Histogram } from 'prom-client';
import { register } from './registry.js';


/**
 * Qdrant Vector Database Metrics
 * 
 * Tracks Qdrant operations, connection status, and performance.
 */

export const qdrantOperations = new Counter({
  name: 'kairos_qdrant_operations_total',
  help: 'Total number of Qdrant operations',
  labelNames: ['operation', 'status', 'tenant_id'],
  registers: [register]
});

export const qdrantOperationDuration = new Histogram({
  name: 'kairos_qdrant_operation_duration_seconds',
  help: 'Qdrant operation duration in seconds',
  labelNames: ['operation', 'tenant_id'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register]
});

export const qdrantQueryDuration = new Histogram({
  name: 'kairos_qdrant_query_duration_seconds',
  help: 'Qdrant query execution duration in seconds',
  labelNames: ['tenant_id'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register]
});

export const qdrantUpsertDuration = new Histogram({
  name: 'kairos_qdrant_upsert_duration_seconds',
  help: 'Qdrant upsert operation duration in seconds',
  labelNames: ['tenant_id'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register]
});

