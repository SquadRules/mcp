// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import { Counter, Histogram } from 'prom-client';
import { register } from './registry.js';


/**
 * Memory Operation Metrics
 * 
 * Tracks memory store, retrieve, search, update, and delete operations.
 */

export const memoryStore = new Counter({
  name: 'kairos_memory_store_total',
  help: 'Total number of memories stored',
  labelNames: ['quality', 'tenant_id'],
  registers: [register]
});

export const memoryStoreDuration = new Histogram({
  name: 'kairos_memory_store_duration_seconds',
  help: 'Memory storage operation duration in seconds',
  labelNames: ['quality', 'tenant_id'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register]
});

export const memoryAdapterSize = new Histogram({
  name: 'kairos_memory_adapter_size',
  help: 'Number of layers in stored adapters',
  labelNames: ['tenant_id'],
  buckets: [1, 2, 3, 4, 5, 10, 15, 20, 25, 50],
  registers: [register]
});





