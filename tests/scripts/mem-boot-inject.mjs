/**
 * Boot-injection helper for tests/integration/mem-resources-boot-dedupe-regression.test.ts.
 *
 * Why this exists as a separate process instead of a call inside the test:
 *  - Boot injection embeds every shipped mem adapter through fastembed's ONNX runtime, and real
 *    ONNX must not run inside a Jest worker. `onnxruntime-common` is a dual package, so under
 *    `--experimental-vm-modules` its `data instanceof Float32Array` guard can compare a host-realm
 *    constructor against a vm-realm value and throw (evidence: PR #26, run 37461462411).
 *  - The alternative — faking the provider boundary — is not available here: `tests/integration/**`
 *    is forbidden from using mocks by scripts/lint-verify-clean-source.mjs, which blocks the build.
 *  - A child process also runs the published artifact (`./dist`, the same tree the CLI tests use via
 *    tests/integration/cli-commands-shared.ts), so the code under test is what the server executes
 *    at boot. All Qdrant assertions stay in the test realm.
 *
 * Usage: node tests/scripts/mem-boot-inject.mjs --collection <squadrules-test-*> [--force]
 * Prints one `MEM_BOOT_INJECT_RESULT <json>` line on stdout, then exits 0 on success / 1 on failure.
 */
import { parseArgs } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeSync } from 'node:fs';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RESULT_MARKER = 'MEM_BOOT_INJECT_RESULT ';
/** Guard against a mistyped flag retraining the real app collection instead of a scratch one. */
const TEST_COLLECTION_PREFIX = 'squadrules-test-';

// writeSync, not console/process.stdout.write: the process exits right after reporting, and an
// async pipe write can be truncated by process.exit().
function report(payload) {
  writeSync(1, `${RESULT_MARKER}${JSON.stringify(payload)}\n`);
}

function fail(message, error) {
  const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  writeSync(2, `[mem-boot-inject] ${message}: ${detail}\n`);
  report({ ok: false, message });
  process.exit(1);
}

const options = parseArgs({
  options: {
    collection: { type: 'string' },
    force: { type: 'boolean', default: false },
  },
}).values;

const collection = options.collection;
if (!collection) fail('missing --collection <name>');
else if (!collection.startsWith(TEST_COLLECTION_PREFIX)) fail(`--collection must start with '${TEST_COLLECTION_PREFIX}'`, collection);

try {
  const { installQdrantFetchCompatibility } = await import(pathToFileURL(resolve(PROJECT_ROOT, 'dist/services/qdrant/undici-compat.js')).href);
  const { probeEmbeddingDimension } = await import(pathToFileURL(resolve(PROJECT_ROOT, 'dist/services/embedding/service.js')).href);
  const { MemoryQdrantStore } = await import(pathToFileURL(resolve(PROJECT_ROOT, 'dist/services/memory/store.js')).href);
  const { injectMemResourcesAtBoot } = await import(pathToFileURL(resolve(PROJECT_ROOT, 'dist/resources/mem-resources-boot.js')).href);
  const { SQUADRULES_APP_SPACE_ID } = await import(pathToFileURL(resolve(PROJECT_ROOT, 'dist/config.js')).href);

  installQdrantFetchCompatibility();

  // Same order as src/index.ts: the dimension must be resolved before the collection is created.
  const dimension = await probeEmbeddingDimension();
  const memoryStore = new MemoryQdrantStore({ collection });
  await memoryStore.init();
  await injectMemResourcesAtBoot(memoryStore, options.force ? { force: true } : {});

  // injectMemResourcesAtBoot logs per-adapter failures instead of throwing, so the caller needs a
  // positive signal that points were actually written to the app space.
  const { client } = memoryStore.getQdrantAccess();
  const counted = await client.count(collection, {
    filter: { must: [{ key: 'space_id', match: { value: SQUADRULES_APP_SPACE_ID } }] },
    exact: true,
  });

  report({ ok: true, collection, force: options.force, dimension, appSpacePoints: counted?.count ?? 0 });
} catch (error) {
  fail('injection failed', error);
}

// ONNX runtime teardown aborts the process if it is interrupted by process.exit() ("mutex lock
// failed: Invalid argument", SIGABRT), so the helper exits by draining its own event loop instead.
process.exitCode = 0;
