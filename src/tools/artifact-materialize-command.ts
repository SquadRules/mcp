/**
 * Build the materialize instruction for one adapter-linked artifact.
 *
 * Byte-exactness is framework work, not agent work: the instruction carries an
 * exact shell line (`cmd`) that writes, verifies, and marks the file executable,
 * so the agent never re-types artifact bytes through an editor or a heredoc
 * (SquadRules/mcp#231). The byte source depends on the transport: HTTP serves the
 * stored bytes itself, stdio has no listener and goes through the `export` tool.
 */

export const SQUADRULES_LOCAL_ARTIFACT_DIR_ENV = 'SQUADRULES_LOCAL_ARTIFACT_DIR';

export interface ArtifactMaterializeInput {
  transport: 'http' | 'stdio';
  /** Artifact URI accepted by the `export` tool: `squadrules://artifact/{slug|uuid}`. */
  artifactUri: string;
  /** Capability download URL served by the HTTP transport. */
  downloadUrl: string;
  /** Skill-root-relative artifact path; the payload lands here under the artifact dir. */
  relativePath: string;
  /** SHA-256 hex of the stored artifact bytes. */
  sha256: string;
}

export interface MaterializeInstruction {
  /** MCP tool that returns the bytes (required on stdio, a read option on HTTP). */
  tool: 'export';
  arguments: {
    uri: string;
    format: 'source';
    /** Set on stdio: raw text cannot be re-written byte-exactly by an agent. */
    delivery?: 'inline_base64';
  };
  /** Absolute path where the bytes land (uses $SQUADRULES_LOCAL_ARTIFACT_DIR). */
  out: string;
  /** SHA-256 digest `cmd` verifies; check it against the same value. */
  sha256: string;
  /** File permissions the agent must set after verification. */
  chmod: '700';
  /** Exact POSIX shell line that writes the file, verifies the digest, and sets permissions. */
  cmd: string;
}

export function buildArtifactMaterializeInstruction(input: ArtifactMaterializeInput): MaterializeInstruction {
  const outPath = `$${SQUADRULES_LOCAL_ARTIFACT_DIR_ENV}/${input.relativePath}`;
  const outRef = `"${outPath}"`;
  const bytes =
    input.transport === 'http'
      ? `curl -fsS -o ${outRef} ${JSON.stringify(input.downloadUrl)}`
      : `: "\${B64:?B64 must hold the export response content field}" && printf '%s' "$B64" | base64 -d > ${outRef}`;
  const verify = `printf '%s  %s\\n' '${input.sha256}' ${outRef} | sha256sum -c`;
  return {
    tool: 'export',
    arguments:
      input.transport === 'http'
        ? { uri: input.artifactUri, format: 'source' }
        : { uri: input.artifactUri, format: 'source', delivery: 'inline_base64' },
    out: outPath,
    sha256: input.sha256,
    chmod: '700',
    cmd: `mkdir -p "$(dirname ${outRef})" && ${bytes} && ${verify} && chmod 700 ${outRef}`
  };
}
