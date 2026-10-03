import { Counter, Histogram } from 'prom-client';
import { register } from './registry.js';


/**
 * Embedding Service Metrics
 * 
 * Tracks embedding generation, provider usage, and performance.
 */

export const embeddingRequests = new Counter({
  name: 'squadrules_embedding_requests_total',
  help: 'Total number of embedding requests',
  labelNames: ['provider', 'status', 'tenant_id'],
  registers: [register]
});

export const embeddingDuration = new Histogram({
  name: 'squadrules_embedding_duration_seconds',
  help: 'Embedding generation duration in seconds',
  labelNames: ['provider', 'tenant_id'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register]
});

export const embeddingErrors = new Counter({
  name: 'squadrules_embedding_errors_total',
  help: 'Total number of embedding errors',
  labelNames: ['provider', 'status', 'tenant_id'],
  registers: [register]
});

export const embeddingVectorSize = new Histogram({
  name: 'squadrules_embedding_vector_size_bytes',
  help: 'Generated embedding vector size in bytes',
  labelNames: ['provider', 'tenant_id'],
  buckets: [100, 500, 1000, 2000, 5000, 10000, 20000, 50000],
  registers: [register]
});

export const embeddingBatchSize = new Histogram({
  name: 'squadrules_embedding_batch_size',
  help: 'Batch size for embedding processing',
  labelNames: ['tenant_id'],
  buckets: [1, 2, 5, 10, 25, 50, 100],
  registers: [register]
});



