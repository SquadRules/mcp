/**
 * Boot mem-injection switches — kept out of `config.ts` to satisfy the max-lines
 * budget, following the `src/config/*` convention. The reuse rule they modulate is
 * documented in `docs/adr/0002-boot-injection-reuse-rule.md`.
 */

/** Truthy spellings accepted for boolean env flags (mirrors `getEnvBoolean` in config.ts). */
function isEnvTruthy(key: string): boolean {
  const raw = (process.env[key] ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'y';
}

/**
 * Opt-in repair switch for boot injection. When true, every shipped mem adapter is
 * deleted and re-embedded at startup, bypassing the version-based reuse rule. Needed to
 * repair a store whose system adapters were structurally corrupted or embedded at a
 * different vector dimension (switching embedding providers changes the dimension).
 * Default false: reuse is the point of the rule, and re-embedding is minutes of CPU ONNX.
 */
export const MEM_BOOT_FORCE_INJECT = isEnvTruthy('MEM_BOOT_FORCE_INJECT');
