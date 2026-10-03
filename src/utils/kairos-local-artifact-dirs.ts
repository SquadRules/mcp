// squadrules-compat-surface: dual-emits the kairos_local_artifact_dir JSON field expected by existing clients
/**
 * Parser for the comma-separated env `KAIROS_LOCAL_ARTIFACT_DIRS` that defines
 * the ordered URI hints emitted as `kairos_local_artifact_dir` in tool
 * responses. The server never resolves these to absolute paths; the client
 * picks one and resolves on its own filesystem (see `src/embed-docs/tools/`).
 *
 * Rebrand: the default hints prefer `squadrules` paths and retain the prior
 * `kairos` paths as fallbacks so existing installations keep working. The env
 * var name (`KAIROS_LOCAL_ARTIFACT_DIRS`) is unchanged.
 */
export const KAIROS_LOCAL_ARTIFACT_DIRS_DEFAULT =
  'project://.local/squadrules/work,user://.config/squadrules/work,project://.local/kairos/work,user://.config/kairos/work';

export function parseLocalArtifactDirHints(raw: string): readonly string[] {
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) {
    throw new Error(
      'KAIROS_LOCAL_ARTIFACT_DIRS must list at least one hint (e.g. project://.local/squadrules/work)'
    );
  }
  for (const hint of items) {
    const match = /^(project|user):\/\/(.+)$/.exec(hint);
    if (!match) {
      throw new Error(
        `Invalid scheme in KAIROS_LOCAL_ARTIFACT_DIRS entry "${hint}". Use project://<rel> or user://<rel>.`
      );
    }
    const rel = match[2]!;
    if (rel.startsWith('/')) {
      throw new Error(
        `KAIROS_LOCAL_ARTIFACT_DIRS entry "${hint}" must use a safe relative path; absolute paths are not allowed.`
      );
    }
    if (rel.split('/').includes('..')) {
      throw new Error(
        `KAIROS_LOCAL_ARTIFACT_DIRS entry "${hint}" must not contain ".." segments.`
      );
    }
  }
  return Object.freeze(items);
}
