/**
 * Render an unknown thrown value as a readable string for fatal-error logs.
 *
 * Some throwables never reach the `instanceof Error` or JSON branches:
 * ts-node's TSError, for example, crosses the loader-thread boundary as a
 * null-prototype object whose only own key is a `util.inspect.custom` symbol,
 * so `Object.keys` is empty and naive rendering collapses it to
 * "[object Object]" — hiding the real cause of a fatal boot failure.
 * Fall back to `util.inspect` (which honours custom inspect symbols) before
 * giving up on `Object.prototype.toString`.
 */
import { inspect } from 'node:util';

export function safeStringify(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}\n${v.stack ?? ''}`;
  if (typeof v === 'object' && v !== null) {
    try {
      const o = v as Record<string, unknown>;
      const msg = typeof o['message'] === 'string' ? o['message'] : undefined;
      const stack = typeof o['stack'] === 'string' ? o['stack'] : undefined;
      const code = o['code'] !== undefined ? String(o['code']) : undefined;
      if (msg || stack || code) {
        const parts = [code ? `code=${code}` : '', msg ?? '', stack ?? ''].filter(Boolean);
        return parts.join('\n');
      }
    } catch {
      // fall through
    }
    try {
      const j = JSON.stringify(v);
      if (j !== undefined && j !== '{}') return j;
    } catch {
      // fall through
    }
    try {
      const inspected = inspect(v, { depth: 6 });
      if (inspected) return inspected;
    } catch {
      // fall through
    }
    return Object.prototype.toString.call(v);
  }
  return String(v);
}
