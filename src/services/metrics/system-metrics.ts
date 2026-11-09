import { Gauge } from '@prometheus-io/client';
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

// Update uptime periodically. `unref()` keeps this refresh from being the only
// thing holding the event loop open, so a short-lived process (CLI, test
// harness) can still exit naturally; a serving process is held open by its
// listener, not by this timer.
const systemMetricsTimer = setInterval(() => {
  systemUptime.set(process.uptime());
  
  const memUsage = process.memoryUsage();
  systemMemoryUsage.set({ type: 'rss' }, memUsage.rss);
  systemMemoryUsage.set({ type: 'heapTotal' }, memUsage.heapTotal);
  systemMemoryUsage.set({ type: 'heapUsed' }, memUsage.heapUsed);
}, 5000); // Update every 5 seconds
systemMetricsTimer.unref();





