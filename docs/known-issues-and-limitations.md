# Known issues and limitations

Expected behaviour that looks like a defect. Each entry records what you see,
why it happens, and what would actually change it, so the same finding is not
re-diagnosed on every install.

## `npm install` warns that `@anush008/tokenizers` is deprecated

**What you see.** An install in this repository — `npm ci` locally, the
devcontainer's `postCreateCommand`, CI — prints this as its first line, before
any other output:

```text
npm warn deprecated @anush008/tokenizers@0.6.0: This package has been archived. Please use the official and updated "huggingface/tokenizers" package.
```

**Why it happens.** The package is not one of our dependencies. It is transitive:
`fastembed@3.0.0` declares `@anush008/tokenizers: ^0.0.0`, which resolves to
exactly `0.0.0`, a release with no `linux-arm64` binaries. Our root `overrides`
entry pins that transitive to a version that does carry them — see
[ADR 0030](adr/0030-tokenizers-arm64-native-binding-override.md) for that
decision and the platform matrix behind it. The publisher archived the package,
so the deprecation notice is attached to every published version (`0.0.0`,
`0.2.0`, `0.5.0`, `0.6.0`); there is no non-deprecated release to move to.

**Why changing our version does not fix it.** An `overrides` value is read only
from the root package being installed. Bumping, widening, or removing this entry
cannot change what `npm install @squadrules/mcp` resolves for anyone else: a
consumer's install follows `fastembed`'s own `^0.0.0` range, reports the notice
for `0.0.0`, and lacks the arm64 binding unless the consumer pins its own
override.

**What would actually change it.** Either:

- `fastembed` moves to an official binding — the only change upstream can make
  that clears the notice; or
- this repository stops depending on `fastembed` and owns the local embedding
  path on official components. Evaluated 2026-10-26: `tokenizers@0.23.2`
  exposes the members `fastembed` calls here — `Tokenizer.fromFile`,
  `setTruncation`, `setPadding`, `addSpecialTokens`, `addAddedTokens`,
  `AddedToken`, `encode`, and the `getIds`/`getAttentionMask`/`getTypeIds`
  accessors — so it could stand in for the archived binding behind our own
  provider. A root override to it only helps this repository, though, and
  unpacks 66 MB of all-platform binaries into `node_modules`.
  `@huggingface/tokenizers@0.2.0`, the package the notice points at, is pure JS
  (≈361 kB unpacked over 80 files) and its API differs from `fastembed`'s call
  shape, so it is not a drop-in either.

Raising `fastembed`'s own floor is not on that list. Every published version
carries the notice, so a higher floor only resolves to a different deprecated
release; it would make our override redundant, and nothing more. The version and
size figures above are registry facts as of 2026-10-26 — re-measure them before
acting on them.

**Status.** Expected, not a regression. Do not re-report it without one of the
two triggers above. Background: issues
[#77](https://github.com/SquadRules/mcp/issues/77) and
[#173](https://github.com/SquadRules/mcp/issues/173), both closed.

## A successful run exits `134` after the embedding model loads

**What you see.** A run does its work, prints its final success marker, and then
dies with:

```text
libc++abi: terminating due to uncaught exception of type std::__1::system_error:
mutex lock failed: Invalid argument
```

The shell reports `exit 134` (`Abort trap: 6`), and nothing was actually lost —
no write is missing and no state is corrupt. A supervisor or CI step that
asserts a zero exit code still fails the run.

**Why it happens.** `process.exit()` tears down ONNX Runtime while an
`onnxruntime-node` `InferenceSession` is live, and the native teardown aborts.
It is not a JavaScript exception, so no handler runs and the error carries no
stack. It is not the graph database: 300 leaked Ladybug handles on their own
report exit `0`.

**What already mitigates it.** Shutdown closes the listeners the process owns,
releases stdin in stdio mode, and sets `process.exitCode` rather than forcing an
exit. The remaining `process.exit()` on that path is a bounded last resort: it
stays silent once every listener has registered its closer before the signal —
including one that finishes booting after it — and it produces `134` again if one
never registers. The decision, the measurements and the trade-offs are in
[ADR 0049](adr/0049-drain-handles-on-graceful-shutdown-instead-of-process-exit.md).

**Paths still exposed.** The CLI catch-all in `src/cli/auth-error.ts` and Qdrant
client channels that shutdown does not close. Both are judged reachable, not
measured; ADR 0049 records them, plus the retained proof harness's last resort, as
known exposure.

The HTTP startup port conflict is no longer one of them. `src/http/http-server-startup.ts`
used to call `process.exit(1)` straight from the listener's `error` event, which by then
already ran after the embedding model was loaded. It now closes the failed listener,
keeps the same operator-facing message, and reports the fatal error to its owner through
`onFatalError`; the server wires that to the same drain a signal takes — close what the
process owns, set `process.exitCode = 1`, exit naturally. Sanctioned CLI exits are
unchanged and deliberately separate: a rejected flag, or `serve`'s supervising parent
reporting its child's code, runs in a process that never loaded the native model, so an
immediate exit there carries no abort risk. `tests/integration/server-shutdown.test.ts`
is the gate — it occupies the port, boots the shipped `dist/bootstrap.js` with the real
fastembed model, and asserts exit `1`, the port message, and no native abort.

The proof harness (`tests/integration/http-reviewed-runtime.ts`) is not product
code, but it had this defect in its failure branch too: a blocked run called
`process.exit(1)` with the model loaded and aborted instead of exiting `1`. It
now sets `process.exitCode = 1` and keeps only a bounded 2 s last resort for a
handle it does not own — measured as exit `1` with no abort, and `134` after
~2.7 s only when a foreign handle keeps the loop alive. The supervising lane
fails either way, so no gate depends on which status it reports.

**Status.** Expected while the embedding provider is in-process ONNX. Do not
re-diagnose it as a store or graph defect; re-evaluate only when ADR 0049's
expiry conditions change.

## Concurrent adapter writes are serialized in one process, not across a cluster

**What you see.** Nothing, until two processes write the same adapter at the same
time on a shared backend: one of them fails with `VERSION_CONFLICT` instead of
their histories silently forking.

**Why it is not a lock.** An adapter write is read → validate → persist → append
history, and the guard is an **expected head** the writer observed before the
write. `withAdapterWriteLock`
(`src/services/graph-db/adapter-write-lock.ts`) makes that region indivisible
between callers **in one process** only. The embedded graph needs nothing more: it
allows exactly one writable owner per database file, so concurrent writers there
are concurrent callers in that process. A shared Arango deployment can have
several processes appending for the same adapter; for those, the durable
monotonic guard threaded into `appendVersion` as `expectedParentVersion` turns a
race into an explicit conflict — a different mechanism with a different failure
mode, not a distributed lock.

**Status.** By design, and documented rather than hidden. A cluster-wide
serialization requirement means a server-side lock or a broker, which would be
its own decision; re-evaluate only if a deployment needs two processes writing
one adapter without handling `VERSION_CONFLICT`.
