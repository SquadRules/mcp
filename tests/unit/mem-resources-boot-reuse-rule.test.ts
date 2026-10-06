/**
 * Unit tests for the boot-injection reuse rule (issue #24, docs/adr/0002).
 *
 * `injectMemResourcesAtBoot()` re-embeds a shipped mem adapter only when its stored
 * protocol version is older than the shipped one (or unknown). `force` — the explicit
 * option or the MEM_BOOT_FORCE_INJECT switch — bypasses the check entirely and is the
 * documented repair path for a structurally corrupted store.
 *
 * The filesystem read and the store are both replaced, so the rule is proven without
 * ONNX, embeddings, Qdrant, LanceDB or Redis.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { MemoryQdrantStore } from '../../src/services/memory/store.js';
import type { Memory } from '../../src/types/memory.js';

const SLUG = 'unit-boot-adapter';
const SHIPPED_VERSION = '1.2.3';
const FIXTURE_MARKDOWN = `---\nslug: ${SLUG}\nversion: ${SHIPPED_VERSION}\n---\n\n# Unit Boot Adapter\n\nStep one.\n`;

interface BootHarness {
  store: MemoryQdrantStore;
  getStoredAdapterVersion: jest.Mock<(slug: string) => Promise<string | undefined>>;
  storeAdapter: jest.Mock<
    (input: string[], llmModelId: string, opts: { forceUpdate: boolean; protocolVersion?: string }) => Promise<Memory[]>
  >;
  deleteAppSpaceBySlug: jest.Mock<(slug: string) => Promise<void>>;
  setPayloadOnLayers: jest.Mock<(layerIds: string[], patch: Record<string, unknown>) => Promise<void>>;
}

/**
 * Store double for the surface the boot injector touches. `methods` is deliberately absent:
 * its presence is what triggers the trailing Redis invalidation, which has no business in a
 * unit test.
 */
function bootHarness(storedVersion: string | undefined): BootHarness {
  const getStoredAdapterVersion = jest.fn<(slug: string) => Promise<string | undefined>>(async () => storedVersion);
  const storeAdapter = jest.fn<
    (input: string[], llmModelId: string, opts: { forceUpdate: boolean; protocolVersion?: string }) => Promise<Memory[]>
  >(async () => [{ memory_uuid: 'layer-1', label: SLUG } as unknown as Memory]);
  const deleteAppSpaceBySlug = jest.fn<(slug: string) => Promise<void>>(async () => undefined);
  const deleteAppSpaceByAdapterId = jest.fn<(adapterId: string) => Promise<void>>(async () => undefined);
  const setPayloadOnLayers = jest.fn<(layerIds: string[], patch: Record<string, unknown>) => Promise<void>>(
    async () => undefined
  );
  const store = {
    getStoredAdapterVersion,
    storeAdapter,
    deleteAppSpaceBySlug,
    deleteAppSpaceByAdapterId,
    setPayloadOnLayers
  } as unknown as MemoryQdrantStore;
  return { store, getStoredAdapterVersion, storeAdapter, deleteAppSpaceBySlug, setPayloadOnLayers };
}

/**
 * Fresh copy of the injector reading one fixture adapter from a stubbed mem dir, with the
 * force switch taken from `process.env` at import time (module-scope constant).
 */
async function freshInjector(envForce?: string): Promise<typeof import('../../src/resources/mem-resources-boot.js').injectMemResourcesAtBoot> {
  jest.resetModules();
  if (envForce === undefined) delete process.env.MEM_BOOT_FORCE_INJECT;
  else process.env.MEM_BOOT_FORCE_INJECT = envForce;

  jest.unstable_mockModule('../../src/resources/mem-dir-utils.js', () => ({
    MEM_FILE_SLUG_KEY: /^[a-z0-9]+(-[a-z0-9]+)*$/i,
    getMemDir: () => 'unit-test-mem-dir',
    getMemDirFallback: () => 'unit-test-mem-dir-fallback',
    readMemFiles: async () => ({ [SLUG]: FIXTURE_MARKDOWN })
  }));

  // The delete-then-retrain path invalidates caches; keep Redis out of the test.
  const { redisCacheService } = await import('../../src/services/redis-cache.js');
  jest.spyOn(redisCacheService, 'invalidateMemoryCache').mockResolvedValue(undefined);
  jest.spyOn(redisCacheService, 'invalidateAfterUpdate').mockResolvedValue(undefined);

  const mod = await import('../../src/resources/mem-resources-boot.js');
  return mod.injectMemResourcesAtBoot;
}

describe('injectMemResourcesAtBoot() reuse rule', () => {
  const savedForce = process.env.MEM_BOOT_FORCE_INJECT;

  beforeEach(() => {
    delete process.env.MEM_BOOT_FORCE_INJECT;
  });

  afterEach(() => {
    process.env.MEM_BOOT_FORCE_INJECT = savedForce;
    jest.resetModules();
  });

  test('stored version equal to shipped: reuses the adapter and embeds nothing', async () => {
    const inject = await freshInjector();
    const harness = bootHarness(SHIPPED_VERSION);
    await inject(harness.store);

    expect(harness.getStoredAdapterVersion).toHaveBeenCalledWith(SLUG);
    expect(harness.storeAdapter).not.toHaveBeenCalled();
    expect(harness.deleteAppSpaceBySlug).not.toHaveBeenCalled();
    expect(harness.setPayloadOnLayers).not.toHaveBeenCalled();
  });

  test('stored version newer than shipped: still reuses (never down-trains)', async () => {
    const inject = await freshInjector();
    const harness = bootHarness('9.9.9');
    await inject(harness.store);

    expect(harness.storeAdapter).not.toHaveBeenCalled();
  });

  test('stored version older than shipped: deletes and retrains at the shipped version', async () => {
    const inject = await freshInjector();
    const harness = bootHarness('1.0.0');
    await inject(harness.store);

    expect(harness.deleteAppSpaceBySlug).toHaveBeenCalledWith(SLUG);
    expect(harness.storeAdapter).toHaveBeenCalledTimes(1);
    const [inputs, , opts] = harness.storeAdapter.mock.calls[0] as [string[], string, { forceUpdate: boolean; protocolVersion?: string }];
    expect(inputs).toEqual([FIXTURE_MARKDOWN]);
    expect(opts).toMatchObject({ forceUpdate: true, protocolVersion: SHIPPED_VERSION });
    const [, patch] = harness.setPayloadOnLayers.mock.calls[0] as [string[], Record<string, unknown>];
    expect(typeof patch['content_sha256']).toBe('string');
    expect(String(patch['content_sha256'])).toMatch(/^[0-9a-f]{64}$/);
  });

  test('no stored version (fresh or pre-version store): retrains', async () => {
    const inject = await freshInjector();
    const harness = bootHarness(undefined);
    await inject(harness.store);

    expect(harness.storeAdapter).toHaveBeenCalledTimes(1);
  });

  test('force option retrains over an equal version and does not consult the store', async () => {
    const inject = await freshInjector();
    const harness = bootHarness(SHIPPED_VERSION);
    await inject(harness.store, { force: true });

    expect(harness.getStoredAdapterVersion).not.toHaveBeenCalled();
    expect(harness.storeAdapter).toHaveBeenCalledTimes(1);
  });

  test('MEM_BOOT_FORCE_INJECT restores the always-retrain repair path', async () => {
    const inject = await freshInjector('true');
    const harness = bootHarness(SHIPPED_VERSION);
    await inject(harness.store);

    expect(harness.getStoredAdapterVersion).not.toHaveBeenCalled();
    expect(harness.storeAdapter).toHaveBeenCalledTimes(1);
  });

  test.each(['true', '1', 'YES', 'y'])('MEM_BOOT_FORCE_INJECT=%s is truthy', async (spelling) => {
    const inject = await freshInjector(spelling);
    const harness = bootHarness(SHIPPED_VERSION);
    await inject(harness.store);
    expect(harness.storeAdapter).toHaveBeenCalledTimes(1);
  });

  test.each(['false', '0', 'no', ''])('MEM_BOOT_FORCE_INJECT=%j does not force', async (spelling) => {
    const inject = await freshInjector(spelling);
    const harness = bootHarness(SHIPPED_VERSION);
    await inject(harness.store);
    expect(harness.storeAdapter).not.toHaveBeenCalled();
  });
});
