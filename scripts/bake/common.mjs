/**
 * Constants and tiny helpers shared by every production-bake module.
 *
 * One home for the paths, timeouts, and log markers the bake asserts, so the two
 * backends and the orchestrator cannot drift on what a passing boot looks like.
 */
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

/** Repository root, two levels above `scripts/bake/`. */
export const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');

/** The shipped entrypoint: the file Docker and `squadrules serve` both run. */
export const SHIPPED_ENTRY = join(REPO_ROOT, 'dist', 'bootstrap.js');

/** The bundled adapter boot injection system-seeds into the app space — the fork source. */
export const FORK_SOURCE = 'squadrules://adapter/critic-loop';

export const HEALTH_TIMEOUT_MS = 300_000;
export const REQUEST_TIMEOUT_MS = 120_000;
export const STOP_TIMEOUT_MS = 60_000;

export const SIGTERM_MARKER = 'Received SIGTERM, shutting down';
export const LAST_RESORT_MARKER = 'shutdown: last-resort exit';
export const NATIVE_ABORT_MARKER = 'mutex lock failed';
export const EMBEDDED_READY_MARKER = 'graph db: ready (embedded)';
export const ARANGO_READY_MARKER = 'graph db: arango';
export const ARANGO_DEGRADED_MARKER = 'no embedded fallback is used';

export const delay = (ms) => new Promise((done) => setTimeout(done, ms));

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** Argument errors are the harness failing to run (exit 2), never a bake step. */
export function fail(message) {
  process.stderr.write(`production bake: ${message}\n`);
  process.exit(2);
}
