/** Retired slug redirect: create-new-protocol was renamed to author-adapter. */
export const AUTHORING_ADAPTER_SLUG = 'author-adapter';
export const RETIRED_AUTHORING_ADAPTER_SLUG = 'create-new-protocol';

/**
 * All redirect-tombstone slugs (ADR 0012). These are inert one-layer adapters
 * that only forward to a replacement. Filtered out of activate/search results
 * so agents never see them as match choices.
 */
export const REDIRECT_TOMBSTONE_SLUGS: ReadonlySet<string> = new Set([
  RETIRED_AUTHORING_ADAPTER_SLUG, // → author-adapter
  'phase-critic',                 // → critic-loop
  'phase-critic-guide'            // → critic-loop-guide
]);

export function resolveAdapterSlugAlias(slug: string): string {
  return slug === RETIRED_AUTHORING_ADAPTER_SLUG ? AUTHORING_ADAPTER_SLUG : slug;
}

export function isAuthoringAdapterSlug(slug: string): boolean {
  return resolveAdapterSlugAlias(slug) === AUTHORING_ADAPTER_SLUG;
}

/** Whether the given slug is a redirect tombstone that should be hidden from search/activate results. */
export function isRedirectTombstone(slug: string): boolean {
  return REDIRECT_TOMBSTONE_SLUGS.has(slug);
}
