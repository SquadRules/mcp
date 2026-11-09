/**
 * Shared-backend suite selection contract (ADR 0044, ADR 0048).
 *
 * This is the one piece of the ArangoDB CI lane that can be proven on a host without a
 * container runtime: the suites must RUN when a lane configured them, SKIP LOUDLY when
 * nobody did, and FAIL when a lane required them but the environment is empty. Without
 * this, `verify-integration-graph` could go green having executed zero assertions.
 *
 * The helper is pure over an env bag, so nothing here replaces a real backend — the
 * parity itself is still proven only by `graph-db-arango-*.test.ts` against real ArangoDB.
 */
import { describe, expect, test } from '@jest/globals';

import {
  ARANGO_REQUIRED_FLAG,
  selectSharedBackend
} from '../integration/graph-db-arango-selection.js';

const FULL = {
  SQUADRULES_ARANGO_URL: 'http://127.0.0.1:8529',
  SQUADRULES_ARANGO_DATABASE: 'squadrules_it'
};

describe('a developer without a shared backend still gets an honest skip', () => {
  test('no configuration means not selected and not required', () => {
    const selection = selectSharedBackend('graph-db-arango-shared', {});
    expect(selection.selected).toBe(false);
    expect(selection.required).toBe(false);
    expect(selection.missing).toEqual(['SQUADRULES_ARANGO_URL', 'SQUADRULES_ARANGO_DATABASE']);
    // The skip banner has to be self-sufficient: the operator should not need the source.
    expect(selection.skipBanner).toContain('graph-db-arango-shared');
    expect(selection.skipBanner).toContain('NOT PROVEN');
    expect(selection.skipBanner).toContain('SQUADRULES_ARANGO_DATABASE=squadrules_it');
  });

  test('a partial configuration is selected so the suite fails instead of falling back', () => {
    const selection = selectSharedBackend('graph-db-arango-shared', {
      SQUADRULES_ARANGO_URL: 'http://127.0.0.1:8529'
    });
    expect(selection.selected).toBe(true);
    expect(selection.missing).toEqual(['SQUADRULES_ARANGO_DATABASE']);
  });

  test('half a configuration is never coerced into a silent embedded run', () => {
    const selection = selectSharedBackend('graph-db-arango-evolution', {
      SQUADRULES_ARANGO_DATABASE: 'squadrules_it'
    });
    expect(selection.selected).toBe(true);
    expect(selection.missing).toEqual(['SQUADRULES_ARANGO_URL']);
  });
});

describe('a lane that requires shared evidence cannot be satisfied by a skip', () => {
  test('required with no configuration reports every missing variable', () => {
    const selection = selectSharedBackend('graph-db-arango-shared', { [ARANGO_REQUIRED_FLAG]: 'true' });
    expect(selection.required).toBe(true);
    expect(selection.selected).toBe(false);
    expect(selection.requirementMessage).toContain('SQUADRULES_ARANGO_URL');
    expect(selection.requirementMessage).toContain('SQUADRULES_ARANGO_DATABASE');
    expect(selection.requirementMessage).toContain('graph-db-arango-shared');
    // The message must not describe absence as an acceptable outcome.
    expect(selection.requirementMessage).toContain('not a skip');
  });

  test('required with a half configuration still names only the absent half', () => {
    const selection = selectSharedBackend('graph-db-arango-evolution', {
      [ARANGO_REQUIRED_FLAG]: 'true',
      SQUADRULES_ARANGO_URL: 'http://127.0.0.1:8529'
    });
    expect(selection.selected).toBe(true);
    expect(selection.missing).toEqual(['SQUADRULES_ARANGO_DATABASE']);
  });

  test('required with a full configuration is selected and complete', () => {
    const selection = selectSharedBackend('graph-db-arango-shared', {
      [ARANGO_REQUIRED_FLAG]: 'true',
      ...FULL
    });
    expect(selection.required).toBe(true);
    expect(selection.selected).toBe(true);
    expect(selection.missing).toEqual([]);
  });

  test('the requirement flag accepts the documented truthy spellings only', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on', ' true ']) {
      expect(selectSharedBackend('s', { [ARANGO_REQUIRED_FLAG]: value }).required).toBe(true);
    }
    for (const value of ['', '0', 'false', 'no', 'off', 'maybe']) {
      expect(selectSharedBackend('s', { [ARANGO_REQUIRED_FLAG]: value }).required).toBe(false);
    }
  });

  test('connection values are trimmed so a trailing newline cannot create a phantom host', () => {
    const selection = selectSharedBackend('s', {
      SQUADRULES_ARANGO_URL: '  http://127.0.0.1:8529\n',
      SQUADRULES_ARANGO_DATABASE: '\tsquadrules_it '
    });
    expect(selection.url).toBe('http://127.0.0.1:8529');
    expect(selection.database).toBe('squadrules_it');
    expect(selection.missing).toEqual([]);
  });
});
