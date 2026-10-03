import { Counter, Histogram } from 'prom-client';
import { register } from './registry.js';


/**
 * Agent Performance Metrics
 * 
 * Tracks AI agent contributions, implementation success rates, and bonuses.
 * Replaces old "game stats" with proper Prometheus metrics.
 */

export const agentContributions = new Counter({
  name: 'squadrules_agent_contributions_total',
  help: 'Total number of knowledge contributions by agent',
  labelNames: ['agent_id', 'quality', 'tenant_id'],
  registers: [register]
});

export const agentImplementationBonus = new Counter({
  name: 'squadrules_agent_implementation_bonus_total',
  help: 'Total implementation bonus points by agent',
  labelNames: ['agent_id', 'tenant_id'],
  registers: [register]
});

export const agentRareSuccesses = new Counter({
  name: 'squadrules_agent_rare_successes_total',
  help: 'Total rare success events by agent',
  labelNames: ['agent_id', 'tenant_id'],
  registers: [register]
});

export const agentQualityScore = new Histogram({
  name: 'squadrules_agent_quality_score',
  help: 'Distribution of quality scores by agent',
  labelNames: ['agent_id', 'quality_tier', 'tenant_id'],
  buckets: [0, 5, 10, 15, 20, 25, 30, 35, 40],
  registers: [register]
});








