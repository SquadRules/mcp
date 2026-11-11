/**
 * Real-model shutdown regression gate (issue #297).
 *
 * Why this file exists. ADR 0049 records two facts that nothing asserted: `process.exit()`
 * while an `onnxruntime-node` `InferenceSession` is live aborts the process (SIGABRT,
 * shell status 134), and the safe stop is to close the handles the process owns and let
 * the event loop empty. Every suite that boots the shipped server does stop it, but none
 * checked *how* it stopped, and none checked what a fatal listen error does to a process
 * that already holds the model. Issue #297 keeps that gap open.
 *
 * What this gate proves, against the *shipped* bytes (`dist/bootstrap.js`, the entry
 * Docker and `squadrules serve` run - see `src/cli/commands/serve.ts`) with the real
 * fastembed/ONNX model loaded:
 *
 *   1. SIGTERM drains: the process exits naturally with status 0, after printing the
 *      shutdown marker, without the bounded last resort and without a native abort.
 *   2. A listen failure (port already in use) exits 1 through the same drain, keeps the
 *      operator-facing port message, and never runs the native teardown. That is the
 *      ADR 0049 exposure G13 removes from `src/http/http-server-startup.ts`.
 *
 * NOT asserted here: the late-registration branch of the shutdown registry. A listener
 * that registers after a drain began closes itself, but no process-level ordering makes
 * that reachable: a failed bind delivers its `error` on the event loop AFTER the boot's
 * `registerListener()` microtask (measured: the listener is already in the set), and a
 * signal during boot is answered by the 1-second bounded fallback before the listener
 * exists. That contract is proven directly in `tests/unit/shutdown-registry.test.ts`;
 * claiming it here would only assert a log line that never appears.
 *
 * Why a child process: real ONNX must not run inside a Jest vm realm (ADR 0004), and an
 * integration suite may not replace the embedding provider with a fake. Every assertion
 * stays in this realm; the child only produces the log and the exit status.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The packaged entry: `squadrules serve` spawns this file when `dist` exists. */
const SHIPPED_ENTRY = join(process.cwd(), 'dist', 'bootstrap.js');

/**
 * Log lines the assertions read, verbatim from `src/index.ts` and the boot sequence.
 * Asserting the exact text is deliberate: a rename must fail this gate loudly instead of
 * leaving it green while it checks nothing.
 */
const SHUTDOWN_MARKER = 'Received SIGTERM, shutting down';
const LAST_RESORT_MARKER = 'shutdown: last-resort exit';
/** `debug` line from `bootLocalRuntime()`: proves the real fastembed/ONNX model loaded. */
const MODEL_LOADED_MARKER = 'embedding: fastembed';
/** The ONNX teardown abort ADR 0049 documents; any occurrence means the gate failed. */
const NATIVE_ABORT_MARKER = 'mutex lock failed';

const HEALTH_BUDGET_MS = 180_000;
/**
 * Budget for a process to end. Generous because the failed-bind child has no health signal
 * to wait on: its whole boot runs before the bind is attempted, so this budget covers a cold
 * boot (store init, graph init, shipped-adapter seeding) and not just the drain.
 */
const EXIT_BUDGET_MS = 180_000;

interface ExitStatus {
  code: number | null;
  signal: NodeJS.Signals | null;
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

/**
 * Hold a port for the whole boot so the child's own bind fails.
 *
 * The blocker binds the SAME wildcard address the server binds (`0.0.0.0`), which is the
 * only address pair that conflicts everywhere. A `127.0.0.1` blocker is not enough: on
 * macOS a wildcard bind succeeds alongside a loopback-specific one (SO_REUSEADDR), so the
 * server would start normally and this test would prove nothing.
 */
async function occupyPort(): Promise<{ port: number; release: () => Promise<void> }> {
  const blocker = createServer();
  await new Promise<void>((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(0, '0.0.0.0', () => resolve());
  });
  const address = blocker.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  if (port <= 0) {
    blocker.close();
    throw new Error('could not occupy a loopback port');
  }
  return {
    port,
    release: () =>
      new Promise<void>((resolve) => {
        blocker.close(() => resolve());
      })
  };
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
    // `debug` is required, not incidental: the model-load line that proves the exposure is
    // live is a debug line. The last-resort marker is a warning, so it survives any level.
    LOG_LEVEL: 'debug',
    ...overrides
  };
  // Reuse the developer/CI model-weight cache instead of downloading it per server.
  for (const key of ['XDG_CACHE_HOME', 'FASTEMBED_CACHE_DIR']) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** One shipped server process, with its own log and its own exit status. */
class ShutdownChild {
  private exitStatus: ExitStatus | null = null;
  private readonly exited: Promise<ExitStatus>;

  private constructor(
    readonly dir: string,
    readonly port: number,
    private readonly child: ChildProcess,
    private readonly logPath: string
  ) {
    // Capture eagerly: the child can exit before the test asks for its status.
    this.exited = new Promise<ExitStatus>((resolve) => {
      child.once('exit', (code, signal) => {
        this.exitStatus = { code, signal };
        resolve(this.exitStatus);
      });
    });
  }

  /** Boot the shipped entry on `port` (a fresh one when omitted). */
  static async boot(
    label: string,
    options: { port?: number; overrides?: Record<string, string> } = {}
  ): Promise<ShutdownChild> {
    if (!existsSync(SHIPPED_ENTRY)) {
      throw new Error(
        `shipped server entry missing: ${SHIPPED_ENTRY}. This gate proves the packaged ` +
          "bytes, so it runs where the build job's tarball is installed (CI: the " +
          'verify-integration-graph lane). Build or install the package first.'
      );
    }
    const dir = mkdtempSync(join(tmpdir(), `squadrules-shutdown-${label}-`));
    const port = options.port ?? (await reservePort());
    const logPath = join(dir, 'server.log');
    // The child owns its log file: a piped stdout nobody drains would block it.
    const logFd = openSync(logPath, 'a');
    let child: ChildProcess;
    try {
      child = spawn(process.execPath, [SHIPPED_ENTRY], {
        cwd: process.cwd(),
        env: childEnv(dir, port, options.overrides ?? {}),
        stdio: ['ignore', logFd, logFd]
      });
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      throw error;
    } finally {
      closeSync(logFd);
    }
    return new ShutdownChild(dir, port, child, logPath);
  }

  /** The child's own stdout/stderr, not a summary. */
  readLog(): string {
    try {
      return readFileSync(this.logPath, 'utf8');
    } catch {
      return '';
    }
  }

  private logTail(): string {
    return this.readLog().split('\n').slice(-60).join('\n');
  }

  /** Wait until the server answers `/health`, so the listener is bound and boot finished. */
  async waitForHealth(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.exitStatus !== null) {
        throw new Error(
          `server exited (code ${this.exitStatus.code}, signal ${this.exitStatus.signal}) ` +
            `before becoming healthy\n${this.logTail()}`
        );
      }
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/health`);
        if (res.status === 200) return;
      } catch {
        // Not listening yet.
      }
      await delay(250);
    }
    throw new Error(`server did not become healthy within ${timeoutMs}ms\n${this.logTail()}`);
  }

  /** Wait for the process to end; a hang fails the test instead of stalling the suite. */
  async waitForExit(timeoutMs: number): Promise<ExitStatus> {
    if (this.exitStatus !== null) return this.exitStatus;
    const timeout = new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`server did not exit within ${timeoutMs}ms\n${this.logTail()}`));
      }, timeoutMs);
      void this.exited.then(() => clearTimeout(timer));
    });
    return Promise.race([this.exited, timeout]);
  }

  signal(sig: NodeJS.Signals): void {
    if (!this.child.kill(sig)) {
      throw new Error(`could not send ${sig}: the server process is already gone`);
    }
  }

  /** Kill a leaked child and delete its temporary dirs. */
  async dispose(): Promise<void> {
    if (this.exitStatus === null) {
      this.child.kill('SIGKILL');
      await Promise.race([this.exited, delay(5_000)]);
    }
    rmSync(this.dir, { recursive: true, force: true });
  }
}

describe('shipped server shutdown (issue #297)', () => {
  it(
    'drains a real-model server on SIGTERM and exits 0 naturally',
    async () => {
      const server = await ShutdownChild.boot('drain');
      try {
        await server.waitForHealth(HEALTH_BUDGET_MS);
        // Boot order proves the model is live *before* this signal: `bootLocalRuntime()`
        // loads it, and the HTTP listener is the last thing the boot starts.
        server.signal('SIGTERM');
        const exit = await server.waitForExit(EXIT_BUDGET_MS);

        // Natural termination: a signal-terminated process reports code null, so `code: 0`
        // with `signal: null` is the drain path, not the OS default action for SIGTERM.
        expect(exit.signal).toBeNull();
        expect(exit.code).toBe(0);

        const log = server.readLog();
        // The real native model was loaded, so the rest of this log is the ADR 0049 case.
        expect(log).toContain(MODEL_LOADED_MARKER);
        // The required marker: the signal handler ran and asked the runtime to drain.
        expect(log).toContain(SHUTDOWN_MARKER);
        // Every owned listener registered before the signal, so the bounded last resort
        // must stay silent. If it fired, an owned handle was left open.
        expect(log).not.toContain(LAST_RESORT_MARKER);
        // And the native teardown never ran against the live InferenceSession.
        expect(log).not.toContain(NATIVE_ABORT_MARKER);
      } finally {
        await server.dispose();
      }
    },
    HEALTH_BUDGET_MS + EXIT_BUDGET_MS
  );

  it(
    'exits 1 on a failed bind without native teardown',
    async () => {
      const blocker = await occupyPort();
      const server = await ShutdownChild.boot('bind-failure', { port: blocker.port });
      try {
        const exit = await server.waitForExit(EXIT_BUDGET_MS);

        // G13 contract: nonzero, reached by a natural exit. A null code with a signal
        // would mean the process aborted or was killed, not that it reported the failure.
        expect(exit.signal).toBeNull();
        expect(exit.code).toBe(1);

        const log = server.readLog();
        // The failure happens after `bootLocalRuntime()`, so the model was already live -
        // this is the exposure, not a hypothetical one.
        expect(log).toContain(MODEL_LOADED_MARKER);
        // Observable behaviour is unchanged: the operator still gets the actionable port
        // message, and it is still a nonzero exit.
        expect(log).toContain(
          `Port ${blocker.port} is already in use. Please choose a different port.`
        );
        // Neither an abandoned handle nor a native teardown: the first would have held the
        // loop to the last resort, the second would have aborted.
        expect(log).not.toContain(LAST_RESORT_MARKER);
        expect(log).not.toContain(NATIVE_ABORT_MARKER);
      } finally {
        await server.dispose();
        await blocker.release();
      }
    },
    // The wait budget must be shorter than the Jest timeout, or a hang is reported as a
    // bare timeout and the child's own log - the only evidence of what it was waiting
    // on - is never printed.
    EXIT_BUDGET_MS + 15_000
  );
});
