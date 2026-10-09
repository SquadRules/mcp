/**
 * stdio + no-auth harness: spawns a subprocess with TRANSPORT_TYPE=stdio.
 * Readiness is MCP initialize (client.connect), not HTTP /health.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SCENARIOS } from './scenario.js';
import type { TestHarness } from './types.js';
import { callToolJson } from './helpers/mcp-call-normalize.js';
import { applyLocalStdioEnv } from '../../utils/stdio-simple-env.js';

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
  return parseDotenv(fs.readFileSync(pathname, 'utf8'));
}

const FILE_ENV = {
  ...readDotEnv(ROOT_ENV_PATH),
  ...(ACTIVE_PROFILE_ENV_PATH ? readDotEnv(ACTIVE_PROFILE_ENV_PATH) : {})
};

function createStdioChildEnv(metricsPort: number): Record<string, string> {
  // StdioClientTransport requires Record<string, string>, so coerce undefined -> '' while copying
  // the ambient env (same shape as tests/utils/mcp-client-utils.ts createStdioChildEnv).
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    env[key] = value ?? '';
  }
  for (const [key, value] of Object.entries(FILE_ENV)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  env.PORT = process.env.PORT ?? FILE_ENV.PORT ?? '4300';
  env.METRICS_PORT = String(metricsPort);
  env.REDIS_URL = process.env.REDIS_URL ?? FILE_ENV.REDIS_URL ?? '';
  applyLocalStdioEnv(env);
  return env;
}

export async function createStdioSimpleHarness(): Promise<TestHarness> {
  // SINGLE mode is the zero-config default: stdio transport, embedded LanceDB, auth off and
  // key-free fastembed embeddings. No ENV profile or external embedding key is required —
  // applyLocalStdioEnv (via createStdioChildEnv) pins the spawned child to that single-node shape.
  const metricsPort = 19990 + Math.floor(Math.random() * 200);
  const env = createStdioChildEnv(metricsPort);

  const args = fs.existsSync(BOOTSTRAP_PATH)
    ? [BOOTSTRAP_PATH]
    : ['--loader', 'ts-node/esm', SOURCE_BOOTSTRAP_PATH];

  const client = new Client({ name: 'squadrules-integration-stdio-harness', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args,
    env,
    cwd: process.cwd()
  });

  await client.connect(transport);

  return {
    scenario: SCENARIOS['stdio-simple'],
    callTool: (name, args) => callToolJson(client, name, args),
    close: async () => {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    }
  };
}
