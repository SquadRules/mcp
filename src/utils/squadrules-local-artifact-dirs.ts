/**
 * Parser for the comma-separated env `SQUADRULES_LOCAL_ARTIFACT_DIRS` that defines
 * the ordered URI hints emitted as `squadrules_local_artifact_dir` in tool
 * responses. The server never resolves these to absolute paths; the client
 * picks one and resolves on its own filesystem (see `src/embed-docs/tools/`).
 *
 * Rebrand: the default hints use `squadrules` paths. The env var name
 * (`SQUADRULES_LOCAL_ARTIFACT_DIRS`) is unchanged.
 */
export const SQUADRULES_LOCAL_ARTIFACT_DIRS_DEFAULT =
  'project://.local/squadrules/work,user://.config/squadrules/work';

export function parseLocalArtifactDirHints(raw: string): readonly string[] {
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) {
    throw new Error(
      'SQUADRULES_LOCAL_ARTIFACT_DIRS must list at least one hint (e.g. project://.local/squadrules/work)'
    );
  }
  for (const hint of items) {
    const match = /^(project|user):\/\/(.+)$/.exec(hint);
    if (!match) {
      throw new Error(
        `Invalid scheme in SQUADRULES_LOCAL_ARTIFACT_DIRS entry "${hint}". Use project://<rel> or user://<rel>.`
      );
    }
    const rel = match[2]!;
    if (rel.startsWith('/')) {
      throw new Error(
        `SQUADRULES_LOCAL_ARTIFACT_DIRS entry "${hint}" must use a safe relative path; absolute paths are not allowed.`
      );
    }
    if (rel.split('/').includes('..')) {
      throw new Error(
        `SQUADRULES_LOCAL_ARTIFACT_DIRS entry "${hint}" must not contain ".." segments.`
      );
    }
  }
  return Object.freeze(items);
}
