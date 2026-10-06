/**
 * Boot injection must recover when the app space already holds a duplicate row for a shipped slug.
 * Covers the forced delete-then-retrain path of src/resources/mem-resources-boot.ts — the repair
 * switch documented in docs/adr/0002 — end to end against a real Qdrant collection.
 *
 * Both injections run in a child process; tests/scripts/mem-boot-inject.mjs explains why (real ONNX
 * cannot load inside a Jest worker, and the integration test tree may not mock the provider:
 * scripts/lint-verify-clean-source.mjs blocks the build on jest imports under tests/integration).
 * This file therefore only drives Qdrant: seed, corrupt, re-seed, assert the duplicate is gone.
 */
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { isHttpTransport } from '../utils/auth-headers.js';
import { testQdrantBackend } from '../utils/vector-backend.js';

const execFileAsync = promisify(execFile);

const _d = isHttpTransport() ? describe : describe.skip;

const INJECT_HELPER = join(process.cwd(), 'tests', 'scripts', 'mem-boot-inject.mjs');
const RESULT_MARKER = 'MEM_BOOT_INJECT_RESULT ';
const FIXTURE_SLUG = 'create-new-protocol';

/**
 * One forced injection re-embeds all 9 shipped adapters on CPU ONNX. Measured: 99.6 s on a CI runner
 * (PR #26, job 112262537598: health poll started 12:14:40.15, first healthy response 12:16:19.76,
 * which also covers node startup and store init) and 168 s for one cold pass on a loaded local
 * machine. The cap is a little over 2x the CI figure. The test runs two injections and took 403 s
 * locally, so its own timeout leaves headroom above that.
 */
const INJECTION_TIMEOUT_MS = 240_000;
const TEST_TIMEOUT_MS = 540_000;

interface InjectionResult {
  ok: boolean;
  collection: string;
  force: boolean;
  dimension: number;
  appSpacePoints: number;
  message?: string;
}

/** Run one boot injection in a clean process and return its report. */
async function runBootInjection(collection: string): Promise<InjectionResult> {
  const { stdout } = await execFileAsync(
    process.execPath,
    [INJECT_HELPER, '--collection', collection, '--force'],
    { env: process.env, timeout: INJECTION_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 }
  );
  const line = stdout.split('\n').filter(entry => entry.startsWith(RESULT_MARKER)).pop();
  if (!line) {
    throw new Error(`mem-boot-inject helper returned no result line. stdout tail:\n${stdout.slice(-2000)}`);
  }
  const result = JSON.parse(line.slice(RESULT_MARKER.length)) as InjectionResult;
  if (!result.ok) {
    throw new Error(`mem-boot-inject helper failed: ${result.message ?? 'unknown error'}`);
  }
  return result;
}

_d('Mem resources boot injection dedupe regression', () => {
  testQdrantBackend('boot injection recovers when app-space already contains duplicate slug entries', async () => {
    const testCollection = `squadrules-test-mem-boot-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    let qdrantClient: any;

    // The client is created before the collection exists: `init()` is deliberately not called here,
    // because creating a collection needs the embedding dimension, and probing it would load ONNX
    // into this worker. The helper creates the collection as part of the first injection.
    const [{ installQdrantFetchCompatibility }, { MemoryQdrantStore }, { SQUADRULES_APP_SPACE_ID }] =
      await Promise.all([
        import('../../src/services/qdrant/undici-compat.js'),
        import('../../src/services/memory/store.js'),
        import('../../src/config.js')
      ]);

    installQdrantFetchCompatibility();

    try {
      const memoryStore = new MemoryQdrantStore({ collection: testCollection });
      const { client } = memoryStore.getQdrantAccess();
      qdrantClient = client;

      // First boot: train all adapters
      const first = await runBootInjection(testCollection);
      expect(first.appSpacePoints).toBeGreaterThan(0);

      // Find the first-layer point for 'create-new-protocol' by slug
      const slugFilter = {
        must: [
          { key: 'slug', match: { value: FIXTURE_SLUG } },
          { key: 'space_id', match: { value: SQUADRULES_APP_SPACE_ID } },
          { key: 'adapter.layer_index', match: { value: 1 } }
        ]
      };
      const base = await client.scroll(testCollection, {
        filter: slugFilter,
        limit: 1,
        with_payload: true,
        with_vector: true
      } as any);

      expect(base?.points?.length).toBeGreaterThan(0);
      const basePoint = base.points[0] as any;
      const basePointId = typeof basePoint.id === 'string' ? basePoint.id : String(basePoint.id);

      // Simulate corruption: delete the original point and re-insert with a random UUID
      const conflictId = crypto.randomUUID();
      await client.delete(testCollection, { points: [basePointId] } as any);
      await client.upsert(testCollection, {
        points: [
          {
            id: conflictId,
            payload: basePoint.payload,
            vector: basePoint.vector
          }
        ]
      } as any);

      // Second boot (force): should detect the slug still exists but retrain anyway
      await runBootInjection(testCollection);

      // Verify: at least one point with slug 'create-new-protocol' exists in app space
      const restored = await client.scroll(testCollection, {
        filter: slugFilter,
        limit: 1,
        with_payload: true,
        with_vector: false
      } as any);

      expect(restored?.points?.length).toBeGreaterThan(0);
      expect((restored.points[0] as any)?.payload?.space_id).toBe(SQUADRULES_APP_SPACE_ID);

      // And the retrain replaced the corrupt row rather than merely leaving a same-slug point
      // behind: deletePreexistingAppSpaceEntries() clears by slug before writing, so the foreign
      // UUID is gone.
      const survivors = await client.retrieve(testCollection, { ids: [conflictId] } as any);
      expect(survivors).toHaveLength(0);
    } finally {
      if (qdrantClient) {
        try {
          await qdrantClient.deleteCollection(testCollection);
        } catch {
        }
      }
    }
  }, TEST_TIMEOUT_MS);
});
