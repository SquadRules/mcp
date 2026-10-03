// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
/**
 * Resolve human-oriented space input (train / activate / tune) to a canonical space_id.
 * Matches the train tool: "personal", group names, optional "Group: " prefix, or raw allowed IDs.
 */

import type { SpaceContext } from './tenant-context.js';
import { KAIROS_APP_SPACE_DISPLAY_NAME, spaceIdToDisplayName } from './space-display.js';
import { KAIROS_APP_SPACE_ID } from '../config.js';

export type ResolveSpaceParamResult =
  | { ok: true; spaceId: string }
  | { ok: false; code: 'SPACE_NOT_FOUND' | 'SPACE_READ_ONLY'; message: string };

export type ResolveSpaceParamOptions = {
  /**
   * When true, the Squadrules app space (built-in adapters) may be resolved for activate/search scoping only.
   * Train/tune omit this so the app space stays a read-only target for writes.
   */
  allowReadOnlyAppSearchScope?: boolean;
};

/**
 * Resolve optional space string from tool input into an allowed space id.
 * Empty / undefined / "personal" → default write space (typically personal).
 */
export function resolveSpaceParamForContext(
  ctx: SpaceContext,
  raw: string | undefined,
  options?: ResolveSpaceParamOptions
): ResolveSpaceParamResult {
  if (raw === undefined || typeof raw !== 'string') {
    return { ok: false, code: 'SPACE_NOT_FOUND', message: 'Space parameter is required.' };
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    const spaceId = ctx.defaultWriteSpaceId || ctx.allowedSpaceIds[0] || '';
    if (!spaceId) {
      return { ok: false, code: 'SPACE_NOT_FOUND', message: 'No default space in context.' };
    }
    return { ok: true, spaceId };
  }

  const spaceParam = trimmed.toLowerCase();
  if (spaceParam === 'personal') {
    const fromJwt =
      typeof ctx.personalSpaceId === 'string' && ctx.personalSpaceId.trim().length > 0
        ? ctx.personalSpaceId.trim()
        : '';
    const spaceId = fromJwt || ctx.defaultWriteSpaceId || ctx.allowedSpaceIds[0] || '';
    if (!spaceId) {
      return { ok: false, code: 'SPACE_NOT_FOUND', message: 'No personal or default space in context.' };
    }
    return { ok: true, spaceId };
  }

  const isSquadrulesAppLabel = trimmed.toLowerCase() === KAIROS_APP_SPACE_DISPLAY_NAME.toLowerCase();
  const isSquadrulesAppRaw = trimmed === KAIROS_APP_SPACE_ID;
  if (isSquadrulesAppLabel || isSquadrulesAppRaw) {
    if (options?.allowReadOnlyAppSearchScope) {
      return { ok: true, spaceId: KAIROS_APP_SPACE_ID };
    }
    return {
      ok: false,
      code: 'SPACE_READ_ONLY',
      message: `Cannot use "${KAIROS_APP_SPACE_DISPLAY_NAME}" as a writable target; it is read-only. Use "personal" or a group name.`
    };
  }

  const idsForDisplayMatch = [
    ...ctx.allowedSpaceIds,
    ...(options?.allowReadOnlyAppSearchScope ? [KAIROS_APP_SPACE_ID] : [])
  ];
  const tl = trimmed.toLowerCase();
  for (const id of idsForDisplayMatch) {
    if (spaceIdToDisplayName(id, ctx.spaceNamesById).toLowerCase() === tl) {
      return { ok: true, spaceId: id };
    }
  }

  const groupName = trimmed.startsWith('Group: ') ? trimmed.slice(7).trim() : trimmed;
  const groupPathForm = groupName.startsWith('/') ? groupName : `/${groupName}`;
  const groupNameLower = groupName.toLowerCase();
  const groupPathLower = groupPathForm.toLowerCase();
  const match = ctx.allowedSpaceIds.find((id) => {
    if (id === groupName || id === trimmed) return true;
    if (id.startsWith('group:')) {
      const canonical = (ctx.spaceNamesById?.[id] ?? '').trim();
      if (!canonical) return false;
      const canonicalLower = canonical.toLowerCase();
      if (canonicalLower === groupNameLower) return true;
      if (canonicalLower === groupPathLower) return true;
    }
    return false;
  });
  if (!match) {
    return {
      ok: false,
      code: 'SPACE_NOT_FOUND',
      message: `Group or space "${groupName}" not found in your allowed spaces.`
    };
  }
  return { ok: true, spaceId: match };
}

/** Writable display names for spaces available in the current context. */
export function listWritableSpaceDisplayNames(ctx: SpaceContext): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const spaceId of ctx.allowedSpaceIds) {
    const name = spaceIdToDisplayName(spaceId, ctx.spaceNamesById);
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}
