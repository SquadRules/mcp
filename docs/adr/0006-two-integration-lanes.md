# 0006 — Two integration lanes: cluster and single, both full-suite, both gated

Status: **Proposed** — recorded in [#26](https://github.com/SquadRules/mcp/pull/26), closed
unmerged. `main` still runs the four-lane topology described in Context; the two-lane
Decision below was implemented on the #26 branch only and is preserved here as recorded
intent, not as current CI behaviour.
Date: 2026-10-06

## Context

`.github/workflows/integration.yml` had grown to four test lanes: `verify-integration-primary`
(infra + AUTH), `verify-integration-simple-smoke`, `verify-integration-stdio-smoke` and
`verify-integration-embedded-simple`. Three of them ran hand-picked file lists, one
(`verify-integration-embedded-simple`) ran with `continue-on-error` and was left out of the
merge gate, and `verify-integration-stdio-smoke` still needed the OpenAI secret. Nobody
could say which substrate was proven where, and the aggregate merge context ("Integration
workflow passed") hid it, because branch protection checks the summary context, not lane
names.

## Decision

Exactly two lanes, both running the full `tests/integration/` suite, both gating:

| Lane | Name | Substrate | Transport / auth | Timeout |
| --- | --- | --- | --- | --- |
| `verify-integration-cluster` | Integration tests (cluster mode, AUTH on, Node 24) | Qdrant + Valkey + Postgres + Keycloak in Docker | HTTP, `AUTH_ENABLED=true` | 30 min |
| `verify-integration-single` | Integration tests (single mode, AUTH off, Node 24) | embedded LanceDB, no Docker, no services | stdio only, `AUTH_ENABLED=false` | 30 min |

- The cluster lane is today's `verify-integration-primary` renamed; its steps are
  unchanged, including the restore-only Qdrant snapshot cache parked by
  [#22](https://github.com/SquadRules/mcp/issues/22). It also runs `npm run dev:test --
  tests/unit` first, because some unit tests need the deployed services.
- The single lane replaces the three deleted lanes. One job, one pass: `npm run dev_stdio:test`
  (stdio transport, full suite). `QDRANT_URL` is blanked in `.env` and `.env.dev_stdio`, so the
  Jest worker and every stdio child the tests spawn all resolve the embedded backend. Since v5.1.0
  the harness enforces the same posture itself — `applyLocalStdioEnv()` blanks it for spawned
  children, and `src/config/runtime-mode.ts` refuses to boot a stdio process that contradicts
  local simple mode — so the lane-level blanking is what makes the *HTTP* pass in the cluster lane
  use Qdrant, not a defence against a stray child.
- One store directory per single-mode job: `TEST_XDG_CONFIG_HOME` (see
  `scripts/deploy-run-env.sh`) on the test steps points at `$HOME/.config`. `tests/utils/mcp-client-utils.ts`
  resets its shared stdio child between connection lifecycles, so every lifecycle spawns a server that
  opens the store; separate throwaway dirs would give each child an empty store and a fresh boot
  injection.
- Both lanes blank `OPENAI_API_KEY` and pin `EMBEDDING_PROVIDER=fastembed`
  ([0004](0004-fastembed-default-for-testing.md)).
- `integration-pass.needs` is `[build, verify-integration-cluster, verify-integration-single]`
  and no lane sets `continue-on-error`. Its `name:` is unchanged, because that context —
  not the job ids — is what branch protection requires.

## Consequences

- **The rule that keeps the lanes honest: a lane runs the whole directory, never a
  hand-picked file list.** Coverage per substrate comes from the gates the code already
  has (`isHttpTransport()` in `tests/utils/auth-headers.ts`, `isQdrantBackend()` in
  `tests/utils/vector-backend.ts`, `AUTH_ENABLED`), which self-skip suites that cannot run
  on the current substrate. Adding a lane means adding a substrate, not a list of files.
- Coverage deltas, stated plainly rather than pretended away:
  - the no-auth + Qdrant combination is no longer run anywhere — Qdrant-substrate suites
    execute in the cluster lane only, and the embedded suites in the single lane;
  - the cluster lane does not exercise the embedded backend at all;
  - the zero-infrastructure product story (`npx`-style, no services) moved from an
    advisory `continue-on-error` lane to a merge gate, so a defect in it now blocks merges.
- The stdio full suite has never been run service-free. Expect the first rounds to surface
  skips and failures that were previously masked by the OpenAI-backed lane; repair by
  following the existing gates, not by deleting assertions.
- Wall clock: the single lane pays one cold boot injection per run (later process starts
  hit the version-reuse skip, [0002](0002-boot-injection-reuse-rule.md), but still load the
  model) and then one full suite serially (`--runInBand`) — hence 30 min against the cluster
  lane's 30 min, which measured ~12 min at the time of writing.

## Alternatives considered

- Keep four lanes and just strip the key from stdio (#25): rejected — it left three
  partially overlapping hand-curated suites whose substrate coverage no one could state,
  and the cost premise it was protecting (ONNX per stdio spawn) was the #24 defect.
- A third `AUTH off + Qdrant` lane to close the delta above: rejected for now on cost
  (a full suite per substrate pair) rather than on principle; reopen with a new issue when
  a defect actually hides in that combination.
- Rename `integration-pass` to something lane-shaped: rejected — branch protection is
  configured on the aggregate context; only job ids and display names of the *lanes* are
  free to change.

## Evidence

`.github/workflows/integration.yml`, `scripts/ci-validate-workflows.mjs` (on the #26 branch
this enforced: both lanes exist, both are in `integration-pass.needs`, neither has
`continue-on-error`, both pin fastembed, the single lane blanks `QDRANT_URL` and runs
`dev_stdio:test`, and the workflow contract has no `workflow_call` secrets),
`.github/workflows/README.md` (lane matrix wording), branch protection requiring only
`Integration workflow passed`.

All of the above describe the [#26](https://github.com/SquadRules/mcp/pull/26) branch. On
`main`, `integration.yml` still defines the four lanes named in Context and
`ci-validate-workflows.mjs` does not assert a two-lane topology.
