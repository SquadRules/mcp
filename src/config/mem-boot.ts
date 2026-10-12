/**
 * Boot-injection force switch (ADR 0002 / issue #24) — kept out of `config.ts`
 * to satisfy the max-lines budget, following the `src/config/*` convention.
 *
 * Normal boots leave this false so `injectMemResourcesAtBoot` honours the
 * version-based reuse skip: an app-space adapter already stored at (or newer
 * than) its shipped version is left untouched instead of being deleted and
 * re-embedded on every start. Setting `MEM_BOOT_FORCE_INJECT=true` is the
 * structural-repair escape hatch — it bypasses the version check and forces a
 * delete-then-retrain of every shipped adapter, which is how an operator
 * recovers a corrupted or duplicated app-space store without a code change.
 */
function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

/** Force delete-then-retrain of all shipped adapters at boot (repair path). */
export const MEM_BOOT_FORCE_INJECT = getEnvBoolean('MEM_BOOT_FORCE_INJECT', false);
