# TODO — open items at bench time (2026-11-24)

Everything below was still open when the SquadRules 6 workstream was benched. Items are
grouped by their origin issue; the full original text lives in `issues/`.

## From #297 — CI gate for the ADR 0049 shutdown-handler reproducer

ADR 0049 (`docs/adr/0049-drain-handles-on-graceful-shutdown-instead-of-process-exit.md`)
accepted the drain-handles-on-shutdown rule and the mechanism shipped via PR #296, but the
SIGABRT reproducer was measured by gitignored `.local/` probes on the authoring host. No
CI gate asserts:

1. That a graceful shutdown with a loaded `fastembed` model in the process drains its
   listeners and exits with `exitCode = 0` instead of being aborted by ONNX Runtime
   teardown (`SIGABRT` / exit 134).
2. That the drain-aware listener helper closes a listener that finishes booting after the
   signal (the mid-boot registration case corrected under "Evidence" in the ADR).
3. That the `process.exit()` sites listed in the ADR's "Known remaining exposure" section
   stay within the sanctioned CLI-error-path envelope, and that any drift into a
   server/harness boot path fails a test.

Why it matters: without a gate, a future refactor can silently regress graceful shutdown
and resurface as an intermittent `Abort trap: 6` on a user's machine. If the workstream is
revived, port this gate first — the shutdown machinery is the kind of regression that only
shows up in production.

## From #293 — production deployment bake

- **Test production deployment (embedded + shared modes)** — the last unchecked Phase 5
  item. CI's `verify-integration-graph` lane proves dual-mode against an
  `arangodb:3.11` service container, but no real production bake has run. Open questions
  it would answer: ArangoDB pin discipline (must stay ≤ 3.11 — 3.12 switched to BSL 1.1),
  shared-mode failure behaviour under `SQUADRULES_GRAPH_BACKEND_STRICT`, and graph
  reconciliation cost on boot with large adapter stores.

## Open question from issue discussion (unanswered)

- **ArcadeDB** — @lvca asked (2026-11-05, #293 comment) whether ArcadeDB
  (<https://arcadedb.com>) was evaluated. No reply on the issue; the technology
  evaluation (`docs/specs/graph-database-technology-evaluation.md`) and
  `docs/specs/license-compatibility-matrix.md` do not cover it. Relevant only if the
  shared-backend choice is reopened.

## Explicitly not pending (recorded so they are not re-derived)

Phase 5 items marked superseded in #293 need no work: per ADR 0042 the vector store owns
adapter records and SQL owns structured metadata, so "migrate adapter storage to graph DB"
and "migrate metadata to SQL DB" have no remaining migration surface by design.
