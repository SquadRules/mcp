/**
 * squadrules serve — run the SQUADRULES MCP server (same bootstrap as `node dist/bootstrap.js`).
 * Transport: `--transport` overrides `TRANSPORT_TYPE`; default for this command is stdio.
 * Main HTTP listener: `--server-port` wins over `SERVER_PORT` (same resolution as server config).
 * Other CLI commands do not read `--transport` or `--server-port` unless those env vars are set in the shell.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { config as dotenvConfig } from 'dotenv';
import { writeStderr } from '../output.js';
import { writeConfig } from '../config-file.js';

const VALID = new Set(['stdio', 'http']);

export type ServeTransport = 'stdio' | 'http';

function parseListenPort(raw: string, label: string): number {
  const n = parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid ${label} port "${raw}" (use 1–65535)`);
  }
  return n;
}

/**
 * Resolve main HTTP listen port for `squadrules serve`: CLI --server-port > SERVER_PORT > unset (inherit in child).
 */
export function resolveServeServerPort(cliServerPort: string | undefined): number | undefined {
  const trimmed = cliServerPort?.trim();
  if (trimmed) {
    return parseListenPort(trimmed, '--server-port');
  }
  const fromEnv = process.env['SERVER_PORT']?.trim();
  if (fromEnv) {
    return parseListenPort(fromEnv, 'SERVER_PORT');
  }
  return undefined;
}

/**
 * Resolve MCP transport for `squadrules serve`: CLI --transport > TRANSPORT_TYPE > defaultStdio.
 */
export function resolveServeTransport(cliTransport: string | undefined, defaultStdio = true): ServeTransport {
  const trimmed = cliTransport?.trim().toLowerCase();
  if (trimmed) {
    if (!VALID.has(trimmed)) {
      throw new Error(`Invalid --transport "${cliTransport}" (use stdio or http)`);
    }
    return trimmed as ServeTransport;
  }
  const fromEnv = process.env['TRANSPORT_TYPE']?.trim().toLowerCase();
  if (fromEnv && VALID.has(fromEnv)) {
    return fromEnv as ServeTransport;
  }
  return defaultStdio ? 'stdio' : 'http';
}

function findPackageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    const pkgJson = path.join(dir, 'package.json');
    if (existsSync(pkgJson)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJson, 'utf8')) as { name?: string };
        if (pkg.name === '@squadrules/mcp') {
          return dir;
        }
      } catch {
        // ignore
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

function bootstrapEntry(root: string): string[] {
  const distBootstrap = path.join(root, 'dist', 'bootstrap.js');
  if (existsSync(distBootstrap)) {
    return [distBootstrap];
  }
  const srcBootstrap = path.join(root, 'src', 'bootstrap.ts');
  return ['--loader', 'ts-node/esm', srcBootstrap];
}

export function serveCommand(program: Command): void {
  program
    .command('serve')
    .description(
      'Run the SQUADRULES MCP server (HTTP or stdio). Same stack as Docker Compose / dev:start when using HTTP. Root --url does not set the listen address; use SERVER_PORT / --server-port.'
    )
    .option('--env-file <path>', 'Path to dotenv file', '.env')
    .option('--metrics-port <n>', 'Metrics listen port (sets METRICS_PORT)')
    .option('--transport <mode>', 'Transport: stdio or http (overrides TRANSPORT_TYPE for this process)')
    .option(
      '--server-port <port>',
      'Main HTTP listener port (sets SERVER_PORT for this process; with --server-port, updates CLI defaultUrl)'
    )
    .action(
      async (options: {
        envFile?: string;
        metricsPort?: string;
        transport?: string;
        serverPort?: string;
      }) => {
        const envPath = options.envFile ?? '.env';
        if (existsSync(envPath)) {
          dotenvConfig({ path: envPath, quiet: true });
        }
        if (options.metricsPort !== undefined && options.metricsPort !== '') {
          const n = parseInt(options.metricsPort, 10);
          if (!Number.isFinite(n) || n < 1) {
            writeStderr(`Invalid --metrics-port: ${options.metricsPort}\n`);
            process.exit(1);
          }
          process.env['METRICS_PORT'] = String(n);
        }

        const envBefore = process.env['TRANSPORT_TYPE'];
        let transport: ServeTransport;
        try {
          transport = resolveServeTransport(options.transport, true);
        } catch (e) {
          program.error(e instanceof Error ? e.message : String(e));
          return;
        }

        let listenPort: number | undefined;
        try {
          listenPort = resolveServeServerPort(options.serverPort);
        } catch (e) {
          program.error(e instanceof Error ? e.message : String(e));
          return;
        }

        const source: 'cli' | 'env' | 'default' = options.transport?.trim()
          ? 'cli'
          : envBefore?.trim()
            ? 'env'
            : 'default';

        if (options.serverPort?.trim()) {
          try {
            await writeConfig({ apiUrl: `http://localhost:${listenPort}` });
          } catch (e) {
            program.error(
              e instanceof Error
                ? `squadrules serve: could not update CLI config defaultUrl: ${e.message}`
                : String(e)
            );
            return;
          }
        }

        const root = findPackageRoot();
        const args = bootstrapEntry(root);
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          TRANSPORT_TYPE: transport,
          SQUADRULES_CLI_SERVE: '1',
          SQUADRULES_CLI_TRANSPORT_SOURCE: source
        };
        if (listenPort !== undefined) {
          env['SERVER_PORT'] = String(listenPort);
        }

        const child = spawn(process.execPath, args, {
          cwd: root,
          env,
          stdio: 'inherit'
        });

        child.on('error', (err) => {
          process.stderr.write(`squadrules serve: failed to start server: ${err.message}\n`);
          process.exitCode = 1;
        });

        child.on('exit', (code, signal) => {
          if (signal) {
            process.kill(process.pid, signal);
          }
          process.exit(code ?? 0);
        });
      }
    );
}
