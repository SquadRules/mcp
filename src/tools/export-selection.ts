// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import type { MemoryQdrantStore } from '../services/memory/store.js';
import { getSpaceContextFromStorage } from '../utils/tenant-context.js';
import { resolveSpaceParamForContext } from '../utils/resolve-space-param.js';
import { EXPORT_MAX_ADAPTERS, type ExportInput } from './export_schema.js';
import { listAdapterUrisInSpace } from './skill-export/enumerate-space-adapters.js';
import type { SkillExportItem } from './skill-export/types.js';

export function normalizeAdapterUri(raw: string): string {
  const t = raw.trim();
  // Accept kairos:// (canonical) and squadrules:// (alias); always emit kairos://.
  if (/^(?:kairos|squadrules):\/\//i.test(t)) return t.replace(/^squadrules:\/\//i, 'kairos://');
  return `kairos://adapter/${t}`;
}

export function dedupeSlug(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let i = 2;
  let candidate = `${base}__${i}`;
  while (used.has(candidate)) {
    i += 1;
    candidate = `${base}__${i}`;
  }
  used.add(candidate);
  return candidate;
}

export function rehomeItemFiles(item: SkillExportItem, newSlug: string): SkillExportItem {
  return {
    ...item,
    slug: newSlug,
    files: item.files.map((f) => ({ ...f }))
  };
}

export async function resolveExportUris(
  memoryStore: MemoryQdrantStore,
  input: ExportInput
): Promise<string[]> {
  const uriTrim = typeof input.uri === 'string' ? input.uri.trim() : '';
  const hasUri = uriTrim.length > 0;
  const hasList = Boolean(input.adapters && input.adapters.length > 0);
  const hasAll = input.all_adapters === true;

  if (hasUri) {
    return [uriTrim];
  }
  if (hasList && input.adapters) {
    return input.adapters.map((a) => normalizeAdapterUri(a));
  }
  if (hasAll) {
    const ctx = getSpaceContextFromStorage();
    const sn = typeof input.space_name === 'string' ? input.space_name.trim() : '';
    const resolved = resolveSpaceParamForContext(ctx, sn, { allowReadOnlyAppSearchScope: true });
    if (!resolved.ok) {
      throw new Error(resolved.message);
    }
    const uris = await listAdapterUrisInSpace(memoryStore, resolved.spaceId);
    if (uris.length > EXPORT_MAX_ADAPTERS) {
      throw new Error(`Export would include ${uris.length} adapters; max is ${EXPORT_MAX_ADAPTERS}.`);
    }
    return uris;
  }
  throw new Error('No export selection resolved.');
}
