// squadrules-compat-surface: preserves the docker compose project name kairos-mcp used by existing volumes/containers
import { describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('compose simple profile interpolation', () => {
  it('resolves config without fullstack-only secret variables', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kairos-compose-simple-'));

    try {
      copyFileSync(join(process.cwd(), 'compose.yaml'), join(tempDir, 'compose.yaml'));
      writeFileSync(
        join(tempDir, '.env'),
        ['OPENAI_API_KEY=test-openai-key', 'QDRANT_API_KEY=test-qdrant-key', 'AUTH_ENABLED=false'].join('\n')
      );

      const result = spawnSync('docker', ['compose', '-p', 'kairos-mcp-test', 'config'], {
        cwd: tempDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          REDIS_PASSWORD: '',
          KEYCLOAK_DB_PASSWORD: '',
          KEYCLOAK_ADMIN_PASSWORD: '',
        },
      });

      if (result.error) {
        throw result.error;
      }

      expect(result.status).toBe(0);
      expect(result.stderr).not.toContain('REDIS_PASSWORD must be set');
      expect(result.stderr).not.toContain('KEYCLOAK_DB_PASSWORD');
      expect(result.stderr).not.toContain('KEYCLOAK_ADMIN_PASSWORD');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
