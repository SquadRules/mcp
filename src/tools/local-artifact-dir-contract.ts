/**
 * JSON field exposing the run's local handoff dir as ordered URI hints
 * (`project://<rel>`, `user://<rel>`). The server never names a path on
 * its own filesystem; the client resolves a hint to an absolute path on
 * its own machine and exports it as `SQUADRULES_LOCAL_ARTIFACT_DIR` for shell
 * challenges. Lowercase snake of the env var name on the client side.
 */
export const SQUADRULES_LOCAL_ARTIFACT_DIR_JSON_FIELD = 'squadrules_local_artifact_dir';

export function buildLocalArtifactDirFields(
  hints: readonly string[]
): Record<typeof SQUADRULES_LOCAL_ARTIFACT_DIR_JSON_FIELD, string[]> {
  // Return a fresh mutable copy so schema-typed responses (z.array(z.string()))
  // can hold the value; the source array is frozen at config parse time.
  const copy = [...hints];
  return {
    [SQUADRULES_LOCAL_ARTIFACT_DIR_JSON_FIELD]: copy
  };
}
