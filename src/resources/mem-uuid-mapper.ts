import { MemoryQdrantStore } from '../services/memory/store.js';
import { SQUADRULES_APP_SPACE_ID } from '../config.js';
import { parseFrontmatter } from '../utils/frontmatter.js';
import { IDGenerator } from '../services/id-generator.js';
import { structuredLogger } from '../utils/structured-logger.js';

export function extractFirstH1Title(markdown: string): string | null {
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^#\s+(.+)$/);
    if (m && m[1]) {
      const title = m[1].trim();
      return title.length > 0 ? title : null;
    }
  }
  return null;
}

export function extractFrontmatterSlug(markdownContent: string): string | null {
  const match = markdownContent.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  const frontmatter = match?.[1];
  if (!frontmatter) return null;
  const slugMatch = frontmatter.match(/^\s*slug:\s*"?([^"\n]+)"?\s*$/m);
  const slug = slugMatch?.[1]?.trim() ?? '';
  return slug.length > 0 ? slug : null;
}

/**
 * Delete preexisting app-space entries matching by slug or H1-title-derived adapter ID.
 * Used during boot to clean up pre-existing data before retraining.
 */
export async function deletePreexistingAppSpaceEntries(
  memoryStore: MemoryQdrantStore,
  markdownContent: string,
  contextLabel: string
): Promise<void> {
  const parsed = parseFrontmatter(markdownContent);
  const body = parsed.body.length > 0 ? parsed.body : markdownContent;
  const slug = typeof parsed.slugRaw === 'string' ? parsed.slugRaw.trim() : '';
  const h1Title = extractFirstH1Title(body);

  const filters: any[] = [];
  if (slug.length > 0) {
    filters.push({
      must: [
        { key: 'slug', match: { value: slug } },
        { key: 'space_id', match: { value: SQUADRULES_APP_SPACE_ID } }
      ]
    });
  }
  if (h1Title) {
    const adapterId = IDGenerator.generateAdapterUUIDv5(h1Title);
    filters.push({
      must: [
        { key: 'adapter.id', match: { value: adapterId } },
        { key: 'space_id', match: { value: SQUADRULES_APP_SPACE_ID } }
      ]
    });
  }

  if (filters.length === 0) return;

  const { client, collection } = memoryStore.getQdrantAccess();
  const { redisCacheService } = await import('../services/redis-cache.js');
  await redisCacheService.invalidateMemoryCache(contextLabel);

  for (const filter of filters) {
    await client.delete(collection, { filter } as any);
  }
  await redisCacheService.invalidateAfterUpdate();

  structuredLogger.warn(
    `[mem-resources-boot] Removed preexisting app-space points for '${contextLabel}'`
  );
}
