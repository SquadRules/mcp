/**
 * Bake B — shared backend (ArangoDB 3.10–3.11).
 *
 * Shared proves the OPPOSITE of embedded: two servers must see the same adapter, and a
 * selected shared backend must never populate a local graph directory (that would be the
 * embedded fallback the bake exists to catch). Visibility is recorded as `E2s`, never as
 * the embedded `E2` isolation evidence — neither can be read as the other.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ARANGO_DEGRADED_MARKER,
  ARANGO_READY_MARKER,
  delay,
  sha256
} from './common.mjs';
import { forkWrite, postJson, readBack, readBackComplete, request, reservePort } from './http.mjs';
import { record } from './ledger.mjs';
import { ServerProcess, serverEnv } from './server-process.mjs';

async function arangoVersion(opts) {
  const auth =
    opts.arangoUsername === undefined
      ? {}
      : {
          authorization: `Basic ${Buffer.from(`${opts.arangoUsername}:${opts.arangoPassword ?? ''}`).toString('base64')}`
        };
  const reply = await request(`${opts.arangoUrl.replace(/\/+$/, '')}/_api/version`, { headers: auth });
  const version = typeof reply.body?.['version'] === 'string' ? reply.body['version'] : '';
  return { status: reply.status, version, body: reply.body };
}

export async function bakeArango(opts, runDir) {
  const root = join(runDir, 'arango');
  const home = join(root, 'home');
  const graphPath = join(root, 'graph-must-stay-unused');
  mkdirSync(root, { recursive: true });

  // B1 — version gate. A series outside 3.10–3.11 stops the bake here.
  let version;
  try {
    version = await arangoVersion(opts);
  } catch (err) {
    record('B1', 'version gate: ArangoDB 3.10–3.11', 'blocked', {
      reason: `the shared backend is unreachable at ${opts.arangoUrl} (${err instanceof Error ? err.message : String(err)})`,
      manual_steps: ['Start the production-shaped ArangoDB 3.11 deployment, then rerun with --backend arango.']
    });
    return;
  }
  const parsed = /^(\d+)\.(\d+)/.exec(version.version ?? '');
  const seriesOk =
    parsed !== null && Number(parsed[1]) === 3 && Number(parsed[2]) >= 10 && Number(parsed[2]) <= 11;
  if (!seriesOk) {
    record('B1', 'version gate: ArangoDB 3.10–3.11', 'fail', {
      reason: `the deployment reports "${version.version || 'no version'}"; this repository supports 3.10–3.11 only and a 3.12+ deployment must not be tried anyway`,
      observed: version
    });
    return;
  }
  record('B1', 'version gate: ArangoDB 3.10–3.11', 'pass', { observed: version.version });

  const port = await reservePort();
  const secondPort = await reservePort();
  const marker = `bake-shared-${Date.now()}`;
  const boot = (label, serverPort) =>
    new ServerProcess({
      label,
      entry: opts.entry,
      port: serverPort,
      logPath: join(runDir, `${label}.log`),
      env: serverEnv({
        SERVER_PORT: String(serverPort),
        SQUADRULES_HOME: home,
        SQUADRULES_GRAPH_BACKEND: 'arango',
        SQUADRULES_ARANGO_URL: opts.arangoUrl,
        SQUADRULES_ARANGO_DATABASE: opts.arangoDatabase,
        ...(opts.arangoUsername === undefined ? {} : { SQUADRULES_ARANGO_USERNAME: opts.arangoUsername }),
        ...(opts.arangoPassword === undefined ? {} : { SQUADRULES_ARANGO_PASSWORD: opts.arangoPassword }),
        // Never point a local directory at the shared backend: it must not resolve one,
        // and a file appearing here is the embedded fallback the bake exists to catch.
        SQUADRULES_GRAPH_DB_PATH: graphPath
      })
    });

  let first;
  try {
    first = await boot('arango-b2', port).start();
    await first.waitForHealth(opts.timeoutMs);
    const log = first.readLog();
    const embeddedFiles = existsSync(graphPath) ? readdirSync(graphPath) : [];
    const ready = log.includes(ARANGO_READY_MARKER) && !log.includes(ARANGO_DEGRADED_MARKER);
    if (!ready || embeddedFiles.length > 0) {
      record('B2', 'boot: shared backend ready with no embedded fallback', 'fail', {
        reason: !ready
          ? 'the boot did not report a ready ArangoDB graph'
          : 'a local graph directory was populated while the shared backend was selected, which means the runtime fell back',
        arango_ready: ready,
        embedded_files: embeddedFiles,
        log_tail: first.logTail()
      });
      return;
    }
    record('B2', 'boot: shared backend ready with no embedded fallback', 'pass', {
      arango_marker: log.split('\n').find((line) => line.includes(ARANGO_READY_MARKER)) ?? '',
      embedded_files: embeddedFiles,
      note: 'boot-local-runtime labels a non-null graph `ready (embedded)` even on the shared backend; the arango marker plus the empty local directory are the authority here'
    });

    const write = await forkWrite(first, `Bake Shared ${marker}`, marker);
    const before = write.status === 200 ? await readBack(first, write.adapterUri, marker) : null;
    if (write.status !== 200 || before === null || !readBackComplete(before)) {
      record('B3', 'write and read back over the shared backend', 'fail', {
        reason: 'the fork train or its head/history read-back did not succeed',
        write_status: write.status,
        read_back: before
      });
      return;
    }
    record('B3', 'write and read back over the shared backend', 'pass', { read_back: before });

    // B4/E1 — restart the server only; the database keeps running.
    const exited = await first.stop('SIGTERM');
    let second = await boot('arango-b4', port).start();
    try {
      await second.waitForHealth(opts.timeoutMs);
      const after = await readBack(second, write.adapterUri, marker);
      const persisted =
        exited.code === 0 &&
        after.headStatus === 200 &&
        after.headHasMarker === true &&
        after.headSha256 === before.headSha256 &&
        after.historySha256 === before.historySha256;
      record(
        'B4',
        'persistence: the server restarts and the database still has the adapter',
        persisted ? 'pass' : 'fail',
        persisted
          ? { server_exit: exited, before, after }
          : { reason: 'the head or snapshot changed across a server-only restart', server_exit: exited, before, after }
      );

      // B5/E2s — shared visibility is the OPPOSITE of isolation and is recorded separately.
      let peer = await boot('arango-b5', secondPort).start();
      try {
        await peer.waitForHealth(opts.timeoutMs);
        const crossRead = await postJson(`${peer.baseUrl}/api/export`, {
          uri: write.adapterUri,
          format: 'markdown'
        });
        const shared = crossRead.status === 200 && sha256(String(crossRead.body?.['content'] ?? '')) === before.headSha256;
        record(
          'E2s',
          'shared visibility: a second server sees the same adapter',
          shared ? 'pass' : 'fail',
          shared
            ? {
                cross_status: crossRead.status,
                head_sha256: before.headSha256,
                note: 'this is sharing, not isolation; the repository provides no multi-process write serialisation for the shared backend'
              }
            : {
                reason: 'the second server did not return the same head bytes from the same database',
                cross_status: crossRead.status
              }
        );
      } finally {
        peer.dispose();
      }

      // B6/E3s — stop the database, boot degraded, then restore it.
      if (opts.arangoContainer === undefined) {
        record('E3s', 'backend failure: the server boots degraded, never substituting an embedded file', 'not-performed', {
          reason: 'this step needs the ArangoDB deployment to be stopped; no --arango-container was supplied',
          manual_steps: [
            `Stop the ArangoDB deployment (e.g. docker stop <container>).`,
            `Boot the server with the same environment; expect /health 200 and the log line "${ARANGO_DEGRADED_MARKER}".`,
            `Confirm no file appears under ${graphPath} — an embedded fallback is the defect this bake catches.`,
            'Start ArangoDB again, restart the server, and confirm the historical export still succeeds.'
          ]
        });
      } else {
        const bootAfterStop = async (label, serverPort) => {
          const server = await boot(label, serverPort).start();
          try {
            await server.waitForHealth(opts.timeoutMs);
            const logText = server.readLog();
            const degraded = logText.includes(ARANGO_DEGRADED_MARKER);
            const files = existsSync(graphPath) ? readdirSync(graphPath) : [];
            return { server, degraded, files, logText };
          } catch (err) {
            server.dispose();
            throw err;
          }
        };
        try {
          execFileSync('docker', ['stop', opts.arangoContainer], { stdio: 'pipe' });
          const degradedRun = await bootAfterStop('arango-b6-degraded', secondPort);
          const degradedOk = degradedRun.degraded && degradedRun.files.length === 0;
          degradedRun.server.dispose();
          execFileSync('docker', ['start', opts.arangoContainer], { stdio: 'pipe' });
          await delay(5000);
          const restored = await bootAfterStop('arango-b6-restored', secondPort);
          const restoredRead = await readBack(restored.server, write.adapterUri, marker);
          restored.server.dispose();
          const ok = degradedOk && restoredRead.historyStatus === 200 && restoredRead.historySha256 === before.historySha256;
          record(
            'E3s',
            'backend failure: the server boots degraded, never substituting an embedded file',
            ok ? 'pass' : 'fail',
            ok
              ? { degraded: degradedRun.degraded, embedded_files: degradedRun.files, restored: restoredRead }
              : {
                  reason: 'the degraded boot or the post-restore read-back did not match the contract',
                  degraded: degradedRun.degraded,
                  embedded_files: degradedRun.files,
                  restored: restoredRead
                }
          );
        } catch (err) {
          record('E3s', 'backend failure: the server boots degraded, never substituting an embedded file', 'fail', {
            reason: `driving the container failed: ${err instanceof Error ? err.message : String(err)}`
          });
        }
      }

      record('B7', 'HA / failover / clustering / replication', 'not-performed', {
        reason: 'the bake exercises one ArangoDB deployment and does not test replication, shard placement, leader election, or node loss; no availability claim is made'
      });
      record('B8', 'multi-process concurrent writes', 'not-performed', {
        reason: 'the repository provides no multi-process write serialisation for the shared backend; this is a documented residual, not something the bake can pass'
      });
    } finally {
      second.dispose();
    }
  } catch (err) {
    record('B2', 'boot: shared backend ready with no embedded fallback', 'fail', {
      reason: err instanceof Error ? err.message : String(err)
    });
  } finally {
    if (first !== undefined) first.dispose();
  }
}
