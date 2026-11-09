/**
 * Real HTTP server child process for the graph-native API suites (ADR 0004/0042–0047).
 *
 * Why a child process: real ONNX must not run inside a Jest vm realm (ADR 0004 — a
 * fastembed/ONNX `Float32Array instanceof` check compares a host-realm constructor
 * against a vm-realm value and throws), and integration tests may not replace the
 * embedding provider with a fake. So the suites drive the *shipped* server over a real
 * loopback listener, and keep every assertion in the Jest realm.
 *
 * Two entries, one contract:
 *   - default (`dist`): `dist/bootstrap.js`, the same entry Docker and `squadrules
 *     serve` run. This is the mode a freshly built package proves.
 *   - opt-in (`SQUADRULES_GRAPH_API_SOURCE=true`): `src/bootstrap.ts` through the
 *     installed ts-node ESM transpile-only loader. Test-only current-source mode, so a
 *     suite can prove today's source without a full build. It is fail-closed: a missing
 *     loader or a source load error fails the boot and never falls back to `dist`.
 *     Transpile-only is not a typecheck; the build/typecheck gates stay their own step.
 *
 * Nothing here is stubbed: the child boots the production Express app, the embedded
 * LanceDB record store, the embedded LadybugDB graph and the local fastembed embedder,
 * with auth disabled (`AUTH_ENABLED=false` — the production single-tenant request
 * context) and per-server temporary dirs so two servers cannot share state.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** One HTTP response as the suites see it: a status and a parsed JSON object body. */
export interface ChildReply {
  status: number;
  body: Record<string, unknown>;
}

const DIST_BOOTSTRAP_ENTRY = join(process.cwd(), 'dist', 'bootstrap.js');
const SOURCE_BOOTSTRAP_ENTRY = join(process.cwd(), 'src', 'bootstrap.ts');
const TS_NODE_ESM_LOADER = join(
  process.cwd(),
  'node_modules',
  'ts-node',
  'esm',
  'transpile-only.mjs'
);

/** Which entry this child runs. `source` is the opt-in test-only current-source mode. */
type ServerMode = 'dist' | 'source';

/**
 * Read `SQUADRULES_GRAPH_API_SOURCE` strictly. Unset/`false` keeps the shipped build; only
 * an explicit `true` selects source. Any other value is a configuration error, not a
 * silent choice of mode.
 */
function serverMode(): ServerMode {
  const flag = process.env['SQUADRULES_GRAPH_API_SOURCE'];
  if (flag === undefined || flag === '' || flag === 'false') return 'dist';
  if (flag === 'true') return 'source';
  throw new Error(
    `SQUADRULES_GRAPH_API_SOURCE must be exactly "true" or "false"; got ${JSON.stringify(flag)}`
  );
}

/** Executable argv for the selected entry. Fail closed: no fallback between modes. */
function serverLaunch(): { mode: ServerMode; entry: string; execArgv: string[] } {
  const mode = serverMode();
  if (mode === 'source') {
    if (!existsSync(SOURCE_BOOTSTRAP_ENTRY)) {
      throw new Error(`source entry missing: ${SOURCE_BOOTSTRAP_ENTRY}`);
    }
    if (!existsSync(TS_NODE_ESM_LOADER)) {
      throw new Error(
        `ts-node ESM transpile-only loader missing: ${TS_NODE_ESM_LOADER}. ` +
          'Source mode needs the installed ts-node dev dependency and never falls back to dist.'
      );
    }
    // The loader resolves `.js` specifiers to the actual `.ts` sources (`src/bootstrap.ts`
    // imports `./index.js` mirroring the tsc emit), and transpiles them in this child.
    return { mode, entry: SOURCE_BOOTSTRAP_ENTRY, execArgv: ['--loader', TS_NODE_ESM_LOADER] };
  }
  if (!existsSync(DIST_BOOTSTRAP_ENTRY)) {
    throw new Error(
      `server entry missing: ${DIST_BOOTSTRAP_ENTRY}. Emit the build first (node node_modules/typescript/bin/tsc).`
    );
  }
  return { mode, entry: DIST_BOOTSTRAP_ENTRY, execArgv: [] };
}

/** Ask the OS for a free loopback port, then release it for the child to bind. */
async function reservePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => (port > 0 ? resolve(port) : reject(new Error('could not reserve a port'))));
    });
  });
}

/** Environment for one isolated server: real stores, real embedder, fresh dirs. */
function childEnv(dir: string, port: number, overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'] ?? '',
    HOME: process.env['HOME'] ?? '',
    TRANSPORT_TYPE: 'http',
    SERVER_PORT: String(port),
    AUTH_ENABLED: 'false',
    QDRANT_URL: '',
    EMBEDDING_PROVIDER: 'fastembed',
    OPENAI_API_KEY: '',
    TEI_BASE_URL: '',
    SQUADRULES_HOME: join(dir, 'home'),
    SQUADRULES_GRAPH_DB_ENABLED: 'true',
    SQUADRULES_GRAPH_DB_PATH: join(dir, 'graph'),
    SQUADRULES_INHERITANCE_CHECKPOINT_DIR: join(dir, 'checkpoints'),
    SQUADRULES_NO_BROWSER: '1',
    LOG_LEVEL: 'error',
    ...overrides
  };
  // Reuse the developer/CI model-weight cache instead of downloading it per server.
  for (const key of ['XDG_CACHE_HOME', 'FASTEMBED_CACHE_DIR']) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

/** Everything one suite needs to talk to a real, isolated server. */
export class ChildApiServer {
  private spawnError: Error | null = null;

  private constructor(
    readonly baseUrl: string,
    readonly dir: string,
    readonly mode: ServerMode,
    private readonly child: ChildProcess,
    private readonly logPath: string
  ) {
    // A spawn failure (e.g. a bad loader path) never sets `exitCode`; record it so
    // `waitForHealth` fails fast instead of polling until its deadline.
    child.once('error', (error) => {
      this.spawnError = error;
    });
  }

  /** Boot one server and wait for `/health`; throws with the server log tail on failure. */
  static async start(label: string, overrides: Record<string, string> = {}): Promise<ChildApiServer> {
    const launch = serverLaunch();
    const dir = mkdtempSync(join(tmpdir(), `squadrules-http-${label}-`));
    const port = await reservePort();
    const logPath = join(dir, 'server.log');
    // The child writes its own log file: a piped stdout nobody drains would block it.
    const logFd = openSync(logPath, 'a');
    let child: ChildProcess;
    try {
      child = spawn(process.execPath, [...launch.execArgv, launch.entry], {
        cwd: process.cwd(),
        env: childEnv(dir, port, overrides),
        stdio: ['ignore', logFd, logFd]
      });
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      throw error;
    } finally {
      closeSync(logFd);
    }
    const server = new ChildApiServer(`http://127.0.0.1:${port}`, dir, launch.mode, child, logPath);
    try {
      await server.waitForHealth();
    } catch (error) {
      // Stop THIS child only (never another server in the suite) and keep the temp dir's
      // log long enough to report the real boot failure before cleaning it up.
      const logTail = server.readLog();
      await server.stop();
      rmSync(dir, { recursive: true, force: true });
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}\nserver log tail:\n${logTail}`, { cause: error });
    }
    return server;
  }

  private async waitForHealth(): Promise<void> {
    // Source mode pays a one-time transpile of the import graph; give it more room than
    // the shipped build while staying inside the suites' 600 s test budget.
    const budgetMs = this.mode === 'source' ? 300_000 : 180_000;
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      if (this.spawnError) throw new Error(`server failed to spawn: ${this.spawnError.message}`);
      if (this.child.exitCode !== null) break;
      try {
        const reply = await this.get('/health');
        if (reply.status === 200) return;
      } catch {
        // Not listening yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (this.spawnError) throw new Error(`server failed to spawn: ${this.spawnError.message}`);
    const reason =
      this.child.exitCode !== null
        ? `server exited with code ${this.child.exitCode} before becoming healthy`
        : `server did not become healthy within ${budgetMs / 1000}s`;
    throw new Error(reason);
  }

  /** Real POST against this server's own listener. */
  async post(path: string, body: unknown): Promise<ChildReply> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: res.status, body: await readJson(res) };
  }

  /** Real GET against this server's own listener. */
  async get(path: string): Promise<ChildReply> {
    const res = await fetch(`${this.baseUrl}${path}`);
    return { status: res.status, body: await readJson(res) };
  }

  /** Forensics for a failed boot: the child's own stdout/stderr, not a summary. */
  readLog(): string {
    try {
      return readFileSync(this.logPath, 'utf8').split('\n').slice(-40).join('\n');
    } catch {
      return '(no server log)';
    }
  }

  /** Stop this server only — never another server in the same suite. */
  async stop(): Promise<void> {
    // `pid` is undefined when spawn itself failed; there is nothing to signal.
    if (this.child.pid === undefined || this.child.exitCode !== null) return;
    this.child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill('SIGKILL');
        resolve();
      }, 10_000);
      this.child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** Stop the server and delete its temporary dirs. */
  async dispose(): Promise<void> {
    await this.stop();
    rmSync(this.dir, { recursive: true, force: true });
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (text.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { value: parsed };
  } catch {
    return { raw: text };
  }
}
