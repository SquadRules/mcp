import { SQUADRULES_APP_SPACE_ID } from '../config.js';

const SYSTEM_SPACE_IDS = new Set(['space:system', 'space:squadrules-system']);

export function isProtectedWriteSpace(spaceId: string | undefined | null): boolean {
  const normalized = typeof spaceId === 'string' ? spaceId.trim().toLowerCase() : '';
  if (!normalized) {
    return true;
  }
  return normalized === SQUADRULES_APP_SPACE_ID.toLowerCase() || SYSTEM_SPACE_IDS.has(normalized);
}

export function protectedWriteErrorMessage(spaceId?: string): string {
  const suffix = typeof spaceId === 'string' && spaceId.trim().length > 0 ? ` (${spaceId.trim()})` : '';
  return `Cannot overwrite adapters in protected app/system spaces${suffix}. Fork to a personal or group space instead.`;
}
