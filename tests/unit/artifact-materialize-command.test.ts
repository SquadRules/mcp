/**
 * Unit tests for the materialize command emitted in `activate`'s
 * `linked_artifacts[].materialize` (ADR 0026 artifact-backed gates).
 *
 * The stdio branch must hand the artifact bytes to the CLI's `--to` flag:
 * `squadrules export` never writes content bytes to stdout, so a `>` redirect
 * would capture the summary path and the `sha256sum -c` step would fail.
 */

import { describe, expect, it } from '@jest/globals';
import { buildArtifactMaterializeCommand } from '../../src/tools/artifact-materialize-command.js';

const SHA = 'a'.repeat(64);

describe('buildArtifactMaterializeCommand', () => {
  it('stdio: writes the payload with `export --as source --to`, never a stdout redirect', () => {
    const cmd = buildArtifactMaterializeCommand({
      transport: 'stdio',
      downloadUrl: 'squadrules://artifact/isolation-guard',
      relativePath: 'artifacts/isolation-guard.py',
      sha256: SHA
    });

    expect(cmd).toContain(
      'squadrules export --as source --to "$SQUADRULES_LOCAL_ARTIFACT_DIR/artifacts/isolation-guard.py" \'squadrules://artifact/isolation-guard\''
    );
    expect(cmd).not.toContain('>');
    expect(cmd).not.toContain('--format source');
    expect(cmd).not.toContain('--uri');
  });

  it('stdio: creates the parent directory, verifies the digest, and makes the file executable', () => {
    const cmd = buildArtifactMaterializeCommand({
      transport: 'stdio',
      downloadUrl: 'squadrules://artifact/isolation-guard',
      relativePath: 'artifacts/isolation-guard.py',
      sha256: SHA
    });

    expect(cmd.startsWith('mkdir -p "$SQUADRULES_LOCAL_ARTIFACT_DIR/artifacts" && ')).toBe(true);
    expect(cmd).toContain(`echo '${SHA}  artifacts/isolation-guard.py' | sha256sum -c`);
    expect(cmd.endsWith('chmod 700 "$SQUADRULES_LOCAL_ARTIFACT_DIR/artifacts/isolation-guard.py"')).toBe(true);
  });

  it('http: fetches the capability URL with curl into the same path', () => {
    const cmd = buildArtifactMaterializeCommand({
      transport: 'http',
      downloadUrl: 'https://example.test/export/artifact/token',
      relativePath: 'artifacts/isolation-guard.py',
      sha256: SHA
    });

    expect(cmd).toContain(
      'curl -fsSL \'https://example.test/export/artifact/token\' -o "$SQUADRULES_LOCAL_ARTIFACT_DIR/artifacts/isolation-guard.py"'
    );
    expect(cmd).toContain('sha256sum -c');
    expect(cmd).toContain('chmod 700');
  });

  it('omits the mkdir prefix for a root-level relative path', () => {
    const cmd = buildArtifactMaterializeCommand({
      transport: 'http',
      downloadUrl: 'https://example.test/export/artifact/token',
      relativePath: 'gates.py',
      sha256: SHA
    });

    expect(cmd.startsWith('curl ')).toBe(true);
    expect(cmd).not.toContain('mkdir -p');
  });

  it('quotes a single quote in the download URL so the command stays shell-safe', () => {
    const cmd = buildArtifactMaterializeCommand({
      transport: 'stdio',
      downloadUrl: "squadrules://artifact/it's-a-gate",
      relativePath: 'artifacts/gates.py',
      sha256: SHA
    });

    expect(cmd).toContain("'squadrules://artifact/it'\\''s-a-gate'");
  });
});
