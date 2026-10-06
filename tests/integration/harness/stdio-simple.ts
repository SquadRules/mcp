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

function hasEmbeddingConfig(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.OPENAI_API_KEY || env.TEI_BASE_URL || (env.OPENAI_API_URL && env.OPENAI_EMBEDDING_MODEL)
  );
}

function createStdioChildEnv(metricsPort: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...FILE_ENV,
    PORT: process.env.PORT ?? FILE_ENV.PORT ?? '4300',
    METRICS_PORT: String(metricsPort),
    REDIS_URL: process.env.REDIS_URL ?? FILE_ENV.REDIS_URL ?? ''
  };
  applyLocalStdioEnv(env);
  return env;
}

export async function createStdioSimpleHarness(): Promise<TestHarness> {
  if (process.env.ENV !== 'dev_stdio') {
    throw new Error(
      'createStdioSimpleHarness expects ENV=dev_stdio (use npm run test:integration:contracts:stdio-simple).'
    );
  }
  const metricsPort = 19990 + Math.floor(Math.random() * 200);
  const env = createStdioChildEnv(metricsPort);
  if (!hasEmbeddingConfig(env)) {
    throw new Error(
      'createStdioSimpleHarness requires embedding config (OPENAI_API_KEY, TEI_BASE_URL, or OPENAI_API_URL+OPENAI_EMBEDDING_MODEL) so the server can complete MCP startup.'
    );
  }

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
