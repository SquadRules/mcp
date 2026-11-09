/**
 * Persist the frontmatter that the graph projects and the merge reads.
 *
 * `storeAdapter` parses frontmatter and then stores the *body*, so `inherits:`,
 * `override:` and `chain_root:` were dropped at write time. The graph could still
 * learn topology from the authoring markdown on the train path, but a graph rebuilt
 * from stored records (boot reconciliation after a graph loss) had nothing to read.
 *
 * The fixed extractor also caused a correctness bug: an arbitrary author property
 * (`risk_level: high`) never reached the record, so a child that legitimately
 * overrode it failed `override_unknown_field` against a parent that *did* declare
 * it. This module carries the parser-supported scalar and nested declarations
 * onto the stored `adapter` payload, not general lossless YAML. Body content stays
 * in `text`, presentation stays in `label`/`tags`.
 */
import type { ParsedFrontmatter } from '../../utils/frontmatter.js';
import type { Memory, StoredAdapterFrontmatter } from '../../types/memory.js';
import { parseOverrideList } from '../graph-db/adapter-inheritance.js';

/** Keys the parser exposes through typed views; the raw value is still preserved. */
const TYPED_KEYS = new Set(['slug', 'version', 'title', 'inherits', 'chain_root', 'chainroot', 'override']);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Coerce a raw YAML scalar into the JSON value a graph property can hold.
 *
 * This is intentionally conservative: booleans, numbers and inline lists become
 * real JSON values; everything else stays the author's string. Never throws and
 * never drops a field.
 */
function coerceFrontmatterValue(raw: string): unknown {
  const value = raw.trim();
  if (value.length === 0) return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return inner
      .split(',')
      .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
      .filter((part) => part.length > 0);
  }
  return value;
}

/**
 * The frontmatter worth persisting, or `null` when the document declares none.
 *
 * Parser-supported declarations are preserved except prototype-sensitive keys.
 * Existing scalar values win scalar/block collisions. The topology fields stay in their
 * typed form (`inherits` string, `override` array, `chain_root` canonicalised) so
 * the existing projection/validation readers keep working unchanged.
 */
export function toStoredAdapterFrontmatter(
  parsed: ParsedFrontmatter | undefined
): StoredAdapterFrontmatter | null {
  if (!parsed) return null;

  const frontmatter: StoredAdapterFrontmatter = {};
  for (const [key, raw] of Object.entries(parsed.fields)) {
    if (TYPED_KEYS.has(key) || UNSAFE_KEYS.has(key)) continue;
    if (raw.trim().length === 0) continue;
    frontmatter[key] = coerceFrontmatterValue(raw);
  }
  for (const [key, block] of Object.entries(parsed.nested ?? {})) {
    if (TYPED_KEYS.has(key) || key === 'protocol_version' || UNSAFE_KEYS.has(key)) continue;
    if (Object.prototype.hasOwnProperty.call(parsed.fields, key)) continue;
    const storedBlock: Record<string, unknown> = {};
    for (const [nestedKey, raw] of Object.entries(block)) {
      if (UNSAFE_KEYS.has(nestedKey)) continue;
      storedBlock[nestedKey] = coerceFrontmatterValue(raw);
    }
    frontmatter[key] = storedBlock;
  }

  if (parsed.slugRaw) frontmatter.slug = parsed.slugRaw;
  if (parsed.version) frontmatter.version = parsed.version;
  if (parsed.title) frontmatter.title = parsed.title;
  if (parsed.inherits) frontmatter.inherits = parsed.inherits;
  if (parsed.chainRoot) frontmatter.chain_root = parsed.chainRoot;
  const override = parsed.overrideRaw ? parseOverrideList(parsed.overrideRaw) : [];
  if (override.length > 0) frontmatter.override = override;

  return Object.keys(frontmatter).length > 0 ? frontmatter : null;
}

/**
 * Attach the persisted frontmatter to every layer of one adapter before its payload
 * is built. No-op when the document declares no frontmatter fields.
 */
export function attachStoredAdapterFrontmatter(
  memories: Memory[],
  parsed: ParsedFrontmatter | undefined
): void {
  const frontmatter = toStoredAdapterFrontmatter(parsed);
  if (!frontmatter) return;
  for (const memory of memories) {
    if (memory.adapter) memory.adapter.frontmatter = structuredClone(frontmatter);
  }
}
