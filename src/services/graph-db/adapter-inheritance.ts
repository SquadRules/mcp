/**
 * Structural validation for adapter inheritance frontmatter (SquadRules 6, Touchpoint 3).
 *
 * Fail-closed validators:
 *   - `single_parent`: `inherits` must be a single string, not an array.
 *   - `override_unknown_field`: each field in `override` must exist in the parent's frontmatter.
 *   - `structural_override_forbidden`: certain fields (contract, type, steps, verdict,
 *     work envelope, chain_root, inherits, override) may never appear in the `override` list.
 *   - `parent_missing`: warning (not error) when the parent slug is not found in the graph.
 *
 * Pure function — no I/O, no database access. The caller supplies parent frontmatter
 * (or null when the parent is unknown).
 *
 * @see docs/specs/graph-schema.md § 5 — frontmatter→graph mapping
 * @see docs/adr/0043-additive-selective-inheritance-and-inheritance-checkpoints.md — merge semantics
 */

/** Fields that may never appear in an `override:` list. */
export const STRUCTURAL_OVERRIDE_FORBIDDEN_FIELDS: ReadonlySet<string> = new Set([
  'contract',
  'type',
  'steps',
  'chain_root',
  'inherits',
  'override',
  // Structural verdict / work envelope / effective-contract inputs are decided by
  // the framework. A child may add content, never replace how the run is judged.
  'verdict',
  'work_envelope',
  'effective_contract',
  'effective_contracts'
]);

/** Known frontmatter fields that can be validly overridden by a child adapter. */
export const OVERRIDABLE_FRONTMATTER_FIELDS: ReadonlySet<string> = new Set([
  'slug',
  'version',
  'title',
  'tags',
  'metadata',
  'space',
  'layer_count',
  'contract_types',
  'protocol_version'
]);

export type StructuralErrorCode =
  | 'single_parent'
  | 'override_unknown_field'
  | 'structural_override_forbidden';

export type StructuralWarningCode = 'parent_missing';

export interface StructuralError {
  code: StructuralErrorCode;
  message: string;
  field?: string;
}

export interface StructuralWarning {
  code: StructuralWarningCode;
  message: string;
  field?: string;
}

export interface InheritanceFrontmatter {
  /** Parent adapter slug (single string, never array). */
  inherits?: string;
  /** Fields the child overrides from the parent. */
  override?: string[];
  /** Adapter slug. */
  slug?: string;
  /** Adapter version. */
  version?: string;
  /** Adapter title. */
  title?: string;
  /** Protocol version. */
  protocol_version?: string;
  /** Chain root slug. */
  chain_root?: string;
  /**
   * Any additional frontmatter field (author-declared domain properties included).
   * `override_unknown_field` is checked against these keys, so a field that really
   * exists on the parent is never rejected merely because it is not in a fixed list.
   */
  [key: string]: unknown;
}

export interface InheritanceValidationResult {
  errors: StructuralError[];
  warnings: StructuralWarning[];
}

/**
 * Parse the raw `override:` frontmatter value into a string array.
 *
 * Accepts YAML-like inline list: `[tags, metadata]` or comma-separated: `tags, metadata`.
 * Returns an empty array when the value is absent or empty.
 */
export function parseOverrideList(raw: string | undefined | null): string[] {
  if (!raw || typeof raw !== 'string') return [];
  let value = raw.trim();
  // Strip surrounding brackets if present: [tags, metadata]
  if (value.startsWith('[') && value.endsWith(']')) {
    value = value.slice(1, -1);
  }
  if (!value.trim()) return [];
  return value
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter((s) => s.length > 0);
}

/**
 * Detect whether a raw `inherits:` frontmatter value is an array (YAML inline list).
 * Returns true when the value looks like `[parent1, parent2]` or contains commas
 * indicating multiple parents.
 */
export function isInheritsArray(raw: string | undefined | null): boolean {
  if (!raw || typeof raw !== 'string') return false;
  const value = raw.trim();
  if (value.startsWith('[') && value.endsWith(']')) return true;
  // Comma-separated without brackets also indicates an array
  if (value.includes(',')) return true;
  return false;
}

/**
 * Validate inheritance frontmatter fields. Pure function — no I/O.
 *
 * @param frontmatter - The child adapter's parsed frontmatter (inherits, override, etc.)
 * @param parentFrontmatter - The parent adapter's frontmatter fields, or null when the
 *                            parent is not available in the graph.
 * @returns Structural errors (fail-closed) and warnings (informational).
 */
export function validateInheritanceFrontmatter(
  frontmatter: InheritanceFrontmatter,
  parentFrontmatter: InheritanceFrontmatter | null
): InheritanceValidationResult {
  const errors: StructuralError[] = [];
  const warnings: StructuralWarning[] = [];

  const inherits = frontmatter.inherits;

  // No inheritance declared — nothing to validate
  if (!inherits) {
    return { errors, warnings };
  }

  // single_parent: inherits must be a single string, not an array
  if (isInheritsArray(inherits)) {
    errors.push({
      code: 'single_parent',
      message: `inherits must be a single parent slug, not an array: "${inherits}"`,
      field: 'inherits'
    });
    // Cannot continue with further inheritance validation if the parent is ambiguous
    return { errors, warnings };
  }

  // structural_override_forbidden: reject forbidden fields in override list
  const overrideFields = frontmatter.override ?? [];
  for (const field of overrideFields) {
    if (STRUCTURAL_OVERRIDE_FORBIDDEN_FIELDS.has(field)) {
      errors.push({
        code: 'structural_override_forbidden',
        message: `override field "${field}" is structural and may not be overridden`,
        field
      });
    }
  }

  // If the parent frontmatter is not available, emit parent_missing warning
  if (!parentFrontmatter) {
    warnings.push({
      code: 'parent_missing',
      message: `parent adapter "${inherits}" not found in graph — override field validation skipped`,
      field: 'inherits'
    });
    // Cannot validate override_unknown_field without parent frontmatter
    return { errors, warnings };
  }

  // override_unknown_field: each override field must exist in the parent's frontmatter.
  // The parent frontmatter carries arbitrary author properties, so a declared domain
  // field is accepted without adding it to a hard-coded allowlist.
  const parentKeys = new Set(Object.keys(parentFrontmatter));
  for (const field of overrideFields) {
    // Skip fields already reported as structurally forbidden
    if (STRUCTURAL_OVERRIDE_FORBIDDEN_FIELDS.has(field)) continue;
    if (!parentKeys.has(field) && !OVERRIDABLE_FRONTMATTER_FIELDS.has(field)) {
      errors.push({
        code: 'override_unknown_field',
        message: `override field "${field}" does not exist in parent "${inherits}" frontmatter`,
        field
      });
    }
  }

  return { errors, warnings };
}
