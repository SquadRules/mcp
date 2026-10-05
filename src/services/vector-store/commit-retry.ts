/**
 * Bounded optimistic-concurrency retry for embedded vector-store commits.
 *
 * Lance/LanceDB use MVCC: concurrent writers to the same table version can
 * conflict and the loser must re-read the latest manifest and re-issue the
 * write. At the target scale (2-3 local processes) conflicts are rare, so this
 * is a defensive layer, not the primary safety mechanism. Non-conflict errors
 * are surfaced unchanged - a commit must never be silently dropped or routed to
 * a different store.
 */
import { logger } from '../../utils/structured-logger.js';

export interface CommitRetryOptions {
  /** Total attempts including the first. Default 8. */
  maxAttempts?: number;
  /** Base backoff in ms (doubles per attempt). Default 20. */
  baseDelayMs?: number;
  /** Cap for the exponential term before jitter. Default 1000. */
  maxDelayMs?: number;
}

const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_BASE_DELAY_MS = 20;
const DEFAULT_MAX_DELAY_MS = 1000;

/**
 * True when an error looks like a Lance/LanceDB commit conflict (safe to retry)
 * rather than a real failure. Matches the conflict/version wording emitted by
 * the format; refine against exact SDK messages as the adapter lands.
 */
export function isCommitConflictError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /commit conflict|version conflict|conflict during commit|committed version|compare-and-swap|\bCAS\b|transaction commit/i.test(
    msg,
  );
}

function delayFor(attempt: number, baseMs: number, maxMs: number): number {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  const jitter = Math.floor(Math.random() * (exp / 2));
  return exp + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `write`, retrying only commit conflicts with exponential backoff + jitter.
 * `label` names the operation for debug logs. Throws the first non-conflict
 * error immediately, and the last conflict error once attempts are exhausted.
 */
export async function withCommitRetry<T>(
  write: () => Promise<T>,
  label: string,
  options: CommitRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await write();
    } catch (err) {
      const lastAttempt = attempt === maxAttempts - 1;
      if (!isCommitConflictError(err) || lastAttempt) {
        throw err;
      }
      const waitMs = delayFor(attempt, baseDelayMs, maxDelayMs);
      logger.debug(
        `[vector-store] commit conflict on "${label}" (attempt ${attempt + 1}/${maxAttempts}); retrying in ${waitMs}ms`,
      );
      await sleep(waitMs);
    }
  }

  // Unreachable: the loop always returns or throws before exhausting attempts.
  throw new Error(`withCommitRetry("${label}") exited without a result`);
}
