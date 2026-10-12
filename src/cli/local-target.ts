/**
 * Local target sentinel — dependency-free leaf so both `config.ts` (default URL)
 * and `backend/resolve-backend.ts` (target resolution) can share it without a cycle.
 */

/** Sentinel `--url` target meaning "run in-process against the embedded store". */
export const LOCAL_TARGET = 'stdio://local';

/** `--url` values that select the local backend (matched case-insensitively). */
export const LOCAL_TARGET_ALIASES: readonly string[] = ['stdio://local', 'local', 'stdio'];

/** True when a raw `--url`/target value selects the in-process local backend. */
export function isLocalTarget(raw: string | undefined | null): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return LOCAL_TARGET_ALIASES.includes(v);
}
