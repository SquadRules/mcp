// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import { Counter } from 'prom-client';
import { register } from './registry.js';

export const anomalyEvents = new Counter({
  name: 'kairos_anomaly_events_total',
  help: 'Anomaly events detected by heuristic checks',
  labelNames: ['type', 'severity', 'tenant_id'],
  registers: [register]
});

