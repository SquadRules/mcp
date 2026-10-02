// squadrules-compat-surface: references the persisted app-space id space:kairos-app stored in existing Qdrant points
/**
 * Human-readable names for space IDs. Frontend (tools, responses) uses names; backend uses ids.
 */

import { KAIROS_APP_SPACE_ID } from '../config.js';

/** Display label for the app space (embedded mem docs). */
export const KAIROS_APP_SPACE_DISPLAY_NAME = 'Squadrules app';

/**
 * Map a space_id to a human-readable name for tool outputs and agent-facing responses.
 * user:*:* → "Personal"; group:*:* → "Group: /full/path"; space:kairos-app → "Squadrules app".
 */
export function spaceKindFromSpaceId(spaceId: string): 'personal' | 'group' | 'app' | 'other' {
  if (!spaceId || typeof spaceId !== 'string') return 'other';
  if (spaceId === KAIROS_APP_SPACE_ID) return 'app';
  const parts = spaceId.split(':');
  if (parts[0] === 'user') return 'personal';
  if (parts[0] === 'group') return 'group';
  if (parts[0] === 'space') return 'other';
  return 'other';
}

export function spaceIdToDisplayName(spaceId: string, namesById?: Record<string, string>): string {
  if (!spaceId || typeof spaceId !== 'string') return 'Unknown';
  if (spaceId === KAIROS_APP_SPACE_ID) return KAIROS_APP_SPACE_DISPLAY_NAME;
  const mapped = namesById?.[spaceId];
  if (mapped && mapped.trim().length > 0) {
    if (spaceId.startsWith('group:')) return `Group: ${mapped}`;
    return mapped;
  }
  const parts = spaceId.split(':');
  if (parts[0] === 'user') return 'Personal';
  if (parts[0] === 'group') return 'Group';
  if (parts[0] === 'space' && parts.length >= 2) return parts.slice(1).join(':') || spaceId;
  return spaceId;
}
