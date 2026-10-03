import { Gauge } from 'prom-client';
import { register } from './registry.js';

/**
 * System Metrics
 * 
 * Tracks application uptime, memory usage, and CPU usage.
 */

export const systemUptime = new Gauge({
  name: 'squadrules_system_uptime_seconds',
  help: 'Application uptime in seconds',
  registers: [register]
});

export const systemMemoryUsage = new Gauge({
  name: 'squadrules_system_memory_usage_bytes',
  help: 'System memory usage in bytes',
  labelNames: ['type'],
  registers: [register]
});

export const systemProcessStartTime = new Gauge({
  name: 'squadrules_system_process_start_time_seconds',
  help: 'Process start timestamp (Unix epoch)',
  registers: [register]
});

// Initialize system metrics
const processStartTime = Date.now() / 1000;
systemProcessStartTime.set(processStartTime);

// Update uptime periodically
setInterval(() => {
  systemUptime.set(process.uptime());
  
  const memUsage = process.memoryUsage();
  systemMemoryUsage.set({ type: 'rss' }, memUsage.rss);
  systemMemoryUsage.set({ type: 'heapTotal' }, memUsage.heapTotal);
  systemMemoryUsage.set({ type: 'heapUsed' }, memUsage.heapUsed);
}, 5000); // Update every 5 seconds





