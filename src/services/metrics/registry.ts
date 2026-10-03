import { Registry } from 'prom-client';
import { getBuildVersion } from '../../utils/build-version.js';
import os from 'os';

/**
 * Prometheus metrics registry for SQUADRULES.
 * 
 * All metrics are registered here and exposed via /metrics endpoint.
 * Default labels are automatically applied to all metrics.
 */
export const register = new Registry();

// Set mandatory default labels on all metrics
register.setDefaultLabels({
  service: 'squadrules',
  squadrules_version: getBuildVersion(),
  instance: process.env['INSTANCE_ID'] || os.hostname() || 'unknown'
});

// Note: tenant_id is NOT a default label - it must be set per-metric
// based on request context to ensure proper tenant isolation

