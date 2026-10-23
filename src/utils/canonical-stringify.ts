/**
 * Recursively serialize a value to canonical JSON with sorted keys at every depth.
 *
 * Unlike `JSON.stringify(value, Object.keys(value).sort())` — whose replacer array
 * is re-evaluated at every nesting level by `JSON.stringify`, silently dropping
 * nested keys not present at the top level — this function includes all keys at
 * each depth.
 *
 * Used by `hashProofRecord` to compute tamper-evident proof-of-work hashes that
 * bind to the full evidence body, not just the top-level record shape.
 *
 * See https://github.com/SquadRules/mcp/issues/71 (section 2).
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys.map(k => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`);
  return `{${entries.join(',')}}`;
}
