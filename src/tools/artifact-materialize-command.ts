/**
 * Build the shell command that materializes one adapter-linked artifact into the
 * client-owned local artifact directory (`$SQUADRULES_LOCAL_ARTIFACT_DIR`).
 *
 * The emitted command must put the payload at the artifact's exact
 * skill-root-relative path, verify the stored digest, and make the file
 * executable — a shell contract then runs it by that path. HTTP transport
 * fetches a short-lived capability URL with `curl`. stdio transport has no
 * HTTP listener, so the CLI writes the payload to `--to`; `squadrules export`
 * never writes content bytes to stdout, so redirection would capture a summary
 * path instead of the artifact.
 */

export const SQUADRULES_LOCAL_ARTIFACT_DIR_ENV = 'SQUADRULES_LOCAL_ARTIFACT_DIR';

export interface ArtifactMaterializeInput {
  transport: 'http' | 'stdio';
  downloadUrl: string;
  /** Skill-root-relative artifact path; the payload lands here under the artifact dir. */
  relativePath: string;
  sha256: string;
}

function escapeShellSingleQuoted(value: string): string {
  return value.replace(/'/g, `'\\''`);
}

function escapeShellDoubleQuoted(value: string): string {
  return value.replace(/["\\$`]/g, '\\$&');
}

export function buildArtifactMaterializeCommand(input: ArtifactMaterializeInput): string {
  const relForPath = escapeShellDoubleQuoted(input.relativePath);
  const relEscaped = escapeShellSingleQuoted(input.relativePath);
  const shaEscaped = escapeShellSingleQuoted(input.sha256);
  const urlEscaped = escapeShellSingleQuoted(input.downloadUrl);
  const target = `"$${SQUADRULES_LOCAL_ARTIFACT_DIR_ENV}/${relForPath}"`;
  const parentDir = input.relativePath.includes('/')
    ? input.relativePath.slice(0, input.relativePath.lastIndexOf('/'))
    : '';
  const parentDirForPath = escapeShellDoubleQuoted(parentDir);
  const mkdirPart =
    parentDir.length > 0 ? `mkdir -p "$${SQUADRULES_LOCAL_ARTIFACT_DIR_ENV}/${parentDirForPath}" && ` : '';
  const fetchPart =
    input.transport === 'stdio'
      ? `squadrules export --as source --to ${target} '${urlEscaped}'`
      : `curl -fsSL '${urlEscaped}' -o ${target}`;
  const verifyPart = `(cd "$${SQUADRULES_LOCAL_ARTIFACT_DIR_ENV}" && echo '${shaEscaped}  ${relEscaped}' | sha256sum -c)`;
  return `${mkdirPart}${fetchPart} && ${verifyPart} && chmod 700 ${target}`;
}
