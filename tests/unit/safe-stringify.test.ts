/**
 * Regression tests for issue #204: bootstrap fatal-error masking.
 *
 * ts-node's TSError crosses the loader-thread boundary as a null-prototype
 * object whose only own key is a `util.inspect.custom` symbol. The old
 * bootstrap-local `safeStringify` found no message/stack/code, JSON.stringify
 * returned '{}', and the fallback `Object.prototype.toString` rendered
 * "[object Object]" — hiding the real compile error while ~79 stdio suites
 * failed with "MCP error -32000: Connection closed".
 *
 * `safeStringify` now falls back to `util.inspect` (which honours custom
 * inspect symbols) before giving up.
 */
import { inspect } from 'node:util';
import { describe, expect, test } from '@jest/globals';
import { safeStringify } from '../../src/utils/safe-stringify.js';

describe('safeStringify', () => {
  test('renders Error instances with name, message and stack', () => {
    const err = new Error('boom');
    const out = safeStringify(err);
    expect(out).toContain('Error: boom');
    expect(out).toContain('safe-stringify.test.ts');
  });

  test('renders error-like objects via message/stack/code', () => {
    const out = safeStringify({ code: 'ERR_X', message: 'failed', stack: 'at foo' });
    expect(out).toBe('code=ERR_X\nfailed\nat foo');
  });

  test('renders JSON-serialisable objects as JSON', () => {
    expect(safeStringify({ a: 1 })).toBe('{"a":1}');
  });

  test('renders a null-prototype throwable with a custom inspect symbol (ts-node TSError shape)', () => {
    // Exact shape observed from the ts-node ESM loader: Object.keys() is empty
    // and there is no message/stack property access.
    const tsErrorLike = Object.create(null);
    Object.defineProperty(tsErrorLike, inspect.custom, {
      value: () => 'src/http/http-server-config.ts(62,13): error TS2349: This expression is not callable.',
      enumerable: false
    });
    const out = safeStringify(tsErrorLike);
    expect(out).toContain('error TS2349');
    expect(out).not.toContain('[object Object]');
  });

  test('renders an empty null-prototype object with inspect detail instead of [object Object]', () => {
    const out = safeStringify(Object.create(null));
    expect(out).toBe('[Object: null prototype] {}');
  });

  test('renders objects with non-enumerable message properties', () => {
    const o = Object.create(null);
    Object.defineProperty(o, 'message', { value: 'hidden message', enumerable: false });
    expect(safeStringify(o)).toBe('hidden message');
  });

  test('renders circular objects via inspect instead of throwing', () => {
    const o: Record<string, unknown> = { name: 'circular' };
    o['self'] = o;
    const out = safeStringify(o);
    expect(out).toContain('circular');
    expect(out).toContain('[Circular');
  });

  test('renders primitive throwables with String()', () => {
    expect(safeStringify('plain string')).toBe('plain string');
    expect(safeStringify(42)).toBe('42');
    expect(safeStringify(null)).toBe('null');
    expect(safeStringify(undefined)).toBe('undefined');
  });
});
