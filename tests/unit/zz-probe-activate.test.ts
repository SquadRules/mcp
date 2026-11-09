/**
 * activate output surface — UNIT guard.
 *
 * The delivery contract forbids exposing a raw graph query tool: graph access stays behind
 * `GraphRepository`, and `activate` may surface *resolved ontology context*, never a query
 * handle. This guard pins the output shape so a future refactor cannot leak the repository,
 * an AQL/Cypher string, or an unverified merge into the tool result.
 *
 * The doubles live in `graph-db-activate-unit-harness.ts`; this is a shape assertion, not
 * evidence that any graph operation is correct (that evidence is in the integration suites).
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  graphState,
  makeMatchChoice,
  makeStoreAndService,
  mockResolveEffectiveLayerContent,
  registerMocks,
  resetActivateDoubles,
  searchState
} from './graph-db-activate-unit-harness.js';

/** Keys that would mean a graph handle or query language escaped into the tool result. */
const FORBIDDEN_KEYS = ['graph', 'graphDb', 'graph_repository', 'cypher', 'aql', 'query_handle'];

function keysDeeply(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === null || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) => [
    key,
    ...keysDeeply(inner, depth + 1)
  ]);
}

describe('activate output surface (no raw graph query escape hatch)', () => {
  beforeEach(resetActivateDoubles);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('the result carries resolved content and no graph handle or query text', async () => {
    jest.resetModules();
    registerMocks();
    graphState.available = true;
    searchState.choices = [makeMatchChoice('standalone-adapter')];

    mockResolveEffectiveLayerContent.mockResolvedValue({
      substitute: false,
      inheritance_chain: ['standalone-adapter'],
      resolved: true
    });

    const { executeActivate } = await import('../../src/tools/activate.js');
    const { memoryStore, qdrantService } = makeStoreAndService('standalone-adapter');

    const result = await executeActivate(memoryStore, qdrantService, { query: 'test' });
    const keys = keysDeeply(result);

    for (const forbidden of FORBIDDEN_KEYS) expect(keys).not.toContain(forbidden);
    // No query text of either dialect anywhere in the serialized result.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/MATCH\s*\(|FOR\s+v\s+IN|\.hasLabel\(/);
    // The agent still gets the resolved chain it needs.
    expect(result.inheritance_chain).toEqual(['standalone-adapter']);
    expect(result.choices).toHaveLength(1);
  });

  test('a degraded graph still yields a usable result (degradation is not a failure)', async () => {
    jest.resetModules();
    registerMocks();
    graphState.available = false;
    searchState.choices = [makeMatchChoice('some-adapter')];
    mockResolveEffectiveLayerContent.mockRejectedValue(new Error('no effective content'));

    const { executeActivate } = await import('../../src/tools/activate.js');
    const { memoryStore, qdrantService } = makeStoreAndService('some-adapter');

    const result = await executeActivate(memoryStore, qdrantService, { query: 'test' });

    expect(result.inheritance_resolved).toBe(false);
    expect(result.choices.length).toBeGreaterThan(0);
    expect(keysDeeply(result)).not.toContain('graph');
  });
});
