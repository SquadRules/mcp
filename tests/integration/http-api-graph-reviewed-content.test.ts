/*
 * TASK-BOUND PROOF HARNESS — NOT a portable CI lane.
 *
 * Every pin, path and scope here is bound to ONE verified worktree (the absolute WT
 * in http-reviewed-evidence.ts). It cannot be picked up by CI: it needs a granted
 * serial slot, a coordinator-authored bootstrap-delta packet, a COMPLETE on-disk
 * model cache and two runtime-bound judgments. Treat it as retained proof material.
 *
 * Jest supervises ONLY a genuine standalone Node source process (ADR 0004).
 * Production/native/ONNX modules never enter Jest's realm. Required execution
 * allocation: HTTP_REVIEWED_EXECUTION_SLOT=granted plus a separate genuine
 * bootstrap-delta packet/pin. Missing approval FAILS, never skips/passes.
 * The child then, before any production/model import:
 *   - re-derives the fastembed cache layout from the installed SDK text and fails
 *     closed unless the packet's model_cache covers EXACTLY the required files with
 *     recorded sha256 (a merely non-empty cache would let the SDK download at runtime);
 *   - binds the real production listener to 127.0.0.1 and asserts the ACTUAL bound
 *     address from server.address() is loopback (never a wildcard interface).
 * The child emits phase-restore-wait.json for independent coordinator review,
 * keeps its actual OS listener alive <=10 minutes, and restores ONLY after a
 * second runtime-bound packet. Every prior response/state/log remains retained.
 * Direct alternative (same source assertions): node --loader
 * node_modules/ts-node/esm/transpile-only.mjs tests/integration/http-reviewed-runtime.ts
 * with assigned task env and the same separate approvals. Never use stale dist.
 */
import { test } from '@jest/globals';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeOwnedWrite, DELTA, independentPacket, initialEvidence, physical, sha, TASK, verifyTask, WT } from './http-reviewed-evidence.js';

test('ordinary reviewed HTTP create/tune/stale; real exports; independently reviewed restore', async () => {
  verifyTask(); initialEvidence();
  assert.equal(process.env.HTTP_REVIEWED_EXECUTION_SLOT, 'granted', 'BLOCKED: coordinator has not granted runtime/native/model slot');
  const bootstrapFile = process.env.HTTP_REVIEWED_BOOTSTRAP_FILE ?? '';
  const bootstrapPin = process.env.HTTP_REVIEWED_BOOTSTRAP_SHA256 ?? '';
  const authorize = (path: string) => {
    beforeOwnedWrite(path);
    independentPacket(bootstrapFile, bootstrapPin, 'bootstrap-delta', sha(DELTA));
  };
  independentPacket(bootstrapFile, bootstrapPin, 'bootstrap-delta', sha(DELTA));
  const loader = physical(join(WT, 'node_modules/ts-node/esm/transpile-only.mjs'));
  const runner = physical(join(WT, 'tests/integration/http-reviewed-runtime.ts'));
  const prefix = join(WT, '.local/http-reviewed-supervisor-');
  authorize(prefix);
  const dir = mkdtempSync(prefix);
  const paths: Record<string, string> = {};
  for (const name of ['home', 'tmp', 'cache', 'config', 'data', 'squadrules']) {
    paths[name] = join(dir, name);
    authorize(paths[name]!); mkdirSync(paths[name]!);
  }
  // Whitelist BEFORE ts-node loads: coverage, credentials, endpoints and user
  // startup hooks cannot leak into the child or redirect pre-import cache writes.
  const env: NodeJS.ProcessEnv = {
    ...TASK, PATH: process.env.PATH ?? '',
    HTTP_REVIEWED_EXECUTION_SLOT: 'granted',
    HTTP_REVIEWED_BOOTSTRAP_FILE: bootstrapFile, HTTP_REVIEWED_BOOTSTRAP_SHA256: bootstrapPin,
    HOME: paths.home, USERPROFILE: paths.home,
    TMPDIR: paths.tmp, TMP: paths.tmp, TEMP: paths.tmp,
    XDG_CACHE_HOME: paths.cache, XDG_CONFIG_HOME: paths.config, XDG_DATA_HOME: paths.data,
    APPDATA: paths.config, LOCALAPPDATA: paths.cache, HF_HOME: paths.cache,
    HF_HUB_CACHE: paths.cache, TRANSFORMERS_CACHE: paths.cache, TORCH_HOME: paths.cache,
    SQUADRULES_HOME: paths.squadrules, TS_NODE_PROJECT: join(WT, 'tsconfig.json'),
    TS_NODE_TRANSPILE_ONLY: 'true', TS_NODE_EMIT: 'false',
    TS_NODE_COMPILER_OPTIONS: JSON.stringify({ incremental: false })
  };
  const stdoutLog = join(dir, 'stdout.log'), stderrLog = join(dir, 'stderr.log');
  const args = ['--loader', loader, runner];
  let out: number | undefined, err: number | undefined;
  let code: number | null = null, signal: NodeJS.Signals | null = null;
  let timedOut = false, interrupted: NodeJS.Signals | null = null;
  try {
    authorize(stdoutLog); out = openSync(stdoutLog, 'wx');
    authorize(stderrLog); err = openSync(stderrLog, 'wx');
    authorize(join(dir, 'child-process'));
    console.log(JSON.stringify({ command: [process.execPath, ...args], stdoutLog, stderrLog }));
    // No globalSetup/resetModules/fixture priming. The child sanitizes env BEFORE
    // production imports and supplies all database/cache/temp dirs explicitly.
    const child = spawn(process.execPath, args, { cwd: WT, env, stdio: ['ignore', out, err] });
    await new Promise<void>((resolve, reject) => {
      let force: ReturnType<typeof setTimeout> | undefined;
      let spawnError: Error | undefined;
      const stop = () => {
        if (child.exitCode !== null || child.signalCode !== null || force) return;
        child.kill('SIGTERM');
        force = setTimeout(() => child.kill('SIGKILL'), 10_000);
      };
      const onInterrupt = (s: NodeJS.Signals) => { interrupted = s; stop(); };
      const onInt = () => onInterrupt('SIGINT'), onTerm = () => onInterrupt('SIGTERM');
      process.once('SIGINT', onInt); process.once('SIGTERM', onTerm);
      const timer = setTimeout(() => { timedOut = true; stop(); }, 1_200_000);
      child.once('error', error => { spawnError = error; });
      child.once('close', (c, s) => {
        code = c; signal = s;
        clearTimeout(timer); if (force) clearTimeout(force);
        process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm);
        if (spawnError) reject(spawnError); else resolve();
      });
    });
  } finally {
    // Even a failed second open/preflight closes the first fd; no evidence is deleted.
    try { if (out !== undefined) closeSync(out); }
    finally {
      try { if (err !== undefined) closeSync(err); }
      finally {
        if (out !== undefined) console.log(readFileSync(stdoutLog, 'utf8'));
        if (err !== undefined) console.error(readFileSync(stderrLog, 'utf8'));
      }
    }
  }
  assert.equal(timedOut, false, 'standalone runner exceeded supervised deadline');
  assert.equal(interrupted, null, `supervisor interrupted (${interrupted})`);
  assert.equal(signal, null, `standalone runner interrupted (${signal})`);
  assert.equal(code, 0, 'standalone runner failed/blocked; inspect complete retained stdout/stderr');
  assert(readFileSync(stdoutLog, 'utf8').includes('HTTP_REVIEWED_SOURCE_SCENARIO_COMPLETE'));
}, 1_230_000);
