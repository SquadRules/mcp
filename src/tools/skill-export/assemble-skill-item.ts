/**
 * Build one SkillExportItem from resolved adapter markdown (normalized).
 */

import type { MemoryQdrantStore } from '../../services/memory/store.js';
import type { QdrantService } from '../../services/qdrant/service.js';
import { executeDump } from '../dump.js';
import { buildSkillMdFile } from './build-skill-md.js';
import { deriveSkillMetadata } from './derive-metadata.js';
import { sha256Hex } from './sha256.js';
import { scanMarkdownForDiagnostics } from './scan-diagnostics.js';
import type { SkillExportItem } from './types.js';

function toCurrentMarkdown(markdownDoc: string): string {
  return markdownDoc.replaceAll('"challenge":', '"contract":');
}

/** True when the value already carries a supported URI scheme (kairos:// or squadrules://). */
function hasKairosScheme(value: string): boolean {
  return /^(?:kairos|squadrules):\/\//i.test(value);
}

/** Canonicalize the alias scheme so all emitted URIs use kairos:// (stored form). */
function toCanonicalScheme(value: string): string {
  return value.replace(/^squadrules:\/\//i, 'kairos://');
}

export interface AssembleSkillItemParams {
  memoryStore: MemoryQdrantStore;
  qdrantService: QdrantService | undefined;
  /** Resolved first layer id for protocol dump. */
  layerId: string;
  /** Request URI echoed in output metadata. */
  requestUri: string;
  /** Adapter id for label lookup. */
  adapterId: string;
}

/**
 * Load protocol markdown via dump, normalize vocabulary, derive metadata, emit SKILL.md file list.
 */
export async function assembleSkillExportItem(params: AssembleSkillItemParams): Promise<SkillExportItem> {
  const dump = await executeDump(params.memoryStore, params.qdrantService, {
    uri: `kairos://layer/${params.layerId}`,
    protocol: true
  });
  const headMemory = await params.memoryStore.getMemory(params.layerId);
  const label = typeof dump['label'] === 'string' ? dump['label'] : 'Adapter';
  const adapterName = headMemory?.adapter?.name ?? null;
  const memorySlug =
    typeof headMemory?.slug === 'string' && headMemory.slug.trim().length > 0 ? headMemory.slug.trim() : null;

  const canonicalRequestUri = toCanonicalScheme(params.requestUri);
  const rawMd = toCurrentMarkdown(String(dump['content'] ?? ''));
  const meta = deriveSkillMetadata({
    protocolMarkdown: rawMd,
    label,
    memorySlug,
    adapterName,
    kairosUri: canonicalRequestUri
  });

  const adapterVersion = typeof dump['adapter_version'] === 'string' ? dump['adapter_version'] : null;
  const skillBody = buildSkillMdFile(meta, rawMd, adapterVersion);
  const skillPath = 'SKILL.md';
  const hash = sha256Hex(skillBody);

  const dumpUri = typeof dump['uri'] === 'string' ? dump['uri'] : '';
  const kairosUri = hasKairosScheme(dumpUri)
    ? toCanonicalScheme(dumpUri)
    : hasKairosScheme(canonicalRequestUri)
      ? canonicalRequestUri
      : `kairos://adapter/${params.adapterId}`;

  return {
    slug: meta.slug,
    name: meta.name,
    description: meta.description,
    kairosUri,
    adapterVersion,
    files: [
      {
        path: skillPath,
        content: skillBody,
        contentType: 'text/markdown',
        sha256: hash
      }
    ],
    diagnostics: scanMarkdownForDiagnostics(skillBody)
  };
}
