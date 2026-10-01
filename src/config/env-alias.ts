/**
 * Env-var alias infrastructure for the KAIROS → SquadRules rebrand.
 *
 * Every `KAIROS_*` environment variable gains a `SQUADRULES_*` alias. This
 * module centralizes the resolution + precedence rules and the one-time
 * deprecation warning so the semantics stay identical everywhere.
 *
 * ## Precedence (explicit, NOT `new || old || default`)
 * The raw value is chosen by *definition*, not by truthiness:
 *   1. If `process.env[newKey] !== undefined` (even when it is `''`), it wins.
 *   2. Else if `process.env[oldKey] !== undefined`, the KAIROS_* value is used
 *      and that key is recorded for the deprecation notice.
 *   3. Else the value is `undefined`.
 *
 * ## Empty-string handling
 * The *parsing* step after resolution preserves each original helper's exact
 * semantics, so behavior never changes silently:
 *   - String helper: `resolved || default` — an explicitly-empty value still
 *     falls through to the default, exactly like the original `getEnvString`.
 *   - Int / float / boolean helpers: `undefined` → default; a defined value is
 *     parsed with the same rules as before.
 *
 * Because precedence is decided by `!== undefined`, setting `SQUADRULES_X=''`
 * intentionally shadows `KAIROS_X` (the KAIROS_* key is then ignored and NOT
 * reported as used) even though the empty value still resolves to the default
 * through the string helper's `||`.
 */

/** KAIROS_* keys that were actually consulted (their alias was unset). */
const oldKeysUsed = new Set<string>();

/**
 * Resolve the raw environment value for an aliased pair.
 *
 * @returns the value of `newKey` when it is defined (including `''`),
 *   otherwise the value of `oldKey` when defined, otherwise `undefined`.
 *   When the KAIROS_* key supplies the value, it is recorded for deprecation.
 */
export function resolveAliasedRaw(newKey: string, oldKey: string): string | undefined {
  const next = process.env[newKey];
  if (next !== undefined) return next;
  const prior = process.env[oldKey];
  if (prior !== undefined) {
    oldKeysUsed.add(oldKey);
    return prior;
  }
  return undefined;
}

/** String variant: mirrors the original `process.env[key] || defaultValue`. */
export function getEnvAliased(newKey: string, oldKey: string, defaultValue: string): string {
  const raw = resolveAliasedRaw(newKey, oldKey);
  return raw || defaultValue;
}

/** Integer variant: `undefined` → default; otherwise `parseInt`, NaN → default. */
export function getEnvIntAliased(newKey: string, oldKey: string, defaultValue: number): number {
  const raw = resolveAliasedRaw(newKey, oldKey);
  if (raw === undefined) return defaultValue;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/** Float variant: `undefined` → default; otherwise `parseFloat`, NaN → default. */
export function getEnvFloatAliased(newKey: string, oldKey: string, defaultValue: number): number {
  const raw = resolveAliasedRaw(newKey, oldKey);
  if (raw === undefined) return defaultValue;
  const parsed = parseFloat(raw);
  return isNaN(parsed) ? defaultValue : parsed;
}

/** Boolean variant: same accepted tokens as the original `getEnvBoolean`. */
export function getEnvBooleanAliased(newKey: string, oldKey: string, defaultValue: boolean): boolean {
  const raw = resolveAliasedRaw(newKey, oldKey);
  if (raw === undefined) return defaultValue;
  const low = String(raw).trim().toLowerCase();
  if (low === 'false' || low === '0' || low === 'no' || low === 'n') return false;
  if (low === 'true' || low === '1' || low === 'yes' || low === 'y') return true;
  return defaultValue;
}

let deprecationLogged = false;

/**
 * Emit a single consolidated deprecation notice listing every KAIROS_* variable
 * that was actually used while its `SQUADRULES_*` alias was unset. Idempotent:
 * safe to call from multiple modules / repeated reads; logs at most once per
 * process.
 */
export function logDeprecations(): void {
  if (deprecationLogged) return;
  deprecationLogged = true;
  if (oldKeysUsed.size === 0) return;
  const keys = [...oldKeysUsed].sort();
  const mapping = keys.map((k) => `${k} → ${k.replace(/^KAIROS_/, 'SQUADRULES_')}`).join(', ');
  const message =
    `[SquadRules] DEPRECATION: older KAIROS_* environment variable(s) in use: ` +
    `${keys.join(', ')}. Please migrate to the SQUADRULES_* equivalent(s): ${mapping}. ` +
    `The KAIROS_* names keep working for now but will be removed in a future release.\n`;
  // Written to stderr (never stdout) so the warning cannot corrupt the stdio
  // MCP JSON-RPC channel. The structured logger imports config.js, so using it
  // here would create a circular import; stderr keeps this module dependency-free.
  process.stderr.write(message);
}

/**
 * Test/reset hook: clears recorded usage and the once-guard so the deprecation
 * notice can be exercised again. Not used at runtime.
 */
export function __resetEnvAliasStateForTests(): void {
  oldKeysUsed.clear();
  deprecationLogged = false;
}
