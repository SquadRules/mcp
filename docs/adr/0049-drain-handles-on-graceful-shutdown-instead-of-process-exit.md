# ADR 0049: Graceful shutdown drains handles instead of calling process.exit()

## Status

**Accepted** — measured and implemented on branch `sr6-graph-db-touchpoints` on
2026-11-08; landed on `squadrules-6` via [PR #296](https://github.com/SquadRules/mcp/pull/296)
squash-merge commit `40af9c75` on
2026-11-09 with all thirteen required CI gates green. Reconciled by agent on 2026-11-09
under the documentation-authority ADR-status rule. The shutdown-handler **mechanism** is
shipped and CI-covered (any regression in the drain-aware listener helper fails the
`verify-integration-*` lanes that boot the real server); the **recording probes** that
produced the `SIGABRT` evidence still live under `.local/` only, so this ADR's abort
reproducer is not itself a CI gate — see [Known remaining exposure](#known-remaining-exposure)
below and the follow-up issue [SquadRules/mcp#297](https://github.com/SquadRules/mcp/issues/297)
filed alongside this reconciliation. The reopen triggers are
in [Expiry conditions](#expiry-conditions). An independent review on the authoring day
measured one claim in this record wrong; the mid-boot case it found is corrected under
[Evidence](#evidence).

## Context

Once this process has loaded the embedding model, a successful shutdown can no
longer be reported by `process.exit()`. With a live `onnxruntime-node`
`InferenceSession` in the process, `process.exit()` runs the ONNX Runtime
teardown against that session and the native layer aborts:

```text
libc++abi: terminating due to uncaught exception of type std::__1::system_error:
mutex lock failed: Invalid argument
```

That is `SIGABRT`, which the shell reports as `exit 134` (`Abort trap: 6`). It
is not a JavaScript exception: no `catch` sees it, no `try/finally` runs, and
the `Close failure:` line the shutdown path would have logged is never printed.
The process has already done all its work by then, so the abort corrupts
nothing — it only reports failure for a run that succeeded.

This was found the expensive way. A reviewed HTTP scenario executed, asserted
its create/tune/conflict/export/restore steps, printed its completion marker and
wrote `completed.json`; the process then died with exit 134 during teardown. A
supervised lane that asserts `code === 0` therefore could not pass, and the
failure looked like a product defect rather than a teardown one.

The first hypothesis was wrong, and it is recorded here so it is not re-tested:
the reviewed run suspected leaked Ladybug `QueryResult` handles holding native
statements when `Database.close()` ran. That is refuted — 300 deliberately
leaked `QueryResult`s, with the connection and database closed and an explicit
`process.exit()`, still report `0` (probe `p12`). The abort is reproducible with
`onnxruntime-node` alone, with no SquadRules code in the process at all
(probe `p15`).

## Decision

### 1. A process that loaded the embedding model never calls `process.exit()` to report success

It drains its handles and sets `process.exitCode`. `process.exitCode` is not the
fix by itself — it only takes effect if the event loop actually empties — so this
decision is inseparable from decisions 2 and 4.

**Trade-off.** A drain can hang instead of exiting. The alternative is an abort
that is indistinguishable from a crash, so a bounded drain (decision 3) is the
lesser risk. `134` reads as a crash caused by the work; a hang points at a
handle owner.

### 2. Graceful shutdown closes every listener it owns, and releases stdin in stdio mode

`installSignalHandlers()` in `src/index.ts` keeps an `openListeners` registry and
drains it on `SIGTERM`/`SIGINT`, before the process is allowed to exit:

- the HTTP/MCP listener, through the handle `startHttpTransport()` returns
  (`closeAllConnections()`, then `close()`);
- the metrics listener, through the handle `startMetricsServer()` returns;
- in stdio mode, stdin — `pause()` then `destroy()`.

**Registration is part of the decision, not a convenience.** A listener may join
the registry only through `registerListener()`. The signal handler sets a
`shuttingDown` flag on entry — before the best-effort `closeGraphDb()` and before
the drain — and `registerListener()` checks that flag: a listener that finishes
booting after the signal has arrived closes itself at once instead of joining a
registry nobody will read again. `closeQuietly()` wraps each close so one failing
listener cannot skip the remaining ones, and all three registration sites —
metrics listener, HTTP/MCP listener, stdio stdin — go through the helper. Without
it, a signal landing while `bootLocalRuntime()` is still awaited drained an empty
registry and the closer boot registered afterwards was never called; that window
existed, was measured, and is now closed (see [Evidence](#evidence)).

The stdio case is the non-obvious one: in stdio mode no listener is bound, so
before this closer existed `openListeners` was empty and stdin, the only handle
the process owns, was never released. While the MCP host keeps that pipe open,
it holds the event loop, and a process that sets `process.exitCode` and returns
waits forever. Releasing stdin is what lets the loop empty.

**Trade-off.** Shutdown becomes cooperative: it can only succeed if every
handle a process owns is closed. Any handle the process does not own — a native
library's worker thread, a client channel — keeps it alive and must be handled
where it is created. This is cheaper than losing the exit code entirely. A
listener that bypasses `registerListener()` reopens the boot window, so the
helper is the rule a reviewer enforces, not a style preference.

### 3. `process.exit()` survives only as a bounded last resort for a handle we do not own

The shutdown handler keeps one bounded escape hatch:

```text
setTimeout(() => process.exit(0), 1000).unref();
process.exitCode = 0;
```

It is documented at the call site as a last resort that is unreachable on a
process that drains, and that statement needs the precondition this record now
makes explicit: **every listener is registered through `registerListener()`
before the signal arrives.** It exists for a handle we do not own, and it is the
only `process.exit()` left on the successful shutdown path. Removing it is not a
requirement — on every measured draining path, the post-fix mid-boot case
included, it never fired.

**Correction, 2026-11-08.** An earlier revision of this section stated the
claim without that precondition, and the Consequences section in that revision
claimed an unregistered listener would be "hidden as exit 0". An independent
review measured both wrong: unregistered means the last resort fires,
`process.exit(0)` then runs the ONNX Runtime teardown against the live session,
and the process aborts — the OS reports `134`, while the JavaScript `exit`
handler still reports `code=0`, which is where the "exit 0" reading came from.
That reading is retained here because the log line, not the process status, is
what will mislead the next engineer reading a shutdown trace.

**Trade-off.** On the failure it exists for, it still aborts; the status the
shell reports (134) is honest, because that path was not a clean shutdown.
Keeping it means a wedged process cannot hang a supervisor indefinitely.

### 4. No module-scope timer may hold the event loop

Two modules started a module-scope `setInterval` at import time: the metrics
uptime refresh (5 s, `src/services/metrics/system-metrics.ts`) and the MCP
request-timestamp sweep (60 s, `src/http/http-mcp-handler.ts`). Importing both
was enough to keep a process alive; both are now `unref()`ed, so importing them
no longer prevents a natural exit.

**Trade-off.** An unref'd timer stops firing if nothing else holds the loop,
which is exactly the intent in a short-lived process. In a serving process the
listener holds the loop, so the timer keeps firing.

## Consequences

### Positive

- A successful run reports `0`. Supervised lanes, `execFile` wrappers and CI
  steps that assert `code === 0` can distinguish success from teardown failure.
- SIGTERM is a fast, quiet exit: ~185 ms on the serve-shaped probe (HTTP
  listener closed) and ~65 ms on the stdio probe (stdin released), both measured.
- A signal that lands mid-boot no longer aborts: a listener that finishes
  registering after the signal closes itself immediately, and the process still
  reports `0` (measured, see [Evidence](#evidence)).
- The failure mode is documented with its reproduction, so the next engineer
  does not spend a session blaming the graph or vector store.

### Negative

- Shutdown correctness now depends on the completeness of `openListeners`. A new
  listener that never registers a closer — or joins the registry outside
  `registerListener()` — reintroduces the hang, and the last resort does not hide
  it: with the model loaded, the 1 s timer converts it into `134` (measured, see
  [Evidence](#evidence)). The timer is a safety net, not a substitute for the
  registration rule.
- Any process that must exit non-zero and immediately — a fatal startup error, a
  port conflict — cannot use `process.exit()` once embeddings are loaded. Those
  sites are listed under [Known remaining exposure](#known-remaining-exposure).

### Neutral

- Exit code `134` is still the correct reading of an aborting process. This
  record does not make aborts impossible; it removes them from the success path.
- The 1 s grace period is a policy choice, not a measurement. It is short enough
  not to delay a supervisor and well above the ~185 ms drain measured here.

## Known remaining exposure

These `process.exit()` sites are still reachable in a process that has loaded
the embedding model. Three are **judged, not measured**: the shape is read from
source, and none of them was exercised in a process with a live session. The
harness row is the exception — it was measured after the repair described below.

| Site | Why it is reachable | Evidence status |
| --- | --- | --- |
| `src/http/http-server-startup.ts` — `httpServer.on('error')` calls `process.exit(1)` on `EADDRINUSE` and on any other listen error | `runSquadrulesServer()` boots and probes embeddings before it listens (source order), so the exit runs with a live session | Judged, not measured |
| `src/cli/auth-error.ts` — `handleApiError()` calls `process.exit(1)`, the CLI catch-all | Any CLI path that booted the embedding model and then hit an API error exits through it | Judged, not measured |
| Qdrant client channels opened during boot — `openListeners` has no closer for them | With a remote Qdrant URL configured, a client channel is a handle the shutdown path does not close, so the drain can stall and the last resort fires | Judged, not measured |
| `tests/integration/http-reviewed-runtime.ts` — the standalone runner's failure branch sets `process.exitCode = 1` and keeps one 2 s unref'd `process.exit(1)` last resort | The scenario loads fastembed, so a last-resort exit runs with a live session and aborts; the lane fails either way, so no gate depends on which status it reports | Measured — repaired handler: exit `1`, no abort (528 ms; reviewer re-run 761 ms); last resort, reached only when a foreign handle holds the loop: `134` after ~2.7 s; pre-edit control: `134` at once (`.local/failure-path-probe/`) |

The harness row is not product code. It is listed because it changes what a
retained failure artifact looks like: before this correction the branch called
`process.exit(1)` directly and a blocked run aborted instead of exiting `1`.
The reviewed supervisor asserts a zero exit code plus the completion marker, so
both shapes fail the lane and nothing depends on the distinction.

The Qdrant row matters because the measured stdio drain (~65 ms) ran with
`QDRANT_URL` empty. That measurement is not evidence that a configured Qdrant
client drains; it is only evidence that the embedded path does.

Not classified by this record: `src/cli/commands/serve.ts` exits with the
child's code (`process.exit(code ?? 0)`) in the supervising parent. Whether that
parent ever loads the embedding model was not measured, so the site is neither
cleared nor listed as exposure.

## Expiry conditions

This decision holds while all of the following are true, and must be re-evaluated
when any of them changes:

1. The embedding provider is in-process ONNX — `fastembed` on
   `onnxruntime-node` — rather than an out-of-process service. A remote provider
   (TEI, OpenAI) has no in-process native session to tear down, and the abort
   does not apply to it.
2. `onnxruntime-node` still aborts in this pattern on this platform. If upstream
   fixes teardown, `process.exit()` becomes safe again and the drain machinery
   can be simplified back.
3. The host keeps the stdio pipe open for the life of the process, as MCP hosts
   do. A close-on-signal stdin would make the stdio closer unnecessary.

The reopen trigger is a change in any of the three, or an observed abort that
this shutdown path should have prevented.

## Relationship to other ADRs

- **ADR 0021** (embedding provider auto-resolution) — decides which provider
  boots and reports it. This record depends on that provider being in-process
  ONNX; it does not change provider resolution.
- **ADR 0022** (skip application cache for embedded LanceDB) — unaffected: it
  decides caching for the embedded store, not process exit. The two records share
  only a habit of stating which deployment case a decision covers.
- **ADR 0003 / 0013** (store snapshot policy, embedded multi-process safety) —
  unaffected: this record changes process exit, not store contents or locking.

## Evidence

Measured, on this branch, on macOS (`Node.js v26.13.0`), with the model cache
used read-only. The probes are under `.local/`; exit codes below were observed
directly.

Isolating the cause:

| Probe | Shape | Exit |
| --- | --- | --- |
| `p12-ladybug-churn-leak-exit` | 300 leaked Ladybug `QueryResult`s, connection and database closed, `process.exit()` | `0` — Ladybug is not the cause |
| `p11-fastembed-import-exit` | import `fastembed` only, `process.exit()` | `0` — the native module alone is safe |
| `p18-ort-session-only-exit` | `InferenceSession` created, no inference, `process.exit()` | `134`, abort trace |
| `p15-ort-direct-exit` | raw `onnxruntime-node`, one inference, `process.exit()` | `134`, abort trace — no SquadRules code involved |
| `p17-ort-release-exit` | same, plus `InferenceSession.release()` | `134` — `release()` does not prevent it |
| `p16-ort-direct-exitcode` | same as `p15` but `process.exitCode = 0` | `0` |
| `p13-fastembed-exitcode` | fastembed inference, `process.exitCode = 0` | `0` |

The reviewed scenario's own shape: `p20-harness-shape.mjs`, whose success
branch is `.then(() => process.exit(0))`, exits `134`; the same probe with
`process.exitCode = 0` in that branch exits `0`. That is the smallest
reproduction of the reviewed run.

Serve-shaped SIGTERM (`shutdown-probe`), timings from a bounded shell
measurement, `SIGTERM` to exit:

| Handler shape | Exit | SIGTERM → exit |
| --- | --- | --- |
| Pre-fix replica: graph close + 1 s last resort, no listener closers | `134` (`Abort trap: 6`) | 1233 ms |
| Draining: HTTP closer, no last resort | `0` | 185 ms |

Listener completeness (`shutdown-probe-fix`): metrics listener started and left
open while HTTP is closed → `HANG_AT_20s` then `SIGKILL` (`137`); both listeners
closed → `0`; the fixed handler replica → `0`; the same with the real
`startHttpTransport()` handle → `0` on three consecutive runs.

Stdio SIGTERM (`stdio-probe`), with a live stdin pipe held open by the parent
and a real MCP `initialize` answered in `real` mode:

| Mode | Exit | SIGTERM → exit |
| --- | --- | --- |
| `current` — verbatim pre-fix handler, no closer | `134` (`SIGABRT`) | 1148 ms |
| `fixed` — stdin closer added | `0` | 65 ms |
| `control` — last resort removed, nothing else | never drained (`HANG_AT_35s`, then `SIGKILL`, `137`) | — |

`control` is what makes the stdin claim measured rather than inferred: closing
the listeners alone is not enough, stdin itself holds the loop.

Mid-boot registration — a `SIGTERM` that lands before the listener registers,
with a live `InferenceSession` and one listener:

| Handler | Registration | Exit | Last resort |
| --- | --- | --- | --- |
| Pre-fix ordering, hand-written replica | closer pushed after `SIGTERM` | `134` (`SIGABRT`, `mutex lock failed`); the JavaScript `exit` handler printed `code=0` | fired |
| Pre-fix ordering, hand-written replica | closer pushed before `SIGTERM` | `0` | did not fire |
| Shipped code, declarations sliced from `src/index.ts` | closer registered after `SIGTERM` | `0` — closed on arrival, registry stays empty | did not fire |
| Shipped code, declarations sliced from `src/index.ts` | closer registered before `SIGTERM` | `0` | did not fire |
| Shipped code, declarations sliced from `src/index.ts` | ordinary `SIGTERM`, state asserted after the drain | `0`, registry empty, `shuttingDown` true, `exitCode` `0` | did not fire |

The post-fix probe slices `openListeners`, `shuttingDown`, `closeQuietly`,
`registerListener` and `installSignalHandlers` out of `src/index.ts`, transpiles
that exact text and imports it; it refuses to run unless the slice contains
`registerListener` and `shuttingDown = true`, so a stale copy cannot report a
pass. Two collaborators outside the slice are stubbed — `structuredLogger` (log
sink) and `closeGraphDb()` (resolved no-op; no graph booted). The pre-fix abort
was re-run on this host for this correction rather than copied from the review's
summary.

The original probe session reported the same pattern at ~1.16 s, ~160 ms and
~82 ms. Those timing lines were printed to a console and not persisted — the
retained logs hold exit codes and abort traces but not the measurements — so the
figures above are a re-measurement, recorded with the run at
`.local/adr0042-remeasure/console.log`.

Inferred, not measured:

- That importing the metrics and handler modules pinned the loop is measured as
  a pair (`p22`: hang after 8 s); the contribution of each timer individually is
  read from source, not separated by a probe (the per-module probe `p23` failed
  with a harness `TypeError` and was not re-run).
- Every item in [Known remaining exposure](#known-remaining-exposure) except the
  harness row, which was measured separately (`.local/failure-path-probe/`).
- The post-fix mid-boot result holds at handler-ordering level against the real
  declarations, with `structuredLogger` and `closeGraphDb()` stubbed. It was not
  exercised through a full `runSquadrulesServer()` boot, so what it proves is the
  ordering `registerListener()` enforces, not the wired runtime end to end.

## References

- Regression context: `.local/team-review-preparation/SOURCE-RUN-EVIDENCE.md`
  (the reviewed run that printed its completion marker, then aborted).
- Probes: `.local/teardown-probe/`, `.local/shutdown-probe/`,
  `.local/stdio-probe/`, `.local/n5-probe/` (shipped declarations, post-fix),
  `.local/verdict2-probe/` (pre-fix ordering replica) and
  `.local/failure-path-probe/` (harness failure branch: repaired, pre-edit
  control, and last resort).
- Operator-facing summary: `docs/known-issues-and-limitations.md`.
