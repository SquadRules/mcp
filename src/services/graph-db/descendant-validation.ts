/**
 * Descendant validation for a parent change (ADR 0046 §6).
 *
 * A proposal is applied by an ordinary `train`/`tune` of the **parent**. That write
 * must not leave a child in a structurally invalid state: a child that `override:`s
 * a field the new parent no longer declares would become an `override_unknown_field`
 * error on the next read. Checking before the write is what makes "no partial write"
 * true — the store has no transaction spanning the parent's layers and the children's
 * validation, so the validation has to come first.
 *
 * What is checked, and what is not:
 *
 *   - Checked: every child that still declares `inherits: <parent>` must pass
 *     `validateInheritanceFrontmatter` against the **prospective** parent frontmatter.
 *   - Not checked: body-level intent. A parent body edit that makes a child's prose
 *     stale is not a structural error and cannot be decided deterministically.
 *   - Structurally guaranteed, not re-checked: a child can never override `verdict`,
 *     `work_envelope`, `effective_contract(s)`, `contract`, `steps` or `chain_root`
 *     (`STRUCTURAL_OVERRIDE_FORBIDDEN_FIELDS`), and merge never inherits them, so a
 *     parent change cannot rewrite how a descendant's work is judged.
 */
import { parseFrontmatter } from '../../utils/frontmatter.js';
import type {
  InheritanceFrontmatter
} from './adapter-inheritance.js';
import { validateInheritanceFrontmatter } from './adapter-inheritance.js';
import {
  inheritanceFromStoredRecord,
  resolveStoredAdapterLayers,
  type AdapterRecordSource
} from './adapter-graph-records.js';
import { getGraphDb } from './graph-owner.js';
import type { Memory } from '../../types/memory.js';

/** One descendant that the prospective parent change would invalidate. */
export interface DescendantConflict {
  child_slug: string;
  code: string;
  message: string;
}

/** Outcome of validating every stored descendant of one parent. */
export interface DescendantValidationReport {
  parent_slug: string;
  /** Descendants that declared this parent and were actually validated. */
  checked: number;
  conflicts: DescendantConflict[];
}

/** Raised when a parent change would invalidate a stored descendant. */
export class DescendantValidationError extends Error {
  readonly code = 'DESCENDANT_VALIDATION_FAILED';

  constructor(readonly report: DescendantValidationReport) {
    super(
      `DESCENDANT_VALIDATION_FAILED: changing ${report.parent_slug} would invalidate ` +
        `${report.conflicts.length} descendant(s): ` +
        report.conflicts.map((row) => `${row.child_slug} [${row.code}] ${row.message}`).join('; ') +
        '. Nothing was written. Branch the affected child, or keep the parent field the child overrides, then retry.'
    );
    this.name = 'DescendantValidationError';
  }
}

export interface ParentChangeInput {
  /** Store the graph is attached to (`getGraphDb` owner). */
  owner: object;
  /** Record source used to read the stored children. */
  source: AdapterRecordSource | null | undefined;
  parentSlug: string;
  /** Space the parent is stored in — the same scope the children are enumerated in. */
  spaceId: string;
  /** The prospective parent document (the exact bytes about to be written). */
  markdown: string;
}

/** Frontmatter the validator should see: the prospective parent's, not the current one. */
function prospectiveFrontmatter(markdown: string): InheritanceFrontmatter {
  const parsed = parseFrontmatter(markdown);
  const frontmatter: InheritanceFrontmatter = {};
  for (const [key, value] of Object.entries(parsed.fields)) frontmatter[key] = value;
  return frontmatter;
}

/**
 * Validate every stored descendant against the prospective parent frontmatter.
 *
 * Returns an empty report when the graph is unavailable, the caller has no record
 * source, or the adapter has no stored children — there is nothing to invalidate.
 */
export async function validateDescendantsForParentChange(
  input: ParentChangeInput
): Promise<DescendantValidationReport> {
  const report: DescendantValidationReport = { parent_slug: input.parentSlug, checked: 0, conflicts: [] };
  const graphDb = getGraphDb(input.owner);
  if (!graphDb || !graphDb.isInitialized() || !input.source) return report;

  const childSlugs = await graphDb.getChildren(input.spaceId, input.parentSlug);
  if (childSlugs.length === 0) return report;

  const parentFrontmatter = prospectiveFrontmatter(input.markdown);
  for (const childSlug of childSlugs) {
    const layers = await resolveStoredAdapterLayers(input.source, childSlug, input.spaceId);
    const head: Memory | undefined = layers?.find((layer) => (layer.adapter?.layer_index ?? 1) === 1) ?? layers?.[0];
    if (!head) continue;
    const childFrontmatter = inheritanceFromStoredRecord(head);
    // Only real descendants of this parent are in scope; a stale edge must not block a write.
    if (typeof childFrontmatter.inherits !== 'string' || childFrontmatter.inherits.trim() !== input.parentSlug) {
      continue;
    }
    report.checked += 1;
    const result = validateInheritanceFrontmatter(childFrontmatter, parentFrontmatter);
    for (const error of result.errors) {
      report.conflicts.push({ child_slug: childSlug, code: error.code, message: error.message });
    }
  }
  return report;
}

/** Throw the actionable conflict when any descendant would be invalidated. */
export async function assertDescendantsValid(input: ParentChangeInput): Promise<DescendantValidationReport> {
  const report = await validateDescendantsForParentChange(input);
  if (report.conflicts.length > 0) throw new DescendantValidationError(report);
  return report;
}
