# 0004 — fastembed is the only embedding provider in CI

Status: **Proposed** — recorded in [#26](https://github.com/SquadRules/mcp/pull/26), closed
unmerged. On `main` the CI lanes still hold an OpenAI key and the stdio exception
([#25](https://github.com/SquadRules/mcp/issues/25)) still stands. The decision below —
every CI lane embeds locally with fastembed — and all measurements cited were implemented on
the #26 branch only; read the Decision and Consequences as describing that branch, not
`main`. It supersedes nothing until it is re-landed.
Date: 2026-10-06

## Context

Adapter writes were the main OpenAI consumer in CI: boot injection trains the shipped
mem adapters on every server start, and the suites train fixtures too. The previous
cost strategy was to *gate* that spend — `3c76573c` consolidated the integration
workflows "and gate for OpenAI quota" — which made quota a scheduling problem instead
of removing it.

Local embeddings (`fastembed`, CPU ONNX, no key) exist precisely to remove that spend.
When this record was first written one of the four lanes was still key-bearing:
`verify-integration-stdio-smoke`, because boot injection is awaited before the transport
connects and every stdio test spawned its own server, so local ONNX looked like minutes
per spawn. [#23](https://github.com/SquadRules/mcp/issues/23) then proposed *adding* an
OpenAI-backed advisory lane for provider coverage. Both positions turned out to rest on
the broken reuse rule ([0002](0002-boot-injection-reuse-rule.md),
[#24](https://github.com/SquadRules/mcp/issues/24)), not on fastembed: with the skip
working, a warm store boots in seconds.

## Decision

Every CI test lane embeds locally. No lane holds an OpenAI key, and the reusable
workflow contract cannot pass one:

- Both integration lanes ([0006](0006-two-integration-lanes.md)) blank
  `OPENAI_API_KEY`, pin `EMBEDDING_PROVIDER=fastembed`, and fail the job if an external
  provider (`openai` or `tei`) survives the override. `.env` generation still receives a
  throwaway `ci-keyfree-placeholder`, because the generator requires every `SECRET_KEYS`
  value to be non-empty; the next step strips it.
- `on.workflow_call.secrets.OPENAI_API_KEY` is deleted from `integration.yml`, so
  `.github/workflows/release.yml` no longer passes a key into the integration contract.
  A lane cannot accidentally acquire a key: the input does not exist.
- The single-mode lane blanks `QDRANT_URL` as well, so server, Jest worker and spawned
  stdio children all use the embedded LanceDB store with local embeddings — the
  zero-infrastructure product path, now a merge gate instead of an advisory lane.
- `scripts/env/.env.template` keeps `EMBEDDING_PROVIDER=openai`. This decision is about
  CI, not about the quality defaults for self-hosted deployments.
- `verify-openai-key.yml` (manual dispatch) is the only OpenAI surface left in CI: a
  key-presence and embeddings probe for diagnosing quota failures, not a test lane.

## Consequences

- CI no longer spends OpenAI quota on writes, so quota exhaustion can no longer redden a
  merge gate, and fork PRs need no secret at all.
- Nothing had to be re-dimensioned: no test asserted the OpenAI width (the only `1536`
  references are a JSDoc example and a unit test that constructs its own fake), and
  `tests/unit/embedding-provider-selection.test.ts` is env-isolated, so pinning fastembed
  in the generated `.env` does not change its outcome.
- Boot is minutes instead of seconds on a cold store, so the cluster lane sets
  `HEALTH_CHECK_ATTEMPTS: 120`. The wait loop breaks on the first healthy response, so the
  cap costs nothing when boot is fast — but a lane that kept the old 15 attempts (~30 s)
  would have failed on an ephemeral runner. The single lane has no long-lived HTTP server,
  so no health check.
- What makes that affordable is measured, not assumed: a forced cold injection of the 9
  shipped adapters takes 99.6 s on a CI runner (PR #26, job 112262537598), a warm boot
  takes 2.4 s, weights cost 208 MB and are cached per runner, and the test harness keeps
  them reachable — `deploy-run-env.sh test()` pins `FASTEMBED_CACHE_DIR` to the shared
  per-user models dir so the isolated `XDG_CONFIG_HOME` never triggers a re-download, and
  `TEST_XDG_CONFIG_HOME` lets one embedded store be shared by the server and the children
  it spawns.
- Real ONNX must not run inside a Jest worker. `onnxruntime-common` is a dual package, so
  under `--experimental-vm-modules` its `data instanceof Float32Array` guard can compare a
  host-realm constructor against a vm-realm value and throw (PR #26:
  `TypeError: A float32 tensor's data must be type of function Float32Array()`).
  Integration tests may not mock the provider either —
  `scripts/lint-verify-clean-source.mjs` blocks the build on jest imports under
  `tests/integration`. So the one test that needs boot injection drives it through a child
  process, `tests/scripts/mem-boot-inject.mjs`, and keeps its assertions in the test realm.
- The OpenAI provider path has no automated coverage in CI. The decided response is the
  manual probe above, not a lane: an advisory OpenAI lane would re-add the secret, the
  quota dependency and the merge-gate ambiguity that this decision removes
  ([#23](https://github.com/SquadRules/mcp/issues/23) closed as rejected).

## Alternatives considered

- Keep gating on quota (the `3c76573c` posture): rejected — it preserves an external
  dependency and a spend to avoid a problem that local embeddings already solve.
- Keep stdio key-bearing (#25, the position this record held when written): rejected once
  #24 was fixed. The measured cost it justified was the inert reuse rule, and the single
  shared store directory plus the working skip removes it.
- Fake the embedding provider inside the integration test that boots injection: rejected —
  the mock ban in `tests/integration` exists to keep integration evidence real, and the
  child process is both allowed and closer to the shipped artefact (`./dist`).

## Evidence

`.github/workflows/integration.yml` (the "Force key-free fastembed embeddings" and
"Force embedded backend and key-free fastembed" steps),
`.github/workflows/verify-openai-key.yml`, `scripts/ci-validate-workflows.mjs` (both lanes
must pin fastembed; no `workflow_call` secrets), `src/config/embedding-fastembed.ts`,
`src/utils/squadrules-user-dirs.ts` (default models path),
`scripts/deploy-generate-dev-secrets.py` (`SECRET_KEYS` non-empty check),
`scripts/deploy-run-env.sh` (`FASTEMBED_CACHE_DIR`, `TEST_XDG_CONFIG_HOME`),
`tests/scripts/mem-boot-inject.mjs`,
`tests/integration/mem-resources-boot-dedupe-regression.test.ts`.

The `integration.yml` steps named above ("Force key-free fastembed embeddings", "Force
embedded backend and key-free fastembed") and the `ci-validate-workflows.mjs` fastembed
assertions exist only on the [#26](https://github.com/SquadRules/mcp/pull/26) branch; on
`main` the integration lanes still pass `secrets.OPENAI_API_KEY`.
