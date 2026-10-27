/**
 * Jest test sequencer.
 *
 * Ordering intent after the tests/integration read-only vs write reorg:
 * the read-only (tests/integration/readonly/**) and write (tests/integration/write/**)
 * buckets run in separate Jest invocations (read-only-first
 * fail-fast), so the historical "run train/update before the activate suite" cross-file
 * ordering is no longer required — each read-only file provisions its own fixtures.
 *
 * The only ordering still enforced is: run 000-health-preflight first within any invocation,
 * so an unhealthy stack fails fast with a clear signal before other files time out.
 */
const TestSequencer = require('@jest/test-sequencer').default;

class CustomSequencer extends TestSequencer {
  sort(tests) {
    return [...tests].sort((a, b) => {
      const aIsHealthPreflight = a.path.endsWith('000-health-preflight.test.ts');
      const bIsHealthPreflight = b.path.endsWith('000-health-preflight.test.ts');
      if (aIsHealthPreflight && !bIsHealthPreflight) return -1;
      if (bIsHealthPreflight && !aIsHealthPreflight) return 1;
      return 0;
    });
  }
}

module.exports = CustomSequencer;
