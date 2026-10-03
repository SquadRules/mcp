// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import { Counter, Histogram } from 'prom-client';
import { register } from './registry.js';

/**
 * Export path observability (HTTP + MCP both call {@link executeExport}).
 * Use dashboards/alerts on duration and ZIP size to spot Qdrant/assemble/zip bottlenecks.
 */

export const exportDurationSeconds = new Histogram({
  name: 'kairos_export_duration_seconds',
  help: 'Wall-clock time for executeExport (storage reads, assemble, zip, encode)',
  labelNames: ['format', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
  registers: [register]
});

export const exportRequestsTotal = new Counter({
  name: 'kairos_export_requests_total',
  help: 'Export invocations by format and outcome',
  labelNames: ['format', 'status'],
  registers: [register]
});

export const exportAdapterCount = new Histogram({
  name: 'kairos_export_adapter_count',
  help: 'Adapters included in export (skill_tree, skill_zip, or item_count for others)',
  labelNames: ['format'],
  buckets: [1, 2, 3, 5, 10, 25, 50, 100, 256],
  registers: [register]
});

/** Decoded application/zip byte length before base64 (skill_zip only). */
export const exportSkillZipDecodedBytes = new Histogram({
  name: 'kairos_export_skill_zip_decoded_bytes',
  help: 'Decoded ZIP size for skill_zip exports',
  labelNames: [],
  buckets: [
    10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 50_000_000
  ],
  registers: [register]
});

export function hrtimeSecondsSince(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e9;
}

export function recordExportMetrics(opts: {
  format: string;
  status: 'success' | 'error';
  durationSec: number;
  /** For skill_tree / skill_zip multi-adapter; or single-adapter exports with item_count */
  adapterCount?: number;
  /** Only when skill_zip succeeded and ZIP buffer was built */
  skillZipDecodedBytes?: number;
}): void {
  exportDurationSeconds.observe({ format: opts.format, status: opts.status }, opts.durationSec);
  exportRequestsTotal.inc({ format: opts.format, status: opts.status });
  if (opts.status === 'success' && opts.adapterCount != null && opts.adapterCount >= 0) {
    exportAdapterCount.observe({ format: opts.format }, opts.adapterCount);
  }
  if (opts.skillZipDecodedBytes != null && opts.skillZipDecodedBytes >= 0) {
    exportSkillZipDecodedBytes.observe(opts.skillZipDecodedBytes);
  }
}
