/**
 * Backend-neutral inheritance merge.
 *
 * Both repositories produce the same ancestor list (root-first) and hand it here,
 * so "effective properties" cannot drift between LadybugDB and ArangoDB.
 *
 * Rules (docs/specs/graph-schema.md §5.4, ADR 0043):
 * - the first ancestor contributes every field it declares;
 * - each later level contributes a field only when the field is absent or the
 *   level names it in its own `override:` list;
 * - identity and structural fields always come from the child.
 */
import type { AdapterNode } from './graph-types.js';

/** Fields a descendant must never inherit from an ancestor. */
export const INHERITANCE_IDENTITY_FIELDS = [
  'key',
  'type',
  'slug',
  'version',
  'space',
  'created_at',
  'updated_at',
  'frontmatter',
  'inherits',
  'override',
  'verdict',
  'work_envelope'
] as const;

/** Merge a root-first ancestor chain into the child's effective properties. */
export function mergeResolvedProperties(
  child: AdapterNode,
  ancestorsRootFirst: AdapterNode[]
): Record<string, unknown> {
  if (ancestorsRootFirst.length === 0) {
    return { ...(child as unknown as Record<string, unknown>) };
  }

  const merged: Record<string, unknown> = {
    ...(ancestorsRootFirst[0] as unknown as Record<string, unknown>)
  };
  // The root contributes every field it declares EXCEPT identity/structural ones. The
  // closing loop only copies those from the child when the child declares them, so a root
  // `verdict:`/`work_envelope:` would otherwise leak down the chain and a descendant would
  // inherit evidence it never produced (ADR 0043: identity fields never travel).
  for (const field of INHERITANCE_IDENTITY_FIELDS) delete merged[field];
  const levels: AdapterNode[] = [...ancestorsRootFirst.slice(1), child];
  for (const level of levels) {
    const overrides = new Set(level.frontmatter?.override ?? []);
    for (const [field, value] of Object.entries(level as unknown as Record<string, unknown>)) {
      if ((INHERITANCE_IDENTITY_FIELDS as readonly string[]).includes(field)) continue;
      if (!(field in merged) || overrides.has(field)) {
        merged[field] = value;
      }
    }
  }
  for (const field of INHERITANCE_IDENTITY_FIELDS) {
    if (field in (child as unknown as Record<string, unknown>)) {
      merged[field] = (child as unknown as Record<string, unknown>)[field];
    }
  }
  return merged;
}
