# ADR 0007: SINGLE lane CI runs stdio integration test with user-shared embedding model cache

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

A second question arose: **where should the model cache live?** The initial implementation placed it under `~/.config/squadrules/models` (app-specific). This was wrong because:

- Embedding model weights are a **library-managed resource**, not application-specific data
- Placing them under the app config dir duplicates models if other apps also use fastembed
- The app config dir (`~/.config/squadrules/`) is appropriate for JSON config and LanceDB data (application-owned), but not for large re-downloadable model binaries

The correct location follows the XDG cache directory convention (`~/.cache/` on Unix, `%LOCALAPPDATA%` on Windows): user-shared across all embedding libraries, scoped to the library name (`embedding-models`), matching the pattern used by tools like Ollama — download once, reuse everywhere.

## Decision

1. **CI cache**: Add GitHub Actions cache for `~/.cache/embedding-models` and run the stdio integration test (`spaces-tool.stdio-simple.test.ts`) in the SINGLE lane with a 120s Jest timeout. The cache key is `${{ runner.os }}-fastembed-model-${{ hashFiles('package-lock.json') }}` with restore-keys fallback, so the model is downloaded once per dependency change and reused across runs.

2. **User-shared embedding models cache**: Replace the app-specific `getSquadrulesModelsDir()` (`~/.config/squadrules/models`) with `getEmbeddingModelsCacheDir()` (`~/.cache/embedding-models` on Unix, `%LOCALAPPDATA%\embedding-models` on Windows). This location is:
   - **User-shared**: all embedding libraries (fastembed, transformers.js, etc.) use the same directory, avoiding duplicate downloads
   - **XDG-compliant**: follows the XDG cache directory convention for re-downloadable artifacts
   - **Ollama-style**: download once, reuse everywhere — no per-project duplication
   - **Library-scoped**: the `embedding-models` subdirectory name keeps it scoped to embedding models without being a generic bucket

3. **Responsibility split**: GitHub Actions manages only the cache layer (restore/save steps). The fastembed library retains full control over download, directory structure, and model loading. The project does not pre-run npm or manage model files explicitly.

## Consequences

### Positive

- **SINGLE lane completes in ~1m16s** (unit tests + stdio integration test)
- **Zero-config mode validated end-to-end**: proves stdio transport + LanceDB + fastembed work together without any env configuration
- **Model cache persists between runs**: eliminates cold-start penalty after the first run
- **User-shared cache**: embedding model weights live in `~/.cache/embedding-models`, shared across all embedding libraries — no duplicate downloads per project
- **Clean separation of concerns**: app config (`~/.config/squadrules/`) holds application-owned data (config, LanceDB); XDG cache holds library-managed re-downloadable artifacts
- **No runtime changes**: fastembed library manages download, directory structure, and model loading; GitHub Actions only caches the directory

### Negative

- **First run after dependency change is slow**: cache miss triggers model download (~30-60s), but the 120s timeout accommodates this
- **Cache storage cost**: ~65 MB per OS (fast-bge-small-en-v1.5 model weights), acceptable for GitHub Actions
- **Shared directory coupling**: if a future embedding library uses the same directory with incompatible file naming, collisions are possible (mitigated by library-scoped subdirectory names)

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
- Model directory: `~/.cache/embedding-models/Qdrant_bge-small-en-v1.5-onnx-Q` (~65 MB)
- Cache location is user-shared (XDG style), not app-specific
- `getSquadrulesModelsDir()` removed from `src/utils/squadrules-user-dirs.ts`; replaced by `getEmbeddingModelsCacheDir()`
- `FASTEMBED_CACHE_DIR` in `src/config/embedding-fastembed.ts` now resolves to the user-shared location

## Related

- [ADR 0006: Two integration lanes (CLUSTER + SINGLE)](./0006-two-integration-lanes.md)
- [ADR 0004: Fastembed default for testing](./0004-fastembed-default-for-testing.md)
- PR #30: refactor(ci): two-lane model (CLUSTER + SINGLE) and env-less npm targets
- PR #37: feat(ci): add fastembed model cache and stdio integration test to SINGLE lane
