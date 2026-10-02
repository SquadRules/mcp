// squadrules-compat-surface: imports/references a retained prior-brand-named module or path (source filenames are an explicit non-goal)
import { normalizeAuthorSlug } from '../utils/protocol-slug.js';
import { buildAdapterUri, parseSquadrulesUri } from './kairos-uri.js';

export function resolveTrainOutputAdapterUri(args: {
  memorySlug: string | undefined;
  memoryAdapterName: string | undefined;
  itemAdapterUri: string | undefined;
  inputAdapterUri: string | undefined;
  adapterId: string | undefined;
}): string | undefined {
  const fromMemory = typeof args.memorySlug === 'string' && args.memorySlug.trim().length > 0
    ? args.memorySlug.trim()
    : undefined;
  const parseSlug = (value?: string): string | undefined => {
    if (typeof value !== 'string' || value.trim().length === 0) return undefined;
    try {
      const parsed = parseSquadrulesUri(value.trim());
      return parsed.kind === 'adapter' && parsed.idKind === 'slug' ? parsed.id : undefined;
    } catch {
      return undefined;
    }
  };
  const slug =
    fromMemory ??
    parseSlug(args.itemAdapterUri) ??
    parseSlug(args.inputAdapterUri) ??
    normalizeAuthorSlug(args.memoryAdapterName ?? '') ??
    undefined;
  if (slug) return buildAdapterUri(slug);
  if (typeof args.adapterId === 'string' && args.adapterId.length > 0) return buildAdapterUri(args.adapterId);
  return undefined;
}
