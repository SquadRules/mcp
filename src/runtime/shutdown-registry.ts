/**
 * Registry of the listeners a process owns, drained on shutdown (ADR 0049).
 *
 * A listener that is still accepting work holds the event loop open, so a process that
 * meant to stop does not exit on its own. The safe stop is therefore: close what you own,
 * let the loop empty, report the status through `process.exitCode`. `process.exit()` while
 * fastembed has loaded runs the ONNX Runtime teardown against a live `InferenceSession`
 * and aborts the process instead (ADR 0049).
 *
 * Registration has to be atomic against the drain. A signal can land while the boot is
 * still awaited, so a listener that finishes registering after the drain would never be
 * closed by it — and an abandoned listener is exactly the handle that keeps the loop alive
 * until the bounded last-resort exit, with the model loaded. The registry is therefore the
 * only way a listener may join the shutdown set: if a drain already ran, `register()`
 * closes the listener immediately and reports it, instead of pushing it onto a set nobody
 * will read again.
 *
 * Kept as a small module rather than module-private state in `src/index.ts` so both
 * contracts are provable without a process: the process-level gate cannot reach the
 * late-registration branch (a bind failure delivers its `error` after the boot's
 * registration microtask, and a signal during boot is answered by the bounded fallback
 * before a listener exists), and no gate can make a real listener throw on close.
 */

/** What a listener close failure is reported with; the registry itself never throws. */
export interface ShutdownRegistryOptions {
  /** Called with the closer's failure. The remaining closers still run. */
  onCloseError?: (error: unknown) => void;
  /** Called when a listener is registered during or after the drain. */
  onLateRegistration?: () => void;
}

export interface ShutdownRegistry {
  /**
   * Register a closer for a handle this process owns.
   *
   * When a drain already began, the closer runs immediately instead of being retained:
   * the drain has taken the previous set, so there is nobody left to close it.
   */
  register(close: () => void): void;
  /**
   * Close every registered listener and hand the registry its drained state.
   *
   * The set is taken before the first closer runs, so a closer that registers another
   * listener records it as a late registration instead of extending the drain. Returns
   * how many listeners this drain closed. Calling it twice closes nothing the second
   * time; it is not an error to do so.
   */
  drain(): number;
}

export function createShutdownRegistry(options: ShutdownRegistryOptions = {}): ShutdownRegistry {
  let shuttingDown = false;
  const open: Array<() => void> = [];

  const closeQuietly = (close: () => void): void => {
    try {
      close();
    } catch (error) {
      options.onCloseError?.(error);
    }
  };

  return {
    register(close: () => void): void {
      if (shuttingDown) {
        options.onLateRegistration?.();
        closeQuietly(close);
        return;
      }
      open.push(close);
    },
    drain(): number {
      shuttingDown = true;
      const owned = open.splice(0);
      for (const close of owned) closeQuietly(close);
      return owned.length;
    }
  };
}
