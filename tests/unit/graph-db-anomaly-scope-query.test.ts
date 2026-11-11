/**
 * Scope-before-limit for anomaly reads (G11).
 *
 * WHY THE PREDICATE, NOT THE RESULT, IS THE CONTRACT
 * One anomaly table serves every scope. Filtering a capped read afterwards looks correct
 * in a small fixture and fails in production: foreign-scope rows consume the window the
 * scoped read was entitled to, so local evidence silently disappears as another space
 * gets busier. The only way to keep the promise is to push the scope into the query, and
 * the only way to observe that from a unit test is the statement the store emits.
 *
 * So these tests read the generated statement and its parameters: the predicate is inside
 * the `WHERE` clause, it precedes `LIMIT`, and its fragments are space-exact (`space:a`
 * must not match `space:a2`). They say nothing about results — that belongs to the
 * real-backend suites.
 */
import { describe, expect, test } from '@jest/globals';
import type { Connection } from '@ladybugdb/core';

import { listAnomalies } from '../../src/services/graph-db/ladybug/ladybug-anomaly-store.js';

interface Captured {
  query: string;
  params: Record<string, unknown> | undefined;
}

/** Connection double: records the statement and returns no rows. */
function capture(): { connection: Connection; seen: Captured[] } {
  const seen: Captured[] = [];
  const connection = {
    async prepare(query: string) {
      return { query };
    },
    async execute(statement: { query: string }, params?: Record<string, unknown>) {
      seen.push({ query: statement.query, params });
      return { async getAll() { return []; } };
    }
  } as unknown as Connection;
  return { connection, seen };
}

describe('anomaly reads apply the scope before the limit', () => {
  test('the scope predicate is inside WHERE and precedes LIMIT', async () => {
    const { connection, seen } = capture();
    await listAnomalies(connection, {
      routesTo: 'parent',
      scopeSpaceId: 'space:a',
      limit: 50
    });

    expect(seen).toHaveLength(1);
    const query = seen[0]!.query;
    const where = query.indexOf('WHERE');
    const limit = query.indexOf('LIMIT');

    expect(where).toBeGreaterThan(-1);
    expect(limit).toBeGreaterThan(where);
    expect(query.indexOf('$scopeSpaceId')).toBeGreaterThan(where);
    expect(query.indexOf('$scopeSpaceId')).toBeLessThan(limit);
    expect(seen[0]!.params).toMatchObject({ scopeSpaceId: 'space:a', limit: 50 });
  });

  test('the scope fragments end on a delimiter, so a prefix space cannot match', async () => {
    const { connection, seen } = capture();
    await listAnomalies(connection, { scopeSpaceId: 'space:a' });

    const params = seen[0]!.params!;
    expect(params['scopeFragment']).toBe('"scope_space_id":"space:a"');
    expect(params['sourceChildFragment']).toBe('"source_child":"adapter:space:a:');
    // `space:a` is not a prefix of what these fragments accept: each ends on `"` or `:`.
    expect(String(params['scopeFragment']).endsWith('"')).toBe(true);
    expect(String(params['sourceChildFragment']).endsWith(':')).toBe(true);
  });

  test('an unscoped read keeps the predicate inert instead of dropping it', async () => {
    const { connection, seen } = capture();
    await listAnomalies(connection, { routesTo: 'parent' });

    const params = seen[0]!.params!;
    expect(params).toMatchObject({
      scopeSpaceId: '',
      scopeFragment: '',
      sourceChildFragment: ''
    });
    // Still parameterised: the same statement serves both reads.
    expect(seen[0]!.query).toContain('$scopeSpaceId =');
  });

  test('a blank scope is treated as no scope, never as a space named " "', async () => {
    const { connection, seen } = capture();
    await listAnomalies(connection, { scopeSpaceId: '   ' });

    expect(seen[0]!.params).toMatchObject({ scopeSpaceId: '', scopeFragment: '' });
  });

  test('the default window is bounded', async () => {
    const { connection, seen } = capture();
    await listAnomalies(connection, {});

    expect(seen[0]!.params).toMatchObject({ limit: 200 });
  });
});
