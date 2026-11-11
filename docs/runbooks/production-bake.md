# Production bake: embedded and shared graph backends

**Status: procedure delivered, bake not executed.** This branch ships the repeatable
procedure and its harness; it does not ship a recorded bake. Executing it needs the
target infrastructure — a production-shaped host and, for the shared backend, a real
ArangoDB 3.11 deployment. **The executed, recorded bake remains an operational
follow-up** owned by whoever operates the deployment; the evidence record below is
what closes it out.

## What this bake decides — and what it does not

It decides, on the shipped package, for each graph backend:

- **E1 — persistence across restart:** an adapter written before a restart is still
  readable after it, and its graph-backed history survives with its snapshot digest.
- **E2 — runtime isolation between independent boots (embedded):** a second boot with
  its own directories cannot read the first boot's adapter, and stopping the first
  leaves the second usable.
- **E2s — shared visibility (shared):** two server processes against one ArangoDB
  database see the same adapter. This is *sharing*, the opposite of E2, and is recorded
  separately so the two are never confused.
- **E3 — failure recovery:** after an unclean stop (`SIGKILL`) the process boots again
  on the same directories and the adapter is still readable; after the shared backend
  disappears the server boots degraded instead of substituting an embedded file.

It does **not** decide:

- **CI parity is not production validation.** A green integration lane runs the same
  code against a disposable container on a shared runner with synthetic data. It says
  nothing about your disk, image, network policy, data volume, upgrade path, or
  operators. A passing CI lane is a precondition for a bake, never a substitute for one.
- **No HA, failover, or clustering claim.** The embedded backend is single-owner by
  construction (`src/config/graph-backend.ts`). The shared bake exercises **one**
  ArangoDB deployment and does not test replication, shard placement, leader election,
  or node loss. Nothing here establishes an availability target, and none may be quoted
  as one.
- No durability-under-power-loss claim: the harness stops processes, it never cuts
  power. Disk-flush behaviour is the storage layer's contract, not something this bake
  measures.

## Environment and versions

Record every row; the harness captures the ones it can read and marks the rest as
operator-supplied.

| Component | Required | Notes |
|---|---|---|
| Node.js | 24 or newer | `package.json` `engines` |
| Package under test | the tarball built by `npm run build:tgz` | install it into a scratch prefix: the bake proves shipped bytes, not your working tree |
| Embedded graph | LadybugDB (bundled) | default backend; `SQUADRULES_GRAPH_BACKEND=embedded` |
| Shared graph | **ArangoDB 3.11** | 3.10 is also accepted; 3.12+ is rejected at boot so a silent capability mismatch cannot happen |
| Record store | embedded LanceDB, or your Qdrant | the bake is about the graph, but the store must be the production one |
| Embeddings | fastembed (ONNX) by default, or the configured provider | warm `FASTEMBED_CACHE_DIR`/`XDG_CACHE_HOME` or the first boot downloads weights |
| Host | production-shaped OS, CPU and disk | the whole point of a bake is your environment, not a runner |

Prepare the shipped package once and keep one shell for the run:

```bash
export BAKE_DIR="$PWD/.local/bake/$(date -u +%Y%m%dT%H%M%SZ)"
export BAKE_PREFIX="$PWD/.local/bake/prefix"
mkdir -p "$BAKE_DIR"
npm run build:tgz
npm install --prefix "$BAKE_PREFIX" "$PWD"/artifacts/squadrules-mcp-*.tgz
node -p "require('$BAKE_PREFIX/node_modules/@squadrules/mcp/package.json').version"
```

The installed entry is `"$BAKE_PREFIX"/node_modules/@squadrules/mcp/dist/bootstrap.js`
— the same file Docker and `squadrules serve` run.

## Bake A — embedded (LadybugDB)

Own every directory per boot. Two boots sharing a directory are not independent boots
and invalidate E2.

```bash
export A_HOME="$BAKE_DIR/embedded-a"
export A_GRAPH="$BAKE_DIR/embedded-a-graph"
export A_PORT=3401
TRANSPORT_TYPE=http SERVER_PORT=$A_PORT AUTH_ENABLED=false QDRANT_URL='' \
  EMBEDDING_PROVIDER=fastembed \
  SQUADRULES_HOME="$A_HOME" \
  SQUADRULES_GRAPH_DB_ENABLED=true \
  SQUADRULES_GRAPH_DB_PATH="$A_GRAPH" \
  LOG_LEVEL=debug \
  node "$BAKE_PREFIX/node_modules/@squadrules/mcp/dist/bootstrap.js" \
  > "$BAKE_DIR/embedded-a.log" 2>&1 &
export A_PID=$!
```

1. **A1 — health.** Poll `http://127.0.0.1:$A_PORT/health` until 200. Capture
   `embedding: fastembed` and `graph db: ready (embedded)` from the log: without both,
   the run proves nothing about the graph and must be restarted, not annotated.
2. **A2 — write.** Create one adapter with a review-exempt *fork* train (the bundled
   `critic-loop` adapter is system-seeded into the app space, so the write needs no
   fabricated critic verdict — `executeTrain` exempts exactly two real contracts from
   `review_evidence`, artifact trains and fork trains).

   Write the document first, then assemble the request from it: the markdown is the part
   you change, and keeping it out of the JSON string avoids hand-escaping newlines.

   ````bash
   cat > "$BAKE_DIR/adapter.md" <<'MD'
   ---
   version: 1.0.0
   ---

   # Bake Adapter

   ## Activation Patterns

   - Bake Adapter

   ## Bake Step

   bake-step-body

   ```json
   {"contract":{"type":"shell","shell":{"cmd":"echo bake-step-body","interpreter":"bash"}}}
   ```

   ## Reward Signal

   Done.
   MD

   node -e '
   const { readFileSync, writeFileSync } = require("node:fs");
   writeFileSync(process.argv[1], JSON.stringify({
   content: readFileSync(process.argv[2], "utf8"),
   source_adapter_uri: "squadrules://adapter/critic-loop",
   llm_model_id: "production-bake",
   force_update: true
   }));
   ' "$BAKE_DIR/fork-train.json" "$BAKE_DIR/adapter.md"

   curl -sS -X POST "http://127.0.0.1:$A_PORT/api/train" \
     -H 'content-type: application/json' \
     --data-binary @"$BAKE_DIR/fork-train.json"
   ````

   Capture the returned `adapter_uri` and `layer_uuid`.
3. **A3 — read back before the restart.** `POST /api/export` for the adapter (head) and
   for `version: "1"` (the first graph-backed snapshot). Capture `content`,
   `snapshot_sha256`, `history_version`, `history_versions`.
4. **A4 — graceful restart (E4 + E1).** `kill -TERM $A_PID`; record the exit status and
   the log. A pass needs **exit 0**, `Received SIGTERM, shutting down`, no
   `shutdown: last-resort exit`, and no `mutex lock failed`. Then boot again on the same
   `SQUADRULES_HOME`/`SQUADRULES_GRAPH_DB_PATH` and repeat A3. The head must match and
   the historical export must still return the same `snapshot_sha256`.
5. **A5 — independent boot (E2).** With boot A still up, boot B on a *different* port
   with `SQUADRULES_HOME`/`SQUADRULES_GRAPH_DB_PATH` under fresh directories. Export
   boot A's adapter from boot B: it must fail as not-found (4xx), never return A's
   bytes. Stop A, then confirm B still answers `/health` and still exports its own
   writes. Record both observations.
6. **A6 — unclean stop (E3).** After a completed write, `kill -KILL` the process,
   restart on the same directories, and repeat the head + historical export. A pass
   needs a boot plus readable state; a lost write is a fail.

A kill *during* an in-flight write is deliberately not scripted: interrupting a write
at a chosen point needs a hook the shipped server does not expose, so the harness
records that step as `not-performed` with this reason instead of pretending it ran.
Drive it by hand only if you can state exactly which point you interrupted.

## Bake B — shared (ArangoDB 3.11)

Point the server at one real deployment; it must not resolve a local directory.

```bash
export SQUADRULES_GRAPH_BACKEND=arango
export SQUADRULES_ARANGO_URL=http://127.0.0.1:8529
export SQUADRULES_ARANGO_DATABASE=squadrules_bake
export SQUADRULES_ARANGO_USERNAME=...      # omit when the deployment allows no auth
export SQUADRULES_ARANGO_PASSWORD=...
export B_PORT=3402
```

1. **B1 — version gate.** `GET $SQUADRULES_ARANGO_URL/_api/version` and record it. A
   series outside 3.10–3.11 stops the bake here; do not "try it anyway".
2. **B2 — boot and record the topology.** Boot the server as in Bake A (same env plus
   the block above), poll `/health`, and capture the backend-specific line
   `graph db: arango <version> ready (transactions …)` together with the absence of any
   embedded graph file under the configured `SQUADRULES_GRAPH_DB_PATH`/home. A local file
   appearing means the runtime fell back, which is the defect this bake exists to catch.

   Read the markers precisely: `bootLocalRuntime()` also logs
   `graph db: ready (embedded)` whenever *any* graph opened, and that parenthetical is a
   label, not the selected backend. On the shared backend the `arango` line is the
   authority; the empty local directory is the proof that no fallback happened. A boot log
   that shows only the generic line, or shows
   `graph db: arango unavailable … no embedded fallback is used`, is a `fail`, not a pass
   with a note.
3. **B3 — write and read back.** Same fork train and exports as A2/A3.
4. **B4 — server restart (E1).** Restart the *server* only; the database keeps running.
   Head and historical export must match. Record that persistence came from the
   database, not from process memory.
5. **B5 — shared visibility (E2s).** Boot a second server process on another port
   against the same database and export the adapter: it must return 200 with the same
   head. Record this as shared visibility, and record the documented residual in the
   same entry: the repository provides no multi-process write serialization for the
   shared backend.
6. **B6 — backend failure (E3s).** Stop ArangoDB, then boot the server. It must boot
   degraded — no graph, loudly — keep serving record reads, and never substitute an
   embedded graph file. Start ArangoDB again, restart the server, and confirm the
   historical export succeeds again. This step needs you to stop the database, so the
   harness records the *preconditions* and marks the step `not-performed` unless you
   supply `--arango-container <name>` (it then drives `docker stop`/`docker start`).

## Evidence: what to capture and where it is recorded

| Id | Evidence | Where it comes from | Pass condition |
|---|---|---|---|
| E1 | persistence across restart | head + historical export after restart | same head, same `snapshot_sha256`, `history_versions` not reset |
| E2 | embedded isolation | export from the second independent boot | 4xx not-found; second boot healthy after the first stops |
| E2s | shared visibility | export from a second server on the same database | 200, same bytes — shared, explicitly not isolated |
| E3 | unclean-stop recovery | `SIGKILL`, restart, export | boots, adapter readable |
| E3s | backend failure degradation | ArangoDB stopped, server booted | boots, no embedded fallback, record reads work |
| E4 | shutdown contract | `SIGTERM` exit status + log | exit 0, shutdown marker, no last resort, no `mutex lock failed` |
| E5 | environment | harness capture + operator rows | Node, package, backend, Arango series, provider, host, storage class |

**Where the evidence is recorded**

- **Machine-readable:** `.local/bake/<run-id>/evidence.json`, written by
  `scripts/deploy-production-bake.mjs`, with the server log kept beside it. `.local/` is
  git-ignored, so the file stays on the bake host; attach it to the change or incident
  record that closes the bake.
- **Per-run narrative:** the deployment's own change/incident record, naming the run id,
  the backend(s) covered, and any `not-performed`/`blocked` step with its reason.
- Do **not** paste runtime evidence into `docs/`: `docs/` holds only non-code-derivable
  prose (see `.qoder/rules/documentation-authority.md`). Link the run id instead.
- Keep the run id in the durable record even after the artifacts are pruned; the record
  is what survives the host.

## Running the harness

```bash
node scripts/deploy-production-bake.mjs --help
node scripts/deploy-production-bake.mjs --backend embedded
node scripts/deploy-production-bake.mjs --backend arango \
  --arango-url http://127.0.0.1:8529 --arango-database squadrules_bake
```

The harness performs what a local run can do: environment capture, boot and health,
a review-exempt fork-train write, head and historical read-back, graceful-restart
persistence, embedded isolation, unclean-stop recovery, and shared visibility. Where a
step needs you to stop infrastructure it records `not-performed` with the exact manual
steps rather than claiming a result. Every step in `evidence.json` carries one status:
`pass`, `fail`, `not-performed` (with a reason), or `blocked` (with a reason and the
missing prerequisite). Only an all-`pass` run exits 0.

## Abort criteria

Stop the bake and record a `fail` — do not annotate around it — when any of these is
observed:

- a boot without `graph db: ready` on a backend you asked for;
- an embedded graph file appearing on the shared backend;
- a head or historical export that differs after restart;
- an independent boot that can read the other boot's adapter;
- a `SIGTERM` that does not exit 0, prints the last-resort marker, or reports
  `mutex lock failed`;
- an adapter that disappears after `SIGKILL`;
- an ArangoDB series outside 3.10–3.11.

## Cadence

Re-run before a major version upgrade, after any change to graph writes or storage, and
whenever the deployment's storage class or graph backend changes. A bake that was never
executed is an open follow-up, not a passed gate.
