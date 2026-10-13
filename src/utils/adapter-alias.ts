/** Retired slug redirect: create-new-protocol was renamed to author-adapter. */
export const AUTHORING_ADAPTER_SLUG = 'author-adapter';
export const RETIRED_AUTHORING_ADAPTER_SLUG = 'create-new-protocol';

export function resolveAdapterSlugAlias(slug: string): string {
  return slug === RETIRED_AUTHORING_ADAPTER_SLUG ? AUTHORING_ADAPTER_SLUG : slug;
}

export function isAuthoringAdapterSlug(slug: string): boolean {
  return resolveAdapterSlugAlias(slug) === AUTHORING_ADAPTER_SLUG;
}
