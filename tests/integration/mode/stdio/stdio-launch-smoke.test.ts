import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { parse as parseDotenv } from 'dotenv';
import { applyLocalStdioEnv } from '../../../utils/stdio-simple-env.js';
import { withRawOnFail } from '../../../utils/expect-with-raw.js';

const BOOTSTRAP_PATH = path.resolve(process.cwd(), 'dist/bootstrap.js');
const SOURCE_BOOTSTRAP_PATH = path.resolve(process.cwd(), 'src/bootstrap.ts');
const CLI_PATH = path.resolve(process.cwd(), 'dist/cli/index.js');
const SOURCE_CLI_PATH = path.resolve(process.cwd(), 'src/cli/index.ts');
const ROOT_ENV_PATH = path.resolve(process.cwd(), '.env');
const ACTIVE_PROFILE_ENV_PATH = (() => {
  const envName = process.env.ENV;
  if (!envName) return null;
  const profilePath = path.resolve(process.cwd(), `.env.${envName}`);
  return fs.existsSync(profilePath) ? profilePath : null;
})();

function readDotEnv(pathname: string): Record<string, string> {
  if (!fs.existsSync(pathname)) {
    return {};
  }
  return parseDotenv(fs.readFileSync(pathname));
}

const FILE_ENV = {
  ...readDotEnv(ROOT_ENV_PATH),
  ...(ACTIVE_PROFILE_ENV_PATH ? readDotEnv(ACTIVE_PROFILE_ENV_PATH) : {})
};

function hasEmbeddingConfig(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.OPENAI_API_KEY ||
    env.TEI_BASE_URL ||
    (env.OPENAI_API_URL && env.OPENAI_EMBEDDING_MODEL)
  );
}

function createStdioEnv(): Record<string, string> {
  const result: Record<string, string> = {};
  // Copy process.env, converting undefined to empty string
  for (const [key, value] of Object.entries(process.env)) {
    result[key] = value ?? '';
  }
  // Apply FILE_ENV overrides
  for (const [key, value] of Object.entries(FILE_ENV)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  // Apply explicit overrides
  applyLocalStdioEnv(result);
  result.REDIS_URL = process.env.REDIS_URL ?? FILE_ENV.REDIS_URL ?? '';
  return result;
}

function spawnStdioServer(): ChildProcessWithoutNullStreams {
  const args = fs.existsSync(BOOTSTRAP_PATH)
    ? [BOOTSTRAP_PATH]
    : ['--loader', 'ts-node/esm', SOURCE_BOOTSTRAP_PATH];

  return spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: createStdioEnv(),
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

/**
 * Spawn the CLI entry (`dist/cli/index.js`) with no subcommand — the path
 * `npx -y @squadrules/mcp` takes.  The bare-invocation guard injects `serve`,
 * which defaults to stdio transport.
 */
function spawnCliBare(): ChildProcessWithoutNullStreams {
  const args = fs.existsSync(CLI_PATH)
    ? [CLI_PATH]
    : ['--loader', 'ts-node/esm', SOURCE_CLI_PATH];

  return spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: createStdioEnv(),
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

describe('STDIO launch smoke', () => {
  test('CLI bare invocation emits no non-protocol bytes to stdout', async () => {
    const child = spawnCliBare();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    // Wait long enough for the CLI → serve → bootstrap chain to complete boot.
    await sleep(8000);

    if (child.exitCode !== null) {
      const stderrText = Buffer.concat(stderrChunks).toString('utf8');
      throw new Error(`CLI stdio server exited early (code=${child.exitCode}): ${stderrText}`);
    }

    const startupStdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
    expect(startupStdout).toBe('');

    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
      }, 5000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }, 45000);

  test('startup does not emit non-protocol bytes to stdout', async () => {
    const child = spawnStdioServer();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    await sleep(1200);

    if (child.exitCode !== null) {
      const stderrText = Buffer.concat(stderrChunks).toString('utf8');
      throw new Error(`stdio server exited early (code=${child.exitCode}): ${stderrText}`);
    }

    const startupStdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
    expect(startupStdout).toBe('');

    child.kill('SIGTERM');
    // Wait for exit with SIGKILL fallback after 5s
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
      }, 5000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }, 30000);

  test('stdio transport exposes full MCP server capabilities per spec', async () => {
    const env = createStdioEnv();
    if (!hasEmbeddingConfig(env)) {
      return;
    }
    const args = fs.existsSync(BOOTSTRAP_PATH)
      ? [BOOTSTRAP_PATH]
      : ['--loader', 'ts-node/esm', SOURCE_BOOTSTRAP_PATH];
    const client = new Client({ name: 'stdio-capabilities-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args,
      env,
      cwd: process.cwd()
    });

    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('stdio client connect timed out after 20000ms')), 20000)
      ),
    ]);

    try {
      // ── 1. Server capabilities (initialize response) ──────────────
      let caps;
      try {
        caps = client.getServerCapabilities();
      } catch (e: any) {
        throw new Error(`[step 1: getServerCapabilities] ${e?.message ?? e}`);
      }
      withRawOnFail(caps, () => {
        expect(caps).toBeDefined();
        expect(caps!.tools).toBeDefined();
        expect(caps!.resources).toBeDefined();
        expect(caps!.prompts).toBeDefined();
      }, 'server capabilities');

      // ── 2. Server version info ────────────────────────────────────
      let serverVersion;
      try {
        serverVersion = client.getServerVersion();
      } catch (e: any) {
        throw new Error(`[step 2: getServerVersion] ${e?.message ?? e}`);
      }
      withRawOnFail(serverVersion, () => {
        expect(serverVersion).toBeDefined();
        expect(serverVersion!.name).toBe('SquadRules');
        expect(typeof serverVersion!.version).toBe('string');
        expect(serverVersion!.version.length).toBeGreaterThan(0);
      }, 'server version');

      // ── 3. tools/list ─────────────────────────────────────────────
      let toolsResult;
      try {
        toolsResult = await client.listTools();
      } catch (e: any) {
        throw new Error(`[step 3: tools/list] ${e?.message ?? e}`);
      }
      withRawOnFail(toolsResult, () => {
        expect(Array.isArray(toolsResult.tools)).toBe(true);
        expect(toolsResult.tools.length).toBeGreaterThan(0);

        const names = toolsResult.tools.map((t) => t.name);
        // Core workflow tools
        expect(names).toContain('activate');
        expect(names).toContain('forward');
        expect(names).toContain('reward');
        expect(names).toContain('train');
        expect(names).toContain('tune');
        // Utility tools
        expect(names).toContain('delete');
        expect(names).toContain('export');
        expect(names).toContain('spaces');

        // Every tool must have a name, title, description, and valid inputSchema
        for (const tool of toolsResult.tools) {
          expect(typeof tool.name).toBe('string');
          expect(tool.name.length).toBeGreaterThan(0);
          expect(tool).toHaveProperty('inputSchema');
          expect(tool.inputSchema).toBeDefined();
          expect(tool.inputSchema.type).toBe('object');
          if (tool.description !== undefined) {
            expect(typeof tool.description).toBe('string');
          }
        }

        // Caching hints (2026-07-28 spec): ttlMs must be >= 0 if present
        if ('ttlMs' in toolsResult && toolsResult.ttlMs !== undefined) {
          expect(Number(toolsResult.ttlMs)).toBeGreaterThanOrEqual(0);
        }
        if ('cacheScope' in toolsResult && toolsResult.cacheScope !== undefined) {
          expect(['public', 'private']).toContain(toolsResult.cacheScope);
        }
      }, 'tools/list');

      // ── 4. resources/list ─────────────────────────────────────────
      let resourcesResult;
      try {
        resourcesResult = await client.listResources();
      } catch (e: any) {
        throw new Error(`[step 4: resources/list] ${e?.message ?? e}`);
      }
      withRawOnFail(resourcesResult, () => {
        expect(Array.isArray(resourcesResult.resources)).toBe(true);
        expect(resourcesResult.resources.length).toBeGreaterThan(0);

        for (const res of resourcesResult.resources) {
          expect(typeof res.uri).toBe('string');
          expect(res.uri.length).toBeGreaterThan(0);
          expect(typeof res.name).toBe('string');
          expect(res.name.length).toBeGreaterThan(0);
        }

        // Caching hints
        if ('ttlMs' in resourcesResult && resourcesResult.ttlMs !== undefined) {
          expect(Number(resourcesResult.ttlMs)).toBeGreaterThanOrEqual(0);
        }
        if ('cacheScope' in resourcesResult && resourcesResult.cacheScope !== undefined) {
          expect(['public', 'private']).toContain(resourcesResult.cacheScope);
        }
      }, 'resources/list');

      // ── 5. resources/templates/list ───────────────────────────────
      let templatesResult;
      try {
        templatesResult = await client.listResourceTemplates();
      } catch (e: any) {
        throw new Error(`[step 5: resources/templates/list] ${e?.message ?? e}`);
      }
      withRawOnFail(templatesResult, () => {
        expect(Array.isArray(templatesResult.resourceTemplates)).toBe(true);
        // May be empty (no templates registered), but the call must succeed
        for (const tmpl of templatesResult.resourceTemplates) {
          expect(typeof tmpl.uriTemplate).toBe('string');
          expect(tmpl.uriTemplate.length).toBeGreaterThan(0);
          expect(typeof tmpl.name).toBe('string');
          expect(tmpl.name.length).toBeGreaterThan(0);
        }

        // Caching hints
        if ('ttlMs' in templatesResult && templatesResult.ttlMs !== undefined) {
          expect(Number(templatesResult.ttlMs)).toBeGreaterThanOrEqual(0);
        }
        if ('cacheScope' in templatesResult && templatesResult.cacheScope !== undefined) {
          expect(['public', 'private']).toContain(templatesResult.cacheScope);
        }
      }, 'resources/templates/list');

      // ── 6. prompts/list ───────────────────────────────────────────
      let promptsResult;
      try {
        promptsResult = await client.listPrompts();
      } catch (e: any) {
        throw new Error(`[step 6: prompts/list] ${e?.message ?? e}`);
      }
      withRawOnFail(promptsResult, () => {
        expect(Array.isArray(promptsResult.prompts)).toBe(true);
        // May be empty, but the call must succeed
        for (const prompt of promptsResult.prompts) {
          expect(typeof prompt.name).toBe('string');
          expect(prompt.name.length).toBeGreaterThan(0);
        }

        // Caching hints
        if ('ttlMs' in promptsResult && promptsResult.ttlMs !== undefined) {
          expect(Number(promptsResult.ttlMs)).toBeGreaterThanOrEqual(0);
        }
        if ('cacheScope' in promptsResult && promptsResult.cacheScope !== undefined) {
          expect(['public', 'private']).toContain(promptsResult.cacheScope);
        }
      }, 'prompts/list');
    } finally {
      await client.close();
      await sleep(500);
    }
  }, 45000);
});
