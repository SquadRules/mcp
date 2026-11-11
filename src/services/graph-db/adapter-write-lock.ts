/**
 * Per-adapter write serialization (ADR 0045 §4 concurrency contract).
 *
 * WHY THIS EXISTS
 * The protected region of an adapter write is read → validate → persist → append
 * history. The expected-version check only compares a version it read a moment
 * earlier, so two writers interleaving inside that region both pass the check and
 * both write: a precheck is not a CAS. This mutex is what makes the read and the
 * write of one adapter's history head indivisible inside a process.
 *
 * WHY A PROCESS-LOCAL MUTEX IS ENOUGH FOR THE EMBEDDED BACKEND
 * The embedded graph has exactly one writable owner per database file (a second
 * writable open is rejected by the file lock), so "concurrent writers" on that
 * backend are concurrent callers *in this process*. The lock orders them.
 *
 * WHAT IT DOES NOT COVER
 * A shared (Arango) deployment can have several processes appending history for
 * the same adapter. Those are protected by the durable monotonic optimistic
 * guard threaded into `appendVersion` (`expectedParentVersion`), not by this
 * mutex — a different mechanism with a different failure mode (a conflict, not a
 * wait). Neither mechanism is claimed to be a distributed lock.
 *
 * QUEUE SHAPE
 * One promise chain per key. A failing operation still releases its successor,
 * so one aborted write cannot wedge every later write of the same adapter.
 */

const tails = new Map<string, Promise<void>>();

/**
 * Lock identity for one adapter.
 *
 * Keyed on the stored adapter id, not on `(space, slug)`, because the id is the one
 * identity every write route agrees on: a space move changes `space_id` and a
 * rename would change the slug, but the same stored adapter keeps its id. That makes
 * a `train`, a markdown `tune`, a layer `update` and a move on the same adapter queue
 * behind each other instead of racing through four different keys.
 *
 * An empty id collapses to one key: over-serializing unrelated writes is slow, never
 * wrong, whereas inventing a per-call key would serialize nothing.
 */
export function adapterIdentityLockKey(adapterId: string): string {
  return `adapter-id\u0000${adapterId.trim()}`;
}

/**
 * Run `operation` while holding the lock for `key`.
 *
 * Calls for the same key run one at a time in submission order. Calls for
 * different keys never wait on each other. The returned promise settles with the
 * operation's own outcome — including a rejection — so callers see their own
 * error, not a queue artifact.
 */
export function withAdapterWriteLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  // `then(op, op)` on purpose: a rejected predecessor has already released its
  // slot, and its failure belongs to its own caller, not to this one.
  const run = previous.then(operation, operation);
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  tails.set(key, tail);
  // Drop the idle chain so a long-lived process does not retain one entry per
  // adapter it has ever written. Only the current tail may remove the key.
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}

/** Number of adapters with an active or queued write. Test/diagnostic surface. */
export function adapterWriteLockDepth(): number {
  return tails.size;
}
