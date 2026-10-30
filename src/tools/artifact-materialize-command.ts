/**
 * Build the materialize instruction for one adapter-linked artifact.
 *
 * The returned object instructs the agent to call the MCP `export` tool
 * directly, write the content to disk, verify the digest, and make the file
 * executable. This eliminates the CLI dependency — any MCP-connected agent can
 * materialize artifacts without requiring a specific CLI version.
 */

export const SQUADRULES_LOCAL_ARTIFACT_DIR_ENV = 'SQUADRULES_LOCAL_ARTIFACT_DIR';

export interface ArtifactMaterializeInput {
  transport: 'http' | 'stdio';
  downloadUrl: string;
  /** Skill-root-relative artifact path; the payload lands here under the artifact dir. */
  relativePath: string;
  sha256: string;
}

export interface MaterializeInstruction {
  /** MCP tool to call. */
  tool: 'export';
  /** Arguments for the MCP tool call. */
  arguments: {
    uri: string;
    format: 'source';
  };
  /** Absolute path where the agent must write the content (uses $SQUADRULES_LOCAL_ARTIFACT_DIR). */
  out: string;
  /** SHA-256 digest the agent must verify after writing. */
  sha256: string;
  /** File permissions the agent must set after verification. */
  chmod: '700';
}

export function buildArtifactMaterializeInstruction(input: ArtifactMaterializeInput): MaterializeInstruction {
  const outPath = `$${SQUADRULES_LOCAL_ARTIFACT_DIR_ENV}/${input.relativePath}`;
  return {
    tool: 'export',
    arguments: {
      uri: input.downloadUrl,
      format: 'source'
    },
    out: outPath,
    sha256: input.sha256,
    chmod: '700'
  };
}
