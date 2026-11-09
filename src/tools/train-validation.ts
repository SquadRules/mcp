/**
 * Pre-write guards for `train`, extracted from `train-store.ts`.
 *
 * Every guard here runs **before** the memory write, because the store has no
 * transaction spanning them:
 *
 *   1. `assertInheritanceFrontmatterValid` — the child's own `inherits:`/`override:`
 *      block must be structurally valid against the *stored* parent.
 *   2. `assertTrainExpectedVersion` — compare-and-swap against the stored adapter
 *      version, so a restore or an evolution apply that read a stale base fails
 *      closed instead of overwriting a parent that moved.
 *   3. `assertTrainDescendantsValid` — the prospective document must not invalidate a
 *      stored descendant (ADR 0046 §6). This is the parent side of the same check.
 */
import type { MemoryQdrantStore } from '../services/memory/store.js';
import { parseFrontmatter } from '../utils/frontmatter.js';
import {
  parseOverrideList,
  validateInheritanceFrontmatter,
  type InheritanceFrontmatter,
  type StructuralWarning
} from '../services/graph-db/adapter-inheritance.js';
import { writeAdapterScope } from '../services/graph-db/adapter-scope.js';
import { resolveStoredParentSnapshot } from '../services/graph-db/adapter-graph-records.js';
import {
  DescendantValidationError,
  assertDescendantsValid
} from '../services/graph-db/descendant-validation.js';
import {
  InheritanceValidationUnavailableError,
  inheritanceWriteStructureErrors
} from '../services/graph-db/inheritance-write-validation.js';
import { assertExpectedVersion } from './version-cas.js';
import { TrainError } from './train-error.js';

/**
 * Extract inheritance-relevant frontmatter fields from raw adapter markdown.
 * Returns null when neither inheritance nor an override list needs validation.
 */
function extractInheritanceFrontmatter(markdown: string): InheritanceFrontmatter | null {
  const parsed = parseFrontmatter(markdown);
  if (!parsed.inherits && !parsed.overrideRaw) return null;

  const fm: InheritanceFrontmatter = {};
  if (parsed.inherits) fm.inherits = parsed.inherits;
  if (parsed.slugRaw) fm.slug = parsed.slugRaw;
  if (parsed.version) fm.version = parsed.version;
  if (parsed.title) fm.title = parsed.title;
  if (parsed.chainRoot) fm.chain_root = parsed.chainRoot;

  // Parse override list from raw frontmatter value
  if (parsed.overrideRaw) {
    fm.override = parseOverrideList(parsed.overrideRaw);
  }

  return fm;
}

/**
 * Validate inheritance frontmatter before the memory write (fail-closed).
 *
 * The parent frontmatter comes from the parent's *stored* record, resolved through the
 * same scope policy the graph edge uses (`resolveStoredParentSnapshot`: the child's own
 * space first, the app space second). Passing the real parent is what lets
 * `override_unknown_field` catch a typo before anything is written, and keeps
 * `parent_missing` a warning only when the parent genuinely is not stored.
 */
export async function assertInheritanceFrontmatterValid(
  markdown: string,
  memoryStore: MemoryQdrantStore
): Promise<StructuralWarning[]> {
  const fm = extractInheritanceFrontmatter(markdown);
  if (!fm) return [];

  const localErrors = inheritanceWriteStructureErrors(fm);
  if (localErrors.length > 0) {
    throw new TrainError(
      'INHERITANCE_STRUCTURE_INVALID',
      localErrors.map((e) => `[${e.code}] ${e.message}`).join('; '),
      { must_obey: true, items: localErrors }
    );
  }
  // No unknown-field policy is imposed on an override list without inheritance.
  if (!fm.inherits) return [];

  let parentFrontmatter: InheritanceFrontmatter | null;
  try {
    let spaceId: string;
    try {
      spaceId = writeAdapterScope().spaceId;
    } catch (err) {
      throw new InheritanceValidationUnavailableError('scope_unavailable', fm.inherits, '', err);
    }
    const parent = await resolveStoredParentSnapshot(memoryStore, fm.inherits, spaceId);
    parentFrontmatter = parent?.snapshot.frontmatter ?? null;
  } catch (err) {
    if (err instanceof InheritanceValidationUnavailableError) {
      throw new TrainError(err.code, err.message, err.details);
    }
    throw err;
  }

  const result = validateInheritanceFrontmatter(fm, parentFrontmatter);

  if (result.errors.length > 0) {
    const messages = result.errors.map((e) => `[${e.code}] ${e.message}`).join('; ');
    throw new TrainError('INHERITANCE_STRUCTURE_INVALID', messages, {
      must_obey: true,
      items: result.errors
    });
  }

  return result.warnings;
}

/**
 * Enforce `expected_version` against the stored adapter with the same slug.
 *
 * Train resolves an adapter by its explicit `slug:`; without one there is no stable
 * identity to compare, so a CAS request without a slug fails closed instead of
 * pretending to be checked.
 */
export async function assertTrainExpectedVersion(
  markdown: string,
  expectedVersion: string | undefined,
  memoryStore: MemoryQdrantStore
): Promise<void> {
  const wanted = typeof expectedVersion === 'string' ? expectedVersion.trim() : '';
  if (wanted.length === 0) return;

  const slug = (parseFrontmatter(markdown).slugRaw ?? '').trim();
  if (slug.length === 0) {
    throw new TrainError(
      'VERSION_CONFLICT',
      'expected_version requires an explicit `slug:` in frontmatter so the stored adapter can be identified; nothing was written.',
      { expected: wanted, slug: null }
    );
  }

  let spaceId = '';
  try {
    spaceId = writeAdapterScope().spaceId;
  } catch {
    throw new TrainError(
      'VERSION_CONFLICT',
      'expected_version cannot be checked: this store has no writable space in its tenant context; nothing was written.',
      { expected: wanted, slug }
    );
  }

  const stored = await resolveStoredParentSnapshot(memoryStore, slug, spaceId);
  assertExpectedVersion(`squadrules://adapter/${slug}`, wanted, stored?.snapshot.version ?? '0.0.0');
}

/**
 * Fail the write when the prospective parent document would invalidate a descendant.
 *
 * Skipped when the document declares no `slug:` (no stable identity to look children
 * up by) or when the runtime has no writable space. No children means no conflicts.
 */
export async function assertTrainDescendantsValid(
  markdown: string,
  memoryStore: MemoryQdrantStore
): Promise<void> {
  const slug = (parseFrontmatter(markdown).slugRaw ?? '').trim();
  if (slug.length === 0) return;

  let spaceId = '';
  try {
    spaceId = writeAdapterScope().spaceId;
  } catch {
    return;
  }

  try {
    await assertDescendantsValid({ owner: memoryStore, source: memoryStore, parentSlug: slug, spaceId, markdown });
  } catch (err) {
    if (err instanceof DescendantValidationError) {
      throw new TrainError(err.code, err.message, {
        must_obey: true,
        items: err.report.conflicts,
        next_action: 'branch the affected child, or keep the parent field the child overrides, then retry'
      });
    }
    throw err;
  }
}
