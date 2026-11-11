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
 *   - Scoped: each child is resolved in the space its own node is stored in, not in
 *     the parent's. An app-space parent is inherited by children that live elsewhere
 *     (the documented parent fallback), and the same slug in two spaces is two
 *     different adapters — reading the child in the parent's scope would validate a
 *     same-named neighbour, or nothing at all.
 *   - Authorized: a child record is read only from a space this request may read
 *     (`getSearchSpaceIds()` plus the parent's own scope — the policy every other read
 *     uses). The gate cannot validate a child it is not allowed to see, so a foreign
 *     child is reported as unavailable. Widening the read instead would let one space's
 *     write inspect another space's records, and silently skipping it would make the
 *     gate look complete.
 *   - Reported, not blocking: a child whose stored record cannot be read is listed in
 *     `unavailable` and never counted as a conflict. A read failure is not evidence of
 *     an invalid child, and the parent write must not be blocked by one.
 *   - Not checked: body-level intent. A parent body edit that makes a child's prose
 *     stale is not a structural error and cannot be decided deterministically.
 *   - Structurally guaranteed, not re-checked: a child can never override `verdict`,
 *     `work_envelope`, `effective_contract(s)`, `contract`, `steps` or `chain_root`
 *     (`STRUCTURAL_OVERRIDE_FORBIDDEN_FIELDS`), and merge never inherits them, so a
 *     parent change cannot rewrite how a descendant's work is judged.
 */
import { parseFrontmatter } from '../../utils/frontmatter.js';
import type { InheritanceFrontmatter } from './adapter-inheritance.js';
import { validateInheritanceFrontmatter } from './adapter-inheritance.js';
import {
  inheritanceFromStoredRecord,
  resolveStoredAdapterLayers,
  type AdapterRecordSource
} from './adapter-graph-records.js';
import { getGraphDb } from './graph-owner.js';
import type { AdapterChildRef } from './graph-types.js';
import { getSearchSpaceIds } from '../../utils/tenant-context.js';
import { structuredLogger } from '../../utils/structured-logger.js';
import type { Memory } from '../../types/memory.js';

/** One descendant that the prospective parent change would invalidate. */
export interface DescendantConflict {
  child_slug: string;
  /** Space the conflicting child is stored in, so a cross-scope finding is attributable. */
  space: string;
  code: string;
  message: string;
}

/**
 * One descendant whose stored record could not be read, so it could not be checked.
 *
 * Reported instead of skipped: a child the validator cannot see is a gap in the gate,
 * and silently dropping it would make the gate look complete when it is not. It is
 * never a conflict — a read failure must not block a write.
 */
export interface UnvalidatedDescendant {
  /** Scoped key of the child node the edge pointed at. */
  key: string;
  child_slug: string;
  /** Space the child node is stored in — the scope its record was read from. */
  space: string;
}

/** Outcome of validating every stored descendant of one parent. */
export interface DescendantValidationReport {
  parent_slug: string;
  /** Descendants that declared this parent and were actually validated. */
  checked: number;
  conflicts: DescendantConflict[];
  /** Descendants that could not be read in their own scope; never counted as checked. */
  unavailable: UnvalidatedDescendant[];
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
  /** Space the parent is stored in; every child is then resolved in its own scope. */
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
  const report: DescendantValidationReport = {
    parent_slug: input.parentSlug,
    checked: 0,
    conflicts: [],
    unavailable: []
  };
  const graphDb = getGraphDb(input.owner);
  if (!graphDb || !graphDb.isInitialized() || !input.source) return report;

  const children = await graphDb.getChildren(input.spaceId, input.parentSlug);
  if (children.length === 0) return report;

  const parentFrontmatter = prospectiveFrontmatter(input.markdown);
  const readableSpaces = permittedChildSpaces(input.spaceId);
  for (const child of children) {
    const layers = await readChildLayers(input.source, child, readableSpaces, report);
    if (!layers) continue;
    const head: Memory | undefined =
      layers.find((layer) => (layer.adapter?.layer_index ?? 1) === 1) ?? layers[0];
    if (!head) {
      markUnavailable(child, 'the stored record has no head layer', report);
      continue;
    }
    const childFrontmatter = inheritanceFromStoredRecord(head);
    // Only real descendants of this parent are in scope; a stale edge must not block a write.
    const declaredParent = typeof childFrontmatter.inherits === 'string'
      ? childFrontmatter.inherits.trim()
      : '';
    if (declaredParent !== input.parentSlug) continue;
    report.checked += 1;
    const result = validateInheritanceFrontmatter(childFrontmatter, parentFrontmatter);
    for (const error of result.errors) {
      report.conflicts.push({
        child_slug: child.slug,
        space: child.space,
        code: error.code,
        message: error.message
      });
    }
  }
  return report;
}

/**
 * Spaces this request may read a child record from.
 *
 * Derived from the shared read policy (`getSearchSpaceIds()`) rather than a local list,
 * so a graph gate and a search agree on what one request may see. The parent's own space
 * is added explicitly: the caller is writing there, so it is readable by construction,
 * even if the context does not enumerate it.
 */
function permittedChildSpaces(parentSpaceId: string): Set<string> {
  const permitted = new Set<string>(getSearchSpaceIds());
  const parent = parentSpaceId.trim();
  if (parent.length > 0) permitted.add(parent);
  return permitted;
}

/**
 * Stored layers of one child, read from the space its node is stored in.
 *
 * A throw, a missing record, and a space this request may not read all mean "not
 * readable", and all three are recorded on the report and logged; the parent write is
 * not blocked by any of them, and none falls back to the parent's scope — that fallback
 * is exactly what would validate a same-named neighbour instead of the real child.
 */
async function readChildLayers(
  source: AdapterRecordSource,
  child: AdapterChildRef,
  readableSpaces: Set<string>,
  report: DescendantValidationReport
): Promise<Memory[] | null> {
  if (child.space.length === 0) {
    markUnavailable(child, 'the child node records no scope', report);
    return null;
  }
  if (!readableSpaces.has(child.space)) {
    markUnavailable(child, `space ${child.space} is outside this request's read scope`, report);
    return null;
  }
  try {
    const layers = await resolveStoredAdapterLayers(source, child.slug, child.space);
    if (layers) return layers;
    markUnavailable(child, 'no stored record in that space', report);
  } catch (err) {
    markUnavailable(child, err instanceof Error ? err.message : String(err), report);
  }
  return null;
}

function markUnavailable(
  child: AdapterChildRef,
  reason: string,
  report: DescendantValidationReport
): void {
  report.unavailable.push({ key: child.key, child_slug: child.slug, space: child.space });
  structuredLogger.warn(
    `descendant validation: ${report.parent_slug} change could not check ${child.key} (${reason}) — reported, not blocking`
  );
}

/** Throw the actionable conflict when any descendant would be invalidated. */
export async function assertDescendantsValid(input: ParentChangeInput): Promise<DescendantValidationReport> {
  const report = await validateDescendantsForParentChange(input);
  if (report.conflicts.length > 0) throw new DescendantValidationError(report);
  return report;
}
