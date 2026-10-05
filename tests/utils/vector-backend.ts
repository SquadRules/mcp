/**
 * Vector-backend detection for the integration suite.
 *
 * Mirrors `isQdrantConfigured` in `src/config.ts`: a non-empty `QDRANT_URL`
 * selects the Qdrant backend, an empty/unset value selects the embedded LanceDB
 * backend. A handful of integration tests are not product-behavior tests — they
 * poke the Qdrant substrate directly (raw `/collections/.../points/...` REST or a
 * `new MemoryQdrantStore()` client to seed/inspect fixtures) or hit the
 * Qdrant-only `POST /api/snapshot` endpoint. Those fixtures simply do not exist
 * under the embedded backend, so such tests are gated here instead of failing.
 * The product behavior they surround is covered by API-level tests that run on
 * both backends (e.g. `squadrules-mem-boot-injection`, export, activate/search).
 */

/** True when the server under test is backed by Qdrant (`QDRANT_URL` set non-empty). */
export function isQdrantBackend(): boolean {
  return (process.env.QDRANT_URL ?? '').trim().length > 0;
}

/** `describe` that runs only on the Qdrant backend; skips Qdrant-substrate suites on embedded LanceDB. */
export const describeQdrantBackend = isQdrantBackend() ? describe : describe.skip;

/** `test` that runs only on the Qdrant backend; skips a Qdrant-substrate test on embedded LanceDB. */
export const testQdrantBackend = isQdrantBackend() ? test : test.skip;
