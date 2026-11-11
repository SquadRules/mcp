/**
 * Bake A — embedded (LadybugDB).
 *
 * The embedded backend must be **isolated between independent boots** and must survive
 * restart, SIGKILL, and the shutdown contract. Each step records what it proved; steps
 * the harness cannot honestly perform are recorded `not-performed` with manual steps.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  EMBEDDED_READY_MARKER,
  LAST_RESORT_MARKER,
  NATIVE_ABORT_MARKER,
  SIGTERM_MARKER
} from './common.mjs';
import { forkWrite, postJson, readBack, readBackComplete, request, reservePort } from './http.mjs';
import { record } from './ledger.mjs';
import { ServerProcess, serverEnv } from './server-process.mjs';

export async function bakeEmbedded(opts, runDir) {
  const root = join(runDir, 'embedded');
  const aHome = join(root, 'a-home');
  const aGraph = join(root, 'a-graph');
  const bHome = join(root, 'b-home');
  const bGraph = join(root, 'b-graph');
  mkdirSync(root, { recursive: true });

  const a1Port = await reservePort();
  const bPort = await reservePort();
  const logPath = (label) => join(runDir, `${label}.log`);
  const boot = (label, port, home, graph) =>
    new ServerProcess({
      label,
      entry: opts.entry,
      port,
      logPath: logPath(label),
      env: serverEnv({
        SERVER_PORT: String(port),
        SQUADRULES_HOME: home,
        SQUADRULES_GRAPH_BACKEND: 'embedded',
        SQUADRULES_GRAPH_DB_ENABLED: 'true',
        SQUADRULES_GRAPH_DB_PATH: graph
      })
    });

  const markerA = `bake-embedded-a-${Date.now()}`;
  const markerB = `bake-embedded-b-${Date.now()}`;
  let a1;

  // A1/A2/A3 — boot, write, read back.
  try {
    a1 = await boot('embedded-a1', a1Port, aHome, aGraph).start();
    await a1.waitForHealth(opts.timeoutMs);
    const log = a1.readLog();
    const markers = {
      embedded_ready: log.includes(EMBEDDED_READY_MARKER),
      fastembed: log.includes('embedding: fastembed'),
      vector_store: log.includes('vector store: ready')
    };
    if (!markers.embedded_ready || !markers.fastembed) {
      record('A1', 'boot: embedded graph + real embedding model ready', 'fail', {
        reason: 'the boot did not report both `graph db: ready (embedded)` and `embedding: fastembed`; the run proves nothing about the graph',
        markers,
        log_tail: a1.logTail()
      });
      return;
    }
    record('A1', 'boot: embedded graph + real embedding model ready', 'pass', { markers, port: a1Port });

    const write = await forkWrite(a1, `Bake Embedded A ${markerA}`, markerA);
    if (write.status !== 200 || write.adapterUri === '') {
      record('A2', 'write: review-exempt fork train', 'fail', {
        reason: 'the fork train did not return an adapter identity',
        status: write.status,
        body: write.body
      });
      return;
    }
    const before = await readBack(a1, write.adapterUri, markerA);
    if (!readBackComplete(before)) {
      record('A3', 'read back: head + first historical snapshot', 'fail', {
        reason: 'head and historical export did not both serve a consistent digest',
        read_back: before
      });
      return;
    }
    record('A2', 'write: review-exempt fork train', 'pass', {
      adapter_uri: write.adapterUri,
      layer_uuid: write.layerUuid
    });
    record('A3', 'read back: head + first historical snapshot', 'pass', { read_back: before });

    // A4 — graceful restart (E4 shutdown contract + E1 persistence).
    const exited = await a1.stop('SIGTERM');
    const shutdownLog = a1.readLog();
    const shutdown = {
      code: exited.code,
      signal: exited.signal,
      marker: shutdownLog.includes(SIGTERM_MARKER),
      last_resort: shutdownLog.includes(LAST_RESORT_MARKER),
      native_abort: shutdownLog.includes(NATIVE_ABORT_MARKER)
    };
    const shutdownOk =
      shutdown.code === 0 &&
      shutdown.signal === null &&
      shutdown.marker &&
      !shutdown.last_resort &&
      !shutdown.native_abort;
    if (!shutdownOk) {
      record('E4', 'shutdown: SIGTERM drains to a natural exit 0', 'fail', {
        reason: 'the graceful stop did not produce a natural exit 0 with the shutdown marker and without the last-resort or native-abort markers',
        shutdown
      });
    } else {
      record('E4', 'shutdown: SIGTERM drains to a natural exit 0', 'pass', { shutdown });
    }

    let a2 = await boot('embedded-a2', a1Port, aHome, aGraph).start();
    try {
      await a2.waitForHealth(opts.timeoutMs);
      const after = await readBack(a2, write.adapterUri, markerA);
      const persisted =
        after.headStatus === 200 &&
        after.headHasMarker === true &&
        after.headSha256 === before.headSha256 &&
        after.historyStatus === 200 &&
        after.historySha256 === before.historySha256 &&
        Number(after.historyVersions ?? 0) >= Number(before.historyVersions ?? 0);
      record(
        'E1',
        'persistence: same head and snapshot digest after a restart',
        persisted ? 'pass' : 'fail',
        persisted
          ? { before, after }
          : { reason: 'the head or the historical snapshot changed across a restart', before, after }
      );

      // A5/E2 — independent boot must not read the first boot's adapter.
      let b1 = await boot('embedded-b1', bPort, bHome, bGraph).start();
      try {
        await b1.waitForHealth(opts.timeoutMs);
        const crossRead = await postJson(`${b1.baseUrl}/api/export`, {
          uri: write.adapterUri,
          format: 'markdown'
        });
        const isolated = crossRead.status >= 400 && crossRead.status < 500;
        const ownWrite = await forkWrite(b1, `Bake Embedded B ${markerB}`, markerB);
        const ownRead = ownWrite.status === 200 ? await readBack(b1, ownWrite.adapterUri, markerB) : null;
        if (!isolated) {
          record('E2', 'isolation: a second independent boot cannot read the first boot’s adapter', 'fail', {
            reason: `the second boot answered ${crossRead.status} for the first boot's adapter; independent runtimes must not see each other`,
            cross_status: crossRead.status
          });
        } else if (ownWrite.status !== 200 || ownRead === null || ownRead.headStatus !== 200) {
          record('E2', 'isolation: a second independent boot cannot read the first boot’s adapter', 'fail', {
            reason: 'the second boot could not write and read its own adapter, so isolation was not shown against a working runtime',
            own_write_status: ownWrite.status
          });
        } else {
          // Stopping the first boot must leave the second usable.
          const a2Exit = await a2.stop('SIGTERM');
          const bHealth = await request(`${b1.baseUrl}/health`);
          const bStillOwn = await readBack(b1, ownWrite.adapterUri, markerB);
          const survives =
            a2Exit.code === 0 && bHealth.status === 200 && bStillOwn.headStatus === 200 && bStillOwn.headHasMarker;
          record(
            'E2',
            'isolation: a second independent boot cannot read the first boot’s adapter',
            survives ? 'pass' : 'fail',
            survives
              ? { cross_status: crossRead.status, second_boot_head: ownRead.headSha256 }
              : {
                  reason: 'the second boot stopped working after the first was stopped',
                  first_exit: a2Exit,
                  second_health: bHealth.status,
                  second_read: bStillOwn.headStatus
                }
          );
        }
      } finally {
        b1.dispose();
      }
    } finally {
      if (a2.exitResult === undefined) a2.dispose();
    }

    // A6/E3 — unclean stop (SIGKILL) then reboot on the same directories.
    let a3 = await boot('embedded-a3', a1Port, aHome, aGraph).start();
    try {
      await a3.waitForHealth(opts.timeoutMs);
      const beforeKill = await readBack(a3, write.adapterUri, markerA);
      const killed = await a3.stop('SIGKILL', 30_000);
      let a4 = await boot('embedded-a4', a1Port, aHome, aGraph).start();
      try {
        await a4.waitForHealth(opts.timeoutMs);
        const recovered = await readBack(a4, write.adapterUri, markerA);
        const ok =
          killed.signal === 'SIGKILL' &&
          beforeKill.headStatus === 200 &&
          recovered.headStatus === 200 &&
          recovered.headHasMarker === true &&
          recovered.headSha256 === before.headSha256;
        record(
          'E3',
          'recovery: boots after SIGKILL and the adapter is still readable',
          ok ? 'pass' : 'fail',
          ok
            ? { killed, recovered }
            : {
                reason: 'the process did not come back with the pre-kill adapter readable',
                killed,
                before_kill: beforeKill,
                recovered
              }
        );
      } finally {
        a4.dispose();
      }
    } finally {
      if (a3.exitResult === undefined) a3.dispose();
    }

    record('A7', 'failure recovery: a write interrupted mid-flight', 'not-performed', {
      reason: 'interrupting a write at a chosen point needs a hook the shipped server does not expose; scripting it would prove an arbitrary point, not the one that matters',
      manual_steps: [
        'Drive a write by hand against the embedded backend and SIGKILL it while the train request is in flight.',
        'Record exactly which point was interrupted (request stage) in the change record; do not generalise the result.'
      ]
    });
    record('A8', 'durability under power loss', 'not-performed', {
      reason: 'the harness signals processes; it never cuts power, and disk-flush behaviour is the storage layer’s contract',
      manual_steps: ['If power-loss behaviour matters, run the platform’s fault-injection procedure and record it as a separate result.']
    });
    record('A9', 'HA / failover / clustering', 'not-performed', {
      reason: 'the embedded backend is single-owner by construction; no availability claim is made or measured'
    });
  } catch (err) {
    record('A1', 'boot: embedded graph + real embedding model ready', 'fail', {
      reason: err instanceof Error ? err.message : String(err)
    });
  } finally {
    if (a1 !== undefined) a1.dispose();
  }
}
