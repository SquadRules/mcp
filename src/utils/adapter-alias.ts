/** Canonical authoring adapter slug. */
export const AUTHORING_ADAPTER_SLUG = 'author-adapter';

export function isAuthoringAdapterSlug(slug: string): boolean {
  return slug === AUTHORING_ADAPTER_SLUG;
}
