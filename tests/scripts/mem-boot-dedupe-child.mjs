/**
 * Real-inference child for the Qdrant boot-injection dedupe regression.
 *
 * ADR 0004: ONNX must not run in Jest's VM realm. The production embedding
 * provider, Qdrant store and boot injector run here under plain Node instead.
 * Throwing (including failed assertions) makes the parent Jest test fail.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.SQUADRULES_LOG_STDERR = '1';

const [
  { probeEmbeddingDimension },
  { installQdrantFetchCompatibility },
  { MemoryQdrantStore },
  { injectMemResourcesAtBoot },
  { SQUADRULES_APP_SPACE_ID },
  { keyValueStore },
] = await Promise.all([
  import('../../dist/services/embedding/service.js'),
  import('../../dist/services/qdrant/undici-compat.js'),
  import('../../dist/services/memory/store.js'),
  import('../../dist/resources/mem-resources-boot.js'),
  import('../../dist/config.js'),
  import('../../dist/services/key-value-store-factory.js'),
]);

const testCollection = `squadrules-test-mem-boot-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
let qdrantClient;
let collectionToDelete;

try {
  installQdrantFetchCompatibility();
  await probeEmbeddingDimension();

  const memoryStore = new MemoryQdrantStore({ collection: testCollection });
  await memoryStore.init();
  const { client, collection } = memoryStore.getQdrantAccess();
  qdrantClient = client;
  collectionToDelete = collection;

  // First boot: train the real bundled adapters.
  await injectMemResourcesAtBoot(memoryStore, { force: true });

  const slugFilter = {
    must: [
      { key: 'slug', match: { value: 'author-adapter' } },
      { key: 'space_id', match: { value: SQUADRULES_APP_SPACE_ID } },
      { key: 'adapter.layer_index', match: { value: 1 } },
    ],
  };
  const base = await client.scroll(collection, {
    filter: slugFilter, limit: 1, with_payload: true, with_vector: true,
  });
  assert.ok(base?.points?.length > 0, 'initial injection must create author-adapter');
  const basePoint = base.points[0];
  const basePointId = String(basePoint.id);

  // Simulate corruption: replace the original point with a random UUID.
  const conflictId = crypto.randomUUID();
  await client.delete(collection, { points: [basePointId] });
  await client.upsert(collection, {
    points: [{ id: conflictId, payload: basePoint.payload, vector: basePoint.vector }],
  });

  // Second forced boot must recover the adapter despite the duplicate slug.
  await injectMemResourcesAtBoot(memoryStore, { force: true });
  const restored = await client.scroll(collection, {
    filter: slugFilter, limit: 1, with_payload: true, with_vector: false,
  });
  assert.ok(restored?.points?.length > 0, 'second injection must restore author-adapter');
  assert.equal(restored.points[0]?.payload?.space_id, SQUADRULES_APP_SPACE_ID);

  // Preserve the original regression's best-effort conflict cleanup.
  try { await client.delete(collection, { points: [conflictId] }); } catch { /* ignore */ }
  process.stdout.write(JSON.stringify({ ok: true, collection: testCollection }) + '\n');
} finally {
  if (qdrantClient && collectionToDelete) {
    try { await qdrantClient.deleteCollection(collectionToDelete); } catch { /* ignore */ }
  }
  await keyValueStore.disconnect();
}
