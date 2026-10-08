# ADR 0007: SINGLE lane CI runs stdio integration test with cached fastembed model

## Status

Accepted

## Context

PR #30 delivered a two-lane CI model (CLUSTER + SINGLE) with env-less npm targets. The SINGLE lane initially ran only unit tests because cold fastembed initialization on CI runners exceeded timeouts:

- Cold fastembed model download: 30-60s on first run
- CPU ONNX runtime warmup: additional latency
- Boot-injected adapter training: compounds the delay
- Jest `beforeAll` hook timeout: 30s default
- MCP client request timeout: 60s default

Running the full integration suite or even stdio smoke tests in SINGLE mode caused ~40 suites to fail with "Exceeded timeout of 30000 ms for a hook" or `McpError: MCP error -32001: Request timed out`.

The team considered three options:

1. Accept that SINGLE mode integration tests are too slow for CI (cold fastembed)
2. Pre-warm fastembed before running tests
3. Cache the fastembed model directory between CI runs

Option 3 was chosen because it aligns with the existing CI caching strategy (Playwright browsers, Qdrant snapshots, npm packages) and eliminates the cold-start penalty without changing runtime behavior.

## Decision

Add GitHub Actions cache for `~/.config/squadrules/models` (the fastembed model directory) and run the stdio integration test (`spaces-tool.stdio-simple.test.ts`) in the SINGLE lane with a 120s Jest timeout.

The cache key is `${{ runner.os }}-fastembed-model-${{ hashFiles('package-lock.json') }}` with restore-keys fallback, so the model is downloaded once per dependency change and reused across runs.

## Consequences

### Positive

- **SINGLE lane completes in ~1m16s** (unit tests + stdio integration test)
- **Zero-config mode validated end-to-end**: proves stdio transport + LanceDB + fastembed work together without any env configuration
- **Model cache persists between runs**: eliminates cold-start penalty after the first run
- **No runtime changes**: fastembed library manages download, directory structure, and model loading; GitHub Actions only caches the directory

### Negative

- **First run after dependency change is slow**: cache miss triggers model download (~30-60s), but the 120s timeout accommodates this
- **Cache storage cost**: ~65 MB per OS (fast-bge-small-en-v1.5 model weights), acceptable for GitHub Actions

## Alternatives Considered

### Pre-warm fastembed in a separate step

Add a step that runs the app briefly to trigger model download before running tests. Rejected because:

- Adds complexity without caching benefit (model re-downloaded on every run)
- Slower than caching (download happens every time, not just on cache miss)

### Accept SINGLE lane runs only unit tests

Leave the SINGLE lane at unit tests only, accepting that stdio integration tests run only locally. Rejected because:

- Fails to validate the zero-config story end-to-end in CI
- Users expect CI to prove the package works without env configuration
- Local-only validation misses CI-specific issues (runner environment, cache behavior)

### Raise MCP client timeout

Increase the MCP SDK client's per-request timeout beyond 60s. Rejected because:

- The SDK exposes no `timeout` field on the client options or `callTool` method
- Even if it did, 60s+ timeouts mask real performance issues
- Caching solves the root cause (cold start) instead of hiding the symptom

## Evidence

- PR #37 CI run: SINGLE lane completes in 1m16s with cache hit
- First run (cache miss): model download takes ~30-60s, test completes within 120s timeout
- Subsequent runs (cache hit): test completes in ~10s
- Model directory: `~/.config/squadrules/models/Qdrant_bge-small-en-v1.5-onnx-Q` (~65 MB)

## Related

- [ADR 0006: Two integration lanes (CLUSTER + SINGLE)](./0006-two-integration-lanes.md)
- [ADR 0004: Fastembed default for testing](./0004-fastembed-default-for-testing.md)
- PR #30: refactor(ci): two-lane model (CLUSTER + SINGLE) and env-less npm targets
- PR #37: feat(ci): add fastembed model cache and stdio integration test to SINGLE lane
