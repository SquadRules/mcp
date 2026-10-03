import { MemoryQdrantStore } from '../services/memory/store.js';
import { structuredLogger } from '../utils/structured-logger.js';
import { runWithSpaceContextAsync } from '../utils/tenant-context.js';
import { SQUADRULES_APP_SPACE_ID } from '../config.js';
import { MEM_FILE_SLUG_KEY, getMemDir, getMemDirFallback, readMemFiles } from './mem-dir-utils.js';
import { deletePreexistingAppSpaceEntries, extractFrontmatterSlug } from './mem-uuid-mapper.js';
import { sha256Hex } from '../tools/skill-export/sha256.js';
import { parseFrontmatter } from '../utils/frontmatter.js';
import { compareSemver } from '../utils/version-compare.js';
import { redisCacheService } from '../services/redis-cache.js';

/** Payload key for storing content SHA256 (enables change detection at boot). */
const CONTENT_SHA256_KEY = 'content_sha256';

/**
 * Look up the protocol_version of an already-stored adapter by slug.
 * Returns undefined if no matching entry exists or lookup fails.
 */
async function getStoredAdapterVersion(
  client: any,
  collection: string,
  slug: string
): Promise<string | undefined> {
  const page = await client.scroll(collection, {
    limit: 1,
    with_payload: { include: ['protocol_version'] },
    with_vector: false,
    filter: {
      must: [
        { key: 'space_id', match: { value: SQUADRULES_APP_SPACE_ID } },
        { key: 'slug', match: { value: slug } }
      ]
    }
  } as any);
  const point = page?.points?.[0];
  if (!point?.payload) return undefined;
  const v = (point.payload as any).protocol_version;
  return typeof v === 'string' ? v : undefined;
}

/**
 * Inject mem resources from filesystem into Qdrant at system boot.
 * Uses slug-based filenames. Each adapter file is deleted-then-retrained
 * to ensure clean state. SHA256 hashes are stored in payload for future
 * change detection use.
 */
export async function injectMemResourcesAtBoot(memoryStore: MemoryQdrantStore, options: { force?: boolean } = {}): Promise<void> {
  const primaryDir = getMemDir();
  structuredLogger.info(`[mem-resources-boot] Mem dir: ${primaryDir}`);

  let memResources = await readMemFiles(primaryDir);
  if (Object.keys(memResources).length === 0) {
    const fallbackDir = getMemDirFallback();
    structuredLogger.info(`[mem-resources-boot] No files in primary dir, trying fallback: ${fallbackDir}`);
    memResources = await readMemFiles(fallbackDir);
  }

  const fileCount = Object.keys(memResources).length;
  structuredLogger.info(`[mem-resources-boot] Mem files found: ${fileCount}`);

  if (fileCount === 0) {
    structuredLogger.info('[mem-resources-boot] No mem resources to inject');
    return;
  }

  const appSpaceContext = {
    userId: '',
    groupIds: [],
    allowedSpaceIds: [SQUADRULES_APP_SPACE_ID],
    defaultWriteSpaceId: SQUADRULES_APP_SPACE_ID,
    personalSpaceId: ''
  };

  await runWithSpaceContextAsync(appSpaceContext, async () => {
    structuredLogger.info(`[mem-resources-boot] Injecting ${fileCount} mem resources into Qdrant (force: ${options.force || false})`);

    const llmModelId = 'system-boot';
    const { client, collection } = memoryStore.getQdrantAccess();
    let injectedCount = 0;

    for (const [slug, markdownContent] of Object.entries(memResources)) {
      if (typeof markdownContent !== 'string') continue;
      if (!MEM_FILE_SLUG_KEY.test(slug)) {
        structuredLogger.debug(`[mem-resources-boot] Skip non-slug mem key: ${slug}`);
        continue;
      }

      const frontmatterSlug = extractFrontmatterSlug(markdownContent);
      if (frontmatterSlug && frontmatterSlug !== slug) {
        structuredLogger.warn(
          `[mem-resources-boot] Filename slug '${slug}' differs from frontmatter slug '${frontmatterSlug}'; using filename`
        );
      }

      const shippedSha = sha256Hex(markdownContent);
      const shippedVersion = parseFrontmatter(markdownContent).version ?? undefined;

      try {
        // Version-based skip: if stored adapter already matches or is newer, skip retraining
        try {
          const storedVersion = await getStoredAdapterVersion(client, collection, slug);
          if (storedVersion !== undefined && shippedVersion !== undefined) {
            const cmp = compareSemver(shippedVersion, storedVersion);
            if (cmp <= 0) {
              structuredLogger.info(
                `[mem-resources-boot] '${slug}' stored v${storedVersion} >= shipped v${shippedVersion}, skipping`
              );
              injectedCount++;
              continue;
            }
            structuredLogger.info(
              `[mem-resources-boot] '${slug}' shipped v${shippedVersion} > stored v${storedVersion}, updating`
            );
          }
        } catch {
          // Version check is best-effort; proceed with delete-then-retrain
        }

        // Delete any preexisting entries by slug/title filter
        await deletePreexistingAppSpaceEntries(memoryStore, markdownContent, slug);

        // Train the adapter
        const storeOpts: { forceUpdate: boolean; protocolVersion?: string } = { forceUpdate: true };
        if (shippedVersion) storeOpts.protocolVersion = shippedVersion;
        const memories = await memoryStore.storeAdapter([markdownContent], llmModelId, storeOpts);

        // Store content_sha256 in all layers for future change detection
        if (memories.length > 0) {
          const layerIds = memories.map(m => m.memory_uuid);
          await client.setPayload(collection, {
            payload: { [CONTENT_SHA256_KEY]: shippedSha },
            points: layerIds
          } as any);
          injectedCount++;
          structuredLogger.info(
            `[mem-resources-boot] Trained adapter '${slug}' (${memories.length} layer(s), SHA=${shippedSha.slice(0, 12)}...)`
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        structuredLogger.error(`[mem-resources-boot] Failed to inject adapter '${slug}': ${message}`);
      }
    }

    structuredLogger.info(
      `[mem-resources-boot] Boot injection complete: ${injectedCount} adapter(s) trained out of ${fileCount} file(s)`
    );

    const { methods } = (memoryStore as any);
    if (methods) {
      await redisCacheService.invalidateAfterUpdate();
    }
  });
}
