/**
 * Per-adapter write serialization (G4).
 *
 * WHAT THIS PINS
 * The protected region of an adapter write is read → validate → persist → append history.
 * Two writers interleaving inside it both pass an expected-version check that was true a
 * moment earlier, which is why the precheck alone is not a compare-and-swap. These tests
 * pin the lock's own guarantees: mutual exclusion per key, independence across keys, and
 * release on failure (a wedged adapter would be worse than a slow one).
 *
 * The lock is process-local by design (see the module header). Nothing here claims it
 * serializes two processes — a shared backend is protected by the durable optimistic
 * guard instead, which is a different mechanism with a different failure mode.
 */
import { describe, expect, test } from '@jest/globals';
import {
  adapterIdentityLockKey,
  adapterWriteLockDepth,
  withAdapterWriteLock
} from '../../src/services/graph-db/adapter-write-lock.js';

/** Let the idle-chain cleanup run; the depth assertion is about the settled state. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('adapter write lock', () => {
  test('operations for one adapter run one at a time, in submission order', async () => {
    const key = adapterIdentityLockKey('serialized');
    const events: string[] = [];

    const first = withAdapterWriteLock(key, async () => {
      events.push('first:enter');
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push('first:leave');
    });
    const second = withAdapterWriteLock(key, async () => {
      events.push('second:enter');
    });

    await Promise.all([first, second]);
    expect(events).toEqual(['first:enter', 'first:leave', 'second:enter']);
  });

  test('a slow holder does not block a different adapter', async () => {
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const blocked = withAdapterWriteLock(adapterIdentityLockKey('holder'), async () => {
      await held;
      return 'held';
    });

    // Resolves while the other adapter is still holding its lock: different adapters are
    // independent, not a global queue.
    await expect(
      withAdapterWriteLock(adapterIdentityLockKey('other'), async () => 'free')
    ).resolves.toBe('free');

    release();
    await expect(blocked).resolves.toBe('held');
  });

  test('a failed operation releases its successor instead of wedging the adapter', async () => {
    const key = adapterIdentityLockKey('failing');

    await expect(
      withAdapterWriteLock(key, async () => {
        throw new Error('unit write failure');
      })
    ).rejects.toThrow('unit write failure');

    // The failure belongs to its own caller; the next writer must still run.
    await expect(withAdapterWriteLock(key, async () => 'after failure')).resolves.toBe('after failure');
  });

  test('the returned promise settles with the operation result, not the queue state', async () => {
    await expect(
      withAdapterWriteLock(adapterIdentityLockKey('result'), async () => ({ wrote: true }))
    ).resolves.toEqual({ wrote: true });
  });

  test('an idle lock leaves no retained entry', async () => {
    const key = adapterIdentityLockKey('cleanup');
    await withAdapterWriteLock(key, async () => undefined);
    await settle();
    expect(adapterWriteLockDepth()).toBe(0);
  });

  test('the key is scoped to the adapter id, not to a space or a slug', () => {
    // A move changes the space and a rename changes the slug; the stored adapter id is the
    // one identity every write route agrees on, so the lock keys off it alone.
    expect(adapterIdentityLockKey('adapter-x')).toBe(adapterIdentityLockKey(' adapter-x '));
    expect(adapterIdentityLockKey('adapter-x')).not.toBe(adapterIdentityLockKey('adapter-y'));
  });
});
