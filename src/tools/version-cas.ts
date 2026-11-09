/**
 * Compare-and-swap guard for adapter writes (ADR 0045).
 *
 * The store has no multi-statement transaction, so a CAS is a **pre-write head
 * check**: the caller names the adapter version it read, and the write proceeds
 * only while that is still the stored version. A conflict fails closed with an
 * actionable code — never a silent overwrite and never a partial history row.
 */
import type { Memory } from '../types/memory.js';

/** Raised when the stored adapter version no longer matches the caller's expectation. */
export class VersionConflictError extends Error {
  readonly code = 'VERSION_CONFLICT';

  constructor(
    message: string,
    readonly details: { target: string; expected: string; actual: string }
  ) {
    super(message);
    this.name = 'VersionConflictError';
  }
}

/**
 * Raised when a caller asked for a version guard that cannot be evaluated.
 *
 * This is the fail-closed answer for a target whose stored version is unknown (a layer
 * that is not a stored member of a resolvable adapter, or no row at all). Silently
 * writing without the guard would report a protection the caller did not get.
 */
export class VersionGuardUnsupportedError extends Error {
  readonly code = 'VERSION_GUARD_UNSUPPORTED';

  constructor(
    message: string,
    readonly details: { target: string; expected: string; reason: string }
  ) {
    super(message);
    this.name = 'VersionGuardUnsupportedError';
  }
}

/** The two ways a version guard can fail the write. */
export type VersionGuardCode = 'VERSION_CONFLICT' | 'VERSION_GUARD_UNSUPPORTED';

/** Machine-readable form of a failed version guard, carried next to the human message. */
export interface VersionGuardPayload {
  code: VersionGuardCode;
  target: string;
  expected: string;
  /** Stored version the write lost to (set only for `VERSION_CONFLICT`). */
  current?: string;
  /** Why the guard could not be evaluated (set only for `VERSION_GUARD_UNSUPPORTED`). */
  reason?: string;
}

/**
 * Structured conflict facts, or `undefined` for an error that is not a version guard.
 *
 * Callers keep the prose `message` for the human and this payload for the machine, so a
 * transport never has to parse the code and versions back out of a sentence.
 */
export function versionGuardPayload(error: unknown): VersionGuardPayload | undefined {
  if (error instanceof VersionConflictError) {
    return {
      code: error.code,
      target: error.details.target,
      expected: error.details.expected,
      current: error.details.actual
    };
  }
  if (error instanceof VersionGuardUnsupportedError) {
    return {
      code: error.code,
      target: error.details.target,
      expected: error.details.expected,
      reason: error.details.reason
    };
  }
  return undefined;
}

/** Semantic version carried by a stored adapter head, or `0.0.0` when none was recorded. */
export function adapterVersionOf(layer: Memory | undefined): string {
  const protocolVersion = layer?.adapter?.protocol_version;
  if (typeof protocolVersion === 'string' && protocolVersion.trim().length > 0) {
    return protocolVersion.trim();
  }
  const frontmatter = layer?.adapter?.frontmatter;
  const version = frontmatter && typeof frontmatter === 'object' ? frontmatter['version'] : undefined;
  return typeof version === 'string' && version.trim().length > 0 ? version.trim() : '0.0.0';
}

/**
 * Fail closed unless `expected` equals `actual`.
 *
 * `expected` is optional: absent means "no CAS requested", which is how every
 * ordinary write behaves.
 */
export function assertExpectedVersion(
  target: string,
  expected: string | undefined,
  actual: string
): void {
  const wanted = typeof expected === 'string' ? expected.trim() : '';
  if (wanted.length === 0) return;
  if (wanted === actual) return;
  throw new VersionConflictError(
    `VERSION_CONFLICT: ${target} is at version ${actual}, but this write expects ${wanted}. ` +
      'Re-read the adapter (export it again) and re-apply the change to the current version; ' +
      'nothing was written.',
    { target, expected: wanted, actual }
  );
}
