/**
 * CLI train batch: directory and --recursive
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  execAsync,
  BASE_URL,
  CLI_PATH,
  setupServerCheck,
  setupCliConfigWithLogin,
  requireMcpServerAndCliLogin
} from './cli-commands-shared.js';
import { isHttpTransport } from '../utils/auth-headers.js';

const _d = isHttpTransport() ? describe : describe.skip;

function minimalProtocolMd(title: string): string {
  return `# ${title}

## Activation Patterns

Run when user says "${title}".

## Step 1: Setup

Basic setup.

\`\`\`json
{"contract":{"type":"shell","shell":{"cmd":"echo ok","timeout_seconds":5},"required":true}}
\`\`\`

## Reward Signal

Done.
`;
}

_d('CLI train directory batch', () => {
  let serverAvailable = false;
  let cliLoggedIn = false;

  beforeAll(async () => {
    serverAvailable = await setupServerCheck();
    cliLoggedIn = await setupCliConfigWithLogin();
  }, 60000);

  test('train directory stores all root .md files and returns batch JSON', async () => {
    requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);

    const ts = Date.now();
    const dir = mkdtempSync(join(tmpdir(), 'squadrules-train-batch-'));
    try {
      writeFileSync(join(dir, 'z-second.md'), minimalProtocolMd(`CLI Batch Z ${ts}`), 'utf-8');
      writeFileSync(join(dir, 'a-first.md'), minimalProtocolMd(`CLI Batch A ${ts}`), 'utf-8');

      const { stdout, stderr } = await execAsync(
        `node ${CLI_PATH} train --url ${BASE_URL} --force "${dir}"`,
        { timeout: 120000 }
      );

      expect(stderr).toBe('');
      const result = JSON.parse(stdout) as {
        batch: boolean;
        root: string;
        results: Array<{ path: string; ok: boolean; status?: string; items?: unknown[]; error?: string }>;
      };
      expect(result.batch).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.results[0]!.path).toBe('a-first.md');
      expect(result.results[1]!.path).toBe('z-second.md');
      expect(result.results.every(r => r.ok)).toBe(true);
      expect(result.results.every(r => r.status === 'stored')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);

  test('train --recursive includes nested .md files', async () => {
    requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);

    const ts = Date.now();
    const dir = mkdtempSync(join(tmpdir(), 'squadrules-train-rec-'));
    try {
      mkdirSync(join(dir, 'nested'), { recursive: true });
      writeFileSync(join(dir, 'root.md'), minimalProtocolMd(`CLI Rec Root ${ts}`), 'utf-8');
      writeFileSync(join(dir, 'nested', 'deep.md'), minimalProtocolMd(`CLI Rec Deep ${ts}`), 'utf-8');

      const { stdout, stderr } = await execAsync(
        `node ${CLI_PATH} train --url ${BASE_URL} --force --recursive "${dir}"`,
        { timeout: 120000 }
      );

      expect(stderr).toBe('');
      const result = JSON.parse(stdout) as {
        batch: boolean;
        results: Array<{ path: string; ok: boolean }>;
      };
      expect(result.batch).toBe(true);
      expect(result.results).toHaveLength(2);
      const paths = result.results.map(r => r.path).sort();
      expect(paths).toEqual(['nested/deep.md', 'root.md']);
      expect(result.results.every(r => r.ok)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);

  test('train --recursive skips README.md at root and in subdirs', async () => {
    requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);

    const ts = Date.now();
    const dir = mkdtempSync(join(tmpdir(), 'squadrules-train-readme-rec-'));
    try {
      mkdirSync(join(dir, 'nested'), { recursive: true });
      writeFileSync(join(dir, 'root.md'), minimalProtocolMd(`CLI ReadmeRec Root ${ts}`), 'utf-8');
      writeFileSync(join(dir, 'nested', 'deep.md'), minimalProtocolMd(`CLI ReadmeRec Deep ${ts}`), 'utf-8');
      writeFileSync(join(dir, 'README.md'), '# Human docs only\n', 'utf-8');
      writeFileSync(join(dir, 'nested', 'README.md'), '# Nested readme\n', 'utf-8');

      const { stdout, stderr } = await execAsync(
        `node ${CLI_PATH} train --url ${BASE_URL} --force --recursive "${dir}"`,
        { timeout: 120000 }
      );

      expect(stderr).toBe('');
      const result = JSON.parse(stdout) as {
        batch: boolean;
        results: Array<{ path: string; ok: boolean }>;
      };
      expect(result.batch).toBe(true);
      expect(result.results).toHaveLength(2);
      const paths = result.results.map(r => r.path).sort();
      expect(paths).toEqual(['nested/deep.md', 'root.md']);
      expect(result.results.every(r => r.ok)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);

  test('train directory batch skips root README.md only', async () => {
    requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);

    const ts = Date.now();
    const dir = mkdtempSync(join(tmpdir(), 'squadrules-train-readme-flat-'));
    try {
      writeFileSync(join(dir, 'a.md'), minimalProtocolMd(`CLI ReadmeFlat A ${ts}`), 'utf-8');
      writeFileSync(join(dir, 'README.md'), '# Human docs\n', 'utf-8');

      const { stdout, stderr } = await execAsync(
        `node ${CLI_PATH} train --url ${BASE_URL} --force "${dir}"`,
        { timeout: 120000 }
      );

      expect(stderr).toBe('');
      const result = JSON.parse(stdout) as { batch: boolean; results: Array<{ path: string }> };
      expect(result.batch).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.path).toBe('a.md');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);

  test('train without --recursive skips nested .md', async () => {
    requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);

    const ts = Date.now();
    const dir = mkdtempSync(join(tmpdir(), 'squadrules-train-flat-'));
    try {
      mkdirSync(join(dir, 'nested'), { recursive: true });
      writeFileSync(join(dir, 'only-root.md'), minimalProtocolMd(`CLI Flat Root ${ts}`), 'utf-8');
      writeFileSync(join(dir, 'nested', 'skip.md'), minimalProtocolMd(`CLI Flat Skip ${ts}`), 'utf-8');

      const { stdout, stderr } = await execAsync(
        `node ${CLI_PATH} train --url ${BASE_URL} --force "${dir}"`,
        { timeout: 120000 }
      );

      expect(stderr).toBe('');
      const result = JSON.parse(stdout) as { batch: boolean; results: unknown[] };
      expect(result.batch).toBe(true);
      expect(result.results).toHaveLength(1);
      expect((result.results[0] as { path: string }).path).toBe('only-root.md');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);

  test('batch train auto-uploads co-located artifact files when --model is provided', async () => {
    requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);

    const ts = Date.now();
    const dir = mkdtempSync(join(tmpdir(), 'squadrules-train-artifacts-'));
    try {
      writeFileSync(join(dir, 'skill.md'), minimalProtocolMd(`CLI Artifacts ${ts}`), 'utf-8');
      writeFileSync(join(dir, 'helper.py'), "print('hello')\n", 'utf-8');
      writeFileSync(join(dir, 'config.yaml'), 'key: value\n', 'utf-8');

      const { stdout, stderr } = await execAsync(
        `node ${CLI_PATH} train --url ${BASE_URL} --force --recursive --model gpt-4 "${dir}"`,
        { timeout: 120000 }
      );

      expect(stderr).toBe('');
      const result = JSON.parse(stdout) as {
        batch: boolean;
        root: string;
        results: Array<{
          path: string;
          ok: boolean;
          status?: string;
          items?: unknown[];
          error?: string;
          artifacts?: Array<{ path: string; ok: boolean; status?: string; items?: unknown[]; error?: string }>;
        }>;
      };
      expect(result.batch).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.ok).toBe(true);
      expect(result.results[0]!.artifacts).toBeDefined();
      expect(result.results[0]!.artifacts).toHaveLength(2);
      expect(result.results[0]!.artifacts!.every(a => a.ok)).toBe(true);
      expect(result.results[0]!.artifacts!.every(a => a.status === 'stored')).toBe(true);
      const artifactPaths = result.results[0]!.artifacts!.map(a => a.path).sort();
      expect(artifactPaths).toContain('config.yaml');
      expect(artifactPaths).toContain('helper.py');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);

  test('batch train skips artifact files and emits artifact_skipped to stderr when --model is omitted', async () => {
    requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);

    const ts = Date.now();
    const dir = mkdtempSync(join(tmpdir(), 'squadrules-train-artifacts-nomodel-'));
    try {
      writeFileSync(join(dir, 'skill.md'), minimalProtocolMd(`CLI ArtifactsNoModel ${ts}`), 'utf-8');
      writeFileSync(join(dir, 'helper.py'), "print('hello')\n", 'utf-8');
      writeFileSync(join(dir, 'config.yaml'), 'key: value\n', 'utf-8');

      const { stdout, stderr } = await execAsync(
        `node ${CLI_PATH} train --url ${BASE_URL} --force "${dir}"`,
        { timeout: 120000 }
      );

      const result = JSON.parse(stdout) as {
        batch: boolean;
        results: Array<{
          path: string;
          ok: boolean;
          artifacts?: unknown[];
        }>;
      };
      expect(result.batch).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.ok).toBe(true);
      expect(result.results[0]!.artifacts).toBeUndefined();
      expect(stderr).toMatch(/artifact_skipped/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);

  test('train empty directory exits with error', async () => {
    requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);

    const dir = mkdtempSync(join(tmpdir(), 'squadrules-train-empty-'));
    try {
      try {
        await execAsync(`node ${CLI_PATH} train --url ${BASE_URL} "${dir}"`, { timeout: 30000 });
        expect(true).toBe(false);
      } catch (e: unknown) {
        const err = e as { code?: number; stderr?: string };
        expect(err.code).toBe(1);
        expect(String(err.stderr ?? '')).toMatch(/No \.md files/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
