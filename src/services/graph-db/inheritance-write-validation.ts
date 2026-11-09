/** Pre-write validation facts, independent of parent-absence and override-eligibility policy. */
import {
  STRUCTURAL_OVERRIDE_FORBIDDEN_FIELDS,
  validateInheritanceFrontmatter,
  type InheritanceFrontmatter,
  type StructuralError
} from './adapter-inheritance.js';

/** Local vetoes do not require a parent read, including when `inherits` is absent. */
export function inheritanceWriteStructureErrors(frontmatter: InheritanceFrontmatter): StructuralError[] {
  if (frontmatter.inherits) return validateInheritanceFrontmatter(frontmatter, null).errors;
  return (frontmatter.override ?? [])
    .filter((field) => STRUCTURAL_OVERRIDE_FORBIDDEN_FIELDS.has(field))
    .map((field) => ({
      code: 'structural_override_forbidden',
      message: `override field "${field}" is structural and may not be overridden`,
      field
    }));
}

export type InheritanceUnavailableReason = 'scope_unavailable' | 'source_unavailable' | 'read_unavailable';

/** `null` means a successful lookup found nothing; an unavailable lookup throws this. */
export class InheritanceValidationUnavailableError extends Error {
  readonly code = 'INHERITANCE_VALIDATION_UNAVAILABLE';
  readonly status = 'unavailable';
  readonly details: Record<string, unknown>;

  constructor(reason: InheritanceUnavailableReason, parentSlug: string, spaceId: string, cause?: unknown) {
    const nextAction = reason === 'scope_unavailable'
      ? 'restore the writable/stored space context, then retry this write'
      : reason === 'source_unavailable'
        ? 'retry through a runtime with a readable adapter record store'
        : 'restore adapter record-store availability for the indicated space, then retry this write';
    super(
      `INHERITANCE_VALIDATION_UNAVAILABLE: parent "${parentSlug}" cannot be checked (${reason}, space "${spaceId}"). ` +
        `No parent absence was established. Recovery: ${nextAction}.`,
      { cause }
    );
    this.name = 'InheritanceValidationUnavailableError';
    this.details = { must_obey: true, reason, parent_slug: parentSlug, space_id: spaceId, next_action: nextAction };
  }
}
