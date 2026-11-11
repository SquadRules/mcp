/**
 * UNIT — the owned-listener shutdown registry (ADR 0049, issues #297 / G12–G13).
 *
 * The process-level gate (`tests/integration/server-shutdown.test.ts`) proves the exit
 * semantics of the shipped server with a real model. It cannot prove these contracts: a
 * bind failure delivers its `error` after the boot's registration microtask (so the
 * listener is already in the set), a signal during boot is answered by the bounded
 * fallback before any listener exists, and no real listener can be made to throw on
 * close. Both contracts are therefore proven here.
 */
import { createShutdownRegistry } from '../../src/runtime/shutdown-registry.js';

describe('createShutdownRegistry', () => {
  test('a drain closes every registered listener once, in registration order', () => {
    const registry = createShutdownRegistry();
    const order: string[] = [];

    registry.register(() => order.push('metrics'));
    registry.register(() => order.push('http'));

    expect(registry.drain()).toBe(2);
    expect(order).toEqual(['metrics', 'http']);
    // The set was taken, not copied: a second drain has nothing left to close.
    expect(registry.drain()).toBe(0);
    expect(order).toEqual(['metrics', 'http']);
  });

  test('a listener that registers after the drain is closed at registration and reported', () => {
    const late: string[] = [];
    const registry = createShutdownRegistry({
      onLateRegistration: () => late.push('registered-after-drain')
    });
    const closed: string[] = [];

    registry.register(() => closed.push('registered-before'));
    registry.drain();

    // What a boot that finishes after the signal does: it still calls register().
    registry.register(() => closed.push('registered-after-drain'));

    expect(closed).toEqual(['registered-before', 'registered-after-drain']);
    expect(late).toEqual(['registered-after-drain']);
    // Retaining it would have left nobody to close it, and the handle would keep the
    // event loop alive until the bounded last resort.
    expect(registry.drain()).toBe(0);
  });

  test('a listener that registers DURING the drain is treated as late', () => {
    const late: string[] = [];
    const registry = createShutdownRegistry({
      onLateRegistration: () => late.push('during-drain')
    });
    const closed: string[] = [];

    registry.register(() => {
      closed.push('first');
      // A closer that starts another listener must not extend the drain it is part of.
      registry.register(() => closed.push('nested'));
    });

    expect(registry.drain()).toBe(1);
    expect(closed).toEqual(['first', 'nested']);
    expect(late).toEqual(['during-drain']);
  });

  test('a throwing closer neither escapes the drain nor skips the remaining closers', () => {
    const failures: string[] = [];
    const registry = createShutdownRegistry({
      onCloseError: (error) => failures.push(error instanceof Error ? error.message : String(error))
    });
    const closed: string[] = [];

    registry.register(() => {
      throw new Error('socket already gone');
    });
    registry.register(() => closed.push('second'));

    expect(() => registry.drain()).not.toThrow();
    expect(failures).toEqual(['socket already gone']);
    expect(closed).toEqual(['second']);
  });

  test('a late closer that throws is reported and does not escape register()', () => {
    const failures: string[] = [];
    const registry = createShutdownRegistry({
      onCloseError: (error) => failures.push(error instanceof Error ? error.message : String(error))
    });
    registry.drain();

    expect(() =>
      registry.register(() => {
        throw new Error('late close failed');
      })
    ).not.toThrow();
    expect(failures).toEqual(['late close failed']);
  });
});
