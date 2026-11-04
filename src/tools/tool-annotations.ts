/**
 * Tool annotations for SquadRules MCP tools.
 *
 * Annotations are truthful hints about tool behavior, based on the MCP 2026-07-28 spec.
 * Each annotation is derived from actual handler behavior:
 *
 * - readOnlyHint: true if tool only reads, never modifies environment
 * - destructiveHint: true if tool may delete or overwrite data (meaningful only when not read-only)
 * - idempotentHint: true if repeating call with same args has no additional effect (meaningful only when not read-only)
 * - openWorldHint: true if tool reaches external systems beyond server's own storage
 *
 * Defaults per spec: readOnlyHint=false, destructiveHint=true, idempotentHint=false, openWorldHint=true
 */

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * Tool names for SquadRules MCP tools.
 * Defined here to avoid circular dependency with tool-registry.ts.
 * The canonical SquadrulesToolName type in tool-registry.ts derives from this list.
 */
export type SquadrulesToolNameLiteral =
  | 'activate'
  | 'forward'
  | 'train'
  | 'reward'
  | 'tune'
  | 'delete'
  | 'export'
  | 'spaces';

/**
 * Annotations for each tool, derived from handler behavior analysis:
 *
 * activate: Read-only search over local adapter store. No external systems.
 *   - readOnlyHint: true (only searches, never modifies)
 *   - openWorldHint: false (local Qdrant/LanceDB store only)
 *
 * forward: Advances execution chain and writes proof-of-work state.
 *   - readOnlyHint: false (writes proof-of-work, advances state)
 *   - destructiveHint: false (additive state changes, doesn't delete/overwrite)
 *   - idempotentHint: false (each call advances the chain, not safe to retry)
 *   - openWorldHint: false (local storage only)
 *
 * train: Creates or overwrites adapter in local store.
 *   - readOnlyHint: false (writes new adapter data)
 *   - destructiveHint: true (can overwrite existing adapter with force_update)
 *   - idempotentHint: false (duplicate detection means second call may fail or differ)
 *   - openWorldHint: false (local storage only)
 *
 * reward: Records reward signal for adapter execution.
 *   - readOnlyHint: false (writes reward data)
 *   - destructiveHint: false (append-only, doesn't delete existing data)
 *   - idempotentHint: false (re-delivery checks for proof conflicts, may reject)
 *   - openWorldHint: false (local storage only)
 *
 * tune: Updates existing adapter layer content.
 *   - readOnlyHint: false (modifies existing data)
 *   - destructiveHint: true (overwrites existing layer content)
 *   - idempotentHint: true (same content update = same result, safe to retry)
 *   - openWorldHint: false (local storage only)
 *
 * delete: Removes adapters or layers from store.
 *   - readOnlyHint: false (deletes data)
 *   - destructiveHint: true (permanently removes data)
 *   - idempotentHint: true (deleting already-deleted resource returns success or not-found)
 *   - openWorldHint: false (local storage only)
 *
 * export: Reads and exports adapter/training data.
 *   - readOnlyHint: true (only reads, never modifies)
 *   - openWorldHint: false (local storage only)
 *
 * spaces: Lists available spaces and adapter counts.
 *   - readOnlyHint: true (only reads, never modifies)
 *   - openWorldHint: false (local storage only)
 */
export const TOOL_ANNOTATIONS: Record<SquadrulesToolNameLiteral, ToolAnnotations> = {
  activate: {
    readOnlyHint: true,
    openWorldHint: false
  },
  forward: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false
  },
  train: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false
  },
  reward: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false
  },
  tune: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false
  },
  delete: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false
  },
  export: {
    readOnlyHint: true,
    openWorldHint: false
  },
  spaces: {
    readOnlyHint: true,
    openWorldHint: false
  }
} as const;
