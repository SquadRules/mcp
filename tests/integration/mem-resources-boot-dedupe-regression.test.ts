// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import crypto from 'node:crypto';
import { isHttpTransport } from '../utils/auth-headers.js';

const _d = isHttpTransport() ? describe : describe.skip;

_d('Mem resources boot injection dedupe regression', () => {
  test('boot injection recovers when app-space already contains duplicate slug entries', async () => {
    const testCollection = `kairos-test-mem-boot-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    let keyValueStoreForThisTest: { disconnect(): Promise<void> } | undefined;
    let collectionToDelete: string | undefined;
    let qdrantClient: any;

    try {
      const [
        { probeEmbeddingDimension },
        { installQdrantFetchCompatibility },
        { MemoryQdrantStore },
        { injectMemResourcesAtBoot },
        { KAIROS_APP_SPACE_ID },
        { keyValueStore }
      ] = await Promise.all([
          import('../../src/services/embedding/service.js'),
          import('../../src/services/qdrant/undici-compat.js'),
          import('../../src/services/memory/store.js'),
          import('../../src/resources/mem-resources-boot.js'),
          import('../../src/config.js'),
          import('../../src/services/key-value-store-factory.js')
        ]);

      installQdrantFetchCompatibility();
      keyValueStoreForThisTest = keyValueStore;
      await probeEmbeddingDimension();
      const memoryStore = new MemoryQdrantStore({ collection: testCollection });
      await memoryStore.init();

      const { client, collection } = memoryStore.getQdrantAccess();
      qdrantClient = client;
      collectionToDelete = collection;

      // First boot: train all adapters
      await injectMemResourcesAtBoot(memoryStore, { force: true });

      // Find the first-layer point for 'create-new-protocol' by slug
      const slugFilter = {
        must: [
          { key: 'slug', match: { value: 'create-new-protocol' } },
          { key: 'space_id', match: { value: KAIROS_APP_SPACE_ID } },
          { key: 'adapter.layer_index', match: { value: 1 } }
        ]
      };
      const base = await client.scroll(collection, {
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
      await client.delete(collection, { points: [basePointId] } as any);
      await client.upsert(collection, {
        points: [
          {
            id: conflictId,
            payload: basePoint.payload,
            vector: basePoint.vector
          }
        ]
      } as any);

      // Second boot (force): should detect the slug still exists but retrain anyway
      await injectMemResourcesAtBoot(memoryStore, { force: true });

      // Verify: at least one point with slug 'create-new-protocol' exists in app space
      const restored = await client.scroll(collection, {
        filter: slugFilter,
        limit: 1,
        with_payload: true,
        with_vector: false
      } as any);

      expect(restored?.points?.length).toBeGreaterThan(0);
      expect((restored.points[0] as any)?.payload?.space_id).toBe(KAIROS_APP_SPACE_ID);

      // Cleanup the conflict point if it still exists
      try { await client.delete(collection, { points: [conflictId] } as any); } catch { /* ignore */ }
    } finally {
      if (qdrantClient && collectionToDelete) {
        try {
          await qdrantClient.deleteCollection(collectionToDelete);
        } catch {
        }
      }
      if (keyValueStoreForThisTest) {
        await keyValueStoreForThisTest.disconnect();
      }
    }
  }, 120000);
});
