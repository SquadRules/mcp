// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import type { Memory } from '../types/memory.js';
import { getMetaDoc } from '../resources/embedded-mcp-resources.js';
import { parseFrontmatter } from '../utils/frontmatter.js';

/** Refine-help protocol; always appended as an **activate** footer choice (not a vector match). */
export const KAIROS_REFINING_PROTOCOL_SLUG = 'refine-search';

/** Built-in adapter authoring flow; always appended as an **activate** footer choice (not a vector match). */
export const KAIROS_CREATION_PROTOCOL_SLUG = 'create-new-protocol';

/** Set of built-in protocol slugs used for search filtering. */
export const BUILTIN_PROTOCOL_SLUGS = new Set([KAIROS_REFINING_PROTOCOL_SLUG, KAIROS_CREATION_PROTOCOL_SLUG]);

function getMetaDocTitle(slug: string, fallbackTitle: string): string {
  const doc = getMetaDoc(slug);
  if (!doc) return fallbackTitle;

  const parsed = parseFrontmatter(doc);
  if (parsed.title && parsed.title.trim().length > 0) {
    return parsed.title.trim();
  }

  const h1Match = parsed.body.match(/^#\s+(.+)$/m);
  if (h1Match && h1Match[1]) {
    return h1Match[1].trim();
  }

  return fallbackTitle;
}

/** Footer labels come from built-in meta docs, not hardcoded strings. */
export const KAIROS_REFINING_FOOTER_LABEL = getMetaDocTitle(
  KAIROS_REFINING_PROTOCOL_SLUG,
  'Get help refining your search'
);
export const KAIROS_CREATION_FOOTER_LABEL = getMetaDocTitle(
  KAIROS_CREATION_PROTOCOL_SLUG,
  'Create New SQUADRULES Protocol'
);
export const KAIROS_CREATION_FOOTER_NEXT_ACTION =
  'call train with adapter markdown to register a new adapter/protocol/workflow';

/** True if this memory belongs to built-in footer protocols (refine / create). */
export function memoryIsBuiltinSearchFooterProtocol(m: Memory): boolean {
  const slug = m.slug ?? '';
  return slug.length > 0 && BUILTIN_PROTOCOL_SLUGS.has(slug);
}
