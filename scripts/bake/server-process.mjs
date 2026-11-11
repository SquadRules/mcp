/**
 * The child server process the bake boots, stops, and reads logs from.
 *
 * `stop()` sends a signal and waits for a natural exit; `SIGKILL` is only used when the
 * process genuinely hangs, so a graceful-stop claim is never satisfied by force. `dispose()`
 * is the belt-and-braces cleanup for a failed step, and closing the log fd twice is safe.
 */
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { REPO_ROOT, HEALTH_TIMEOUT_MS, STOP_TIMEOUT_MS, delay } from './common.mjs';
import { request } from './http.mjs';

export class ServerProcess {
  constructor({ label, entry, port, env, logPath }) {
    this.label = label;
    this.entry = entry;
    this.port = port;
    this.env = env;
    this.logPath = logPath;
    this.child = undefined;
    this.logFd = undefined;
    this.exitResult = undefined;
    this.exitPromise = undefined;
  }

  get baseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }

  async start() {
    mkdirSync(dirname(this.logPath), { recursive: true });
    this.logFd = openSync(this.logPath, 'w');
    this.child = spawn(process.execPath, [this.entry], {
      cwd: REPO_ROOT,
      env: this.env,
      stdio: ['ignore', this.logFd, this.logFd]
    });
    // Captured eagerly: a boot can fail before anyone awaits the first health poll, and a
    // late `exit` listener would then miss the event and report a hang instead of a code.
    this.exitPromise = new Promise((done) => {
      this.child.on('exit', (code, signal) => {
        this.exitResult = { code, signal };
        done(this.exitResult);
      });
    });
    return this;
  }

  readLog() {
    try {
      return readFileSync(this.logPath, 'utf8');
    } catch {
      return '';
    }
  }

  logTail(lines = 40) {
    return this.readLog()
      .split('\n')
      .filter((line) => line.trim() !== '')
      .slice(-lines)
      .join('\n');
  }

  async waitForHealth(timeoutMs = HEALTH_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    let lastStatus = 0;
    while (Date.now() < deadline) {
      if (this.exitResult) {
        throw new Error(
          `${this.label} exited (code ${this.exitResult.code}, signal ${this.exitResult.signal}) before /health; log:\n${this.logTail()}`
        );
      }
      try {
        const reply = await request(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(5000) });
        lastStatus = reply.status;
        if (reply.status === 200) return reply;
      } catch {
        // Not listening yet.
      }
      await delay(1000);
    }
    throw new Error(`${this.label} /health did not return 200 in ${timeoutMs}ms (last ${lastStatus}); log:\n${this.logTail()}`);
  }

  /** Send `signal` and wait for the process to end on its own (no forced kill unless it hangs). */
  async stop(signal = 'SIGTERM', timeoutMs = STOP_TIMEOUT_MS) {
    if (this.exitResult) return this.exitResult;
    this.child.kill(signal);
    const raced = await Promise.race([this.exitPromise, delay(timeoutMs).then(() => 'timeout')]);
    if (raced === 'timeout') {
      this.child.kill('SIGKILL');
      return this.exitPromise;
    }
    return raced;
  }

  dispose() {
    if (this.exitResult === undefined && this.child !== undefined) this.child.kill('SIGKILL');
    if (this.logFd !== undefined) {
      try {
        closeSync(this.logFd);
      } catch {
        // Already closed.
      }
      this.logFd = undefined;
    }
  }
}

/** Environment every bake boot shares; `base` is the per-step difference. */
export function serverEnv(base) {
  return {
    ...process.env,
    TRANSPORT_TYPE: 'http',
    AUTH_ENABLED: 'false',
    // Empty QDRANT_URL selects the embedded record store; the bake is about the graph and
    // the store must be whatever the deployment uses, not the CI default.
    QDRANT_URL: '',
    EMBEDDING_PROVIDER: 'fastembed',
    SQUADRULES_NO_BROWSER: '1',
    // debug: the graph and embedding markers this harness asserts are debug-level lines.
    LOG_LEVEL: 'debug',
    ...base
  };
}
