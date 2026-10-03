// squadrules-compat-surface: dual-emits the kairos_local_artifact_dir JSON field expected by existing clients
/**
 * JSON field exposing the run's local handoff dir as ordered URI hints
 * (`project://<rel>`, `user://<rel>`). The server never names a path on
 * its own filesystem; the client resolves a hint to an absolute path on
 * its own machine and exports it as `KAIROS_LOCAL_ARTIFACT_DIR` for shell
 * challenges. Lowercase snake of the env var name on the client side.
 */
export const KAIROS_LOCAL_ARTIFACT_DIR_JSON_FIELD = 'kairos_local_artifact_dir';

/**
 * Compatibility alias emitted alongside the primary field so that clients
 * adopting the SquadRules name can read either. Both fields always carry
 * the same value.
 */
export const SQUADRULES_LOCAL_ARTIFACT_DIR_JSON_FIELD = 'squadrules_local_artifact_dir';

export function buildLocalArtifactDirFields(
  hints: readonly string[]
): Record<typeof KAIROS_LOCAL_ARTIFACT_DIR_JSON_FIELD | typeof SQUADRULES_LOCAL_ARTIFACT_DIR_JSON_FIELD, string[]> {
  // Return a fresh mutable copy so schema-typed responses (z.array(z.string()))
  // can hold the value; the source array is frozen at config parse time.
  const copy = [...hints];
  return {
    [KAIROS_LOCAL_ARTIFACT_DIR_JSON_FIELD]: copy,
    [SQUADRULES_LOCAL_ARTIFACT_DIR_JSON_FIELD]: [...copy]
  };
}
