/**
 * Unit tests for the materialize instruction emitted in `activate`'s
 * `linked_artifacts[].materialize` (ADR 0026 artifact-backed gates).
 *
 * The materialize field is a structured instruction object that tells the agent
 * to call the MCP `export` tool directly, write the content to disk, verify the
 * digest, and set permissions. This eliminates the CLI dependency.
 */

import { describe, expect, it } from '@jest/globals';
import { buildArtifactMaterializeInstruction } from '../../src/tools/artifact-materialize-command.js';

const SHA = 'a'.repeat(64);

describe('buildArtifactMaterializeInstruction', () => {
  it('returns a structured instruction object with the MCP export tool call', () => {
    const instruction = buildArtifactMaterializeInstruction({
      transport: 'stdio',
      downloadUrl: 'squadrules://artifact/isolation-guard',
      relativePath: 'artifacts/isolation-guard.py',
      sha256: SHA
    });

    expect(instruction.tool).toBe('export');
    expect(instruction.arguments.uri).toBe('squadrules://artifact/isolation-guard');
    expect(instruction.arguments.format).toBe('source');
    expect(instruction.out).toBe('$SQUADRULES_LOCAL_ARTIFACT_DIR/artifacts/isolation-guard.py');
    expect(instruction.sha256).toBe(SHA);
    expect(instruction.chmod).toBe('700');
  });

  it('uses the download URL as the artifact URI for stdio transport', () => {
    const instruction = buildArtifactMaterializeInstruction({
      transport: 'stdio',
      downloadUrl: 'squadrules://artifact/task-isolation',
      relativePath: 'artifacts/task_isolation.py',
      sha256: SHA
    });

    expect(instruction.arguments.uri).toBe('squadrules://artifact/task-isolation');
  });

  it('uses the capability URL as the artifact URI for http transport', () => {
    const instruction = buildArtifactMaterializeInstruction({
      transport: 'http',
      downloadUrl: 'https://example.test/export/artifact/token',
      relativePath: 'artifacts/isolation-guard.py',
      sha256: SHA
    });

    expect(instruction.arguments.uri).toBe('https://example.test/export/artifact/token');
    expect(instruction.arguments.format).toBe('source');
  });

  it('constructs the out path from the relative path', () => {
    const instruction = buildArtifactMaterializeInstruction({
      transport: 'stdio',
      downloadUrl: 'squadrules://artifact/gates',
      relativePath: 'gates.py',
      sha256: SHA
    });

    expect(instruction.out).toBe('$SQUADRULES_LOCAL_ARTIFACT_DIR/gates.py');
  });

  it('preserves the sha256 digest for verification', () => {
    const customSha = 'b'.repeat(64);
    const instruction = buildArtifactMaterializeInstruction({
      transport: 'stdio',
      downloadUrl: 'squadrules://artifact/gates',
      relativePath: 'artifacts/gates.py',
      sha256: customSha
    });

    expect(instruction.sha256).toBe(customSha);
  });
});
