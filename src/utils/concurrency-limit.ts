/**
 * Resolves effective MAX_CONCURRENT_MCP_REQUESTS from env and (when 0) cgroup/memory.
 * Used at startup so the MCP handler can enforce a per-pod concurrency limit.
 */

import { readFileSync } from 'node:fs';
import os from 'node:os';
import { structuredLogger } from './structured-logger.js';

const PER_REQUEST_ESTIMATE_BYTES = 5 * 1024 * 1024; // 5 MB conservative estimate
const MEMORY_HEADROOM_FACTOR = 0.7;
const MIN_LIMIT = 10;

type ReadFileSyncFn = typeof readFileSync;

/** Default cgroup probes use Node’s readFileSync; tests swap via setCgroupReadFileSyncForTests. */
let readFileSyncForCgroup: ReadFileSyncFn = readFileSync;

/**
 * Override file reads used only by cgroup memory limit detection (unit tests).
 * Pass `null` to restore production behaviour.
 */
export function setCgroupReadFileSyncForTests(fn: ReadFileSyncFn | null): void {
  readFileSyncForCgroup = fn ?? readFileSync;
}

function readCgroupMemoryLimit(): number | null {
  // cgroups v2
  try {
    const raw = readFileSyncForCgroup('/sys/fs/cgroup/memory.max', 'utf8').trim();
    if (raw !== 'max') return parseInt(raw, 10);
  } catch {
    /* not available */
  }
  // cgroups v1
  try {
    const raw = readFileSyncForCgroup('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf8').trim();
    const val = parseInt(raw, 10);
    if (!Number.isNaN(val) && val < os.totalmem() * 2) return val; // ignore kernel "unlimited" sentinel
  } catch {
    /* not available */
  }
  return null;
}

function getAvailableCpus(): number {
  return typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length;
}

/**
 * Resolves the effective max concurrent MCP requests.
 * @param envValue - Raw env value: positive = override, -1 = disabled, 0 or unset = auto-detect
 * @returns Effective limit (number or Infinity when disabled)
 */
export function resolveMaxConcurrentRequests(envValue: number): number {
  if (envValue === -1) {
    structuredLogger.info('concurrency: disabled');
    return Infinity;
  }
  if (envValue > 0) {
    structuredLogger.info(`concurrency: ${envValue} (override)`);
    return envValue;
  }

  // Auto-detect
  const cgroupMem = readCgroupMemoryLimit();
  const totalMem = cgroupMem ?? os.totalmem();
  const cpus = getAvailableCpus();
  const baselineRss = process.memoryUsage().rss;
  const usable = totalMem * MEMORY_HEADROOM_FACTOR - baselineRss;
  const fromMemory = Math.floor(usable / PER_REQUEST_ESTIMATE_BYTES);
  const maxCpu = cpus * 50;
  const limit = Math.max(MIN_LIMIT, Math.min(fromMemory, maxCpu));

  structuredLogger.info(`concurrency: ${limit} (auto)`);

  return limit;
}
