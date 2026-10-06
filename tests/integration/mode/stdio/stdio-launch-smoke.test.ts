import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { parse as parseDotenv } from 'dotenv';
import { applyLocalStdioEnv } from '../../../utils/stdio-simple-env.js';

const BOOTSTRAP_PATH = path.resolve(process.cwd(), 'dist/bootstrap.js');
const SOURCE_BOOTSTRAP_PATH = path.resolve(process.cwd(), 'src/bootstrap.ts');
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

describe('STDIO launch smoke', () => {
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

  test('initialize and listTools work over stdio client transport', async () => {
    const env = createStdioEnv();
    if (!hasEmbeddingConfig(env)) {
      // This integration requires the same embedding prerequisites as the server startup path.
      return;
    }
    const args = fs.existsSync(BOOTSTRAP_PATH)
      ? [BOOTSTRAP_PATH]
      : ['--loader', 'ts-node/esm', SOURCE_BOOTSTRAP_PATH];
    const client = new Client({ name: 'stdio-smoke-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args,
      env,
      cwd: process.cwd()
    });

    // Connect with a timeout so the test fails fast if the server hangs during startup
    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('stdio client connect timed out after 20000ms')), 20000)
      ),
    ]);
    const toolsResult = await client.listTools();

    expect(Array.isArray(toolsResult.tools)).toBe(true);
    expect(toolsResult.tools.length).toBeGreaterThan(0);

    await client.close();
    // Give the transport a moment to clean up the child process.
    // If the child lingers, SIGKILL it after 5s.
    await sleep(500);
  }, 30000);
});
