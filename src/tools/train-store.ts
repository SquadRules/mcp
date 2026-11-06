import type { MemoryQdrantStore } from '../services/memory/store.js';
import type { Memory } from '../types/memory.js';
import { parseFrontmatter } from '../utils/frontmatter.js';
import { validateProtocolStructure } from '../services/memory/validate-protocol-structure.js';
import {
  validateAdapterMarkdownSize,
  validateArtifactContentSize
} from '../services/memory/validate-adapter-markdown-size.js';
import type { TrainStoreInput, TrainStoreOutput } from './train_schema.js';
import { buildAdapterUri, buildLayerUri } from './squadrules-uri.js';
import { SQUADRULES_CREATION_PROTOCOL_SLUG } from '../constants/builtin-search-meta.js';
import {
  ALLOWED_ARTIFACT_MIMES,
  inferArtifactMimeFromName,
  isAllowedArtifactMime,
  normalizeArtifactMime
} from './artifact-mime.js';
import {
  validateInheritanceFrontmatter,
  parseOverrideList,
  type InheritanceFrontmatter,
  type StructuralWarning
} from '../services/graph-db/adapter-inheritance.js';
import { getGraphDbService } from '../services/graph-db/graph-db-singleton.js';
import { structuredLogger } from '../utils/structured-logger.js';

/** Fork export includes `slug:` in YAML; same author slug in target space collides — allocate fresh. */
function markdownWithoutAuthorSlugForFork(markdown: string): string {
  const p = parseFrontmatter(markdown);
  if (p.slugRaw === undefined) return markdown;
  const lines: string[] = [];
  if (p.version) lines.push(`version: ${p.version}`);
  if (p.title) lines.push(`title: ${p.title}`);
  if (p.chainRoot) lines.push(`chain_root: ${p.chainRoot}`);
  const fm = lines.length > 0 ? `---\n${lines.join('\n')}\n---\n\n` : '';
  return `${fm}${p.body}`;
}

/** Thrown by executeTrainStore on validation or store errors. */
export class TrainError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'TrainError';
  }
}

/**
 * Extract inheritance-relevant frontmatter fields from raw adapter markdown.
 * Returns null when no `inherits:` field is present (no inheritance to validate).
 */
function extractInheritanceFrontmatter(markdown: string): InheritanceFrontmatter | null {
  const parsed = parseFrontmatter(markdown);
  if (!parsed.inherits) return null;

  const fm: InheritanceFrontmatter = {
    inherits: parsed.inherits,
  };
  if (parsed.slugRaw) fm.slug = parsed.slugRaw;
  if (parsed.version) fm.version = parsed.version;
  if (parsed.title) fm.title = parsed.title;
  if (parsed.chainRoot) fm.chain_root = parsed.chainRoot;

  // Parse override list from raw frontmatter value
  if (parsed.overrideRaw) {
    fm.override = parseOverrideList(parsed.overrideRaw);
  }

  return fm;
}

/**
 * Validate inheritance frontmatter before the memory write (fail-closed).
 * Returns warnings to include in the tool response, or throws TrainError on
 * structural validation errors.
 */
function assertInheritanceFrontmatterValid(markdown: string): StructuralWarning[] {
  const fm = extractInheritanceFrontmatter(markdown);
  if (!fm) return [];

  // Attempt to resolve parent frontmatter from graph DB (best-effort)
  let parentFrontmatter: InheritanceFrontmatter | null = null;
  const graphDb = getGraphDbService();
  if (graphDb && graphDb.isInitialized() && fm.inherits) {
    // Synchronous check not possible; we pass null and let the validator emit
    // parent_missing as a warning. The graph write will create edges if the
    // parent is present.
    parentFrontmatter = null;
  }

  const result = validateInheritanceFrontmatter(fm, parentFrontmatter);

  if (result.errors.length > 0) {
    const messages = result.errors.map((e) => `[${e.code}] ${e.message}`).join('; ');
    throw new TrainError('INHERITANCE_STRUCTURE_INVALID', messages, {
      must_obey: true,
      items: result.errors
    });
  }

  return result.warnings;
}

/**
 * Attempt graph DB write after successful memory store. Graceful degradation:
 * failures are logged but never propagated.
 */
async function tryGraphWrite(markdown: string): Promise<void> {
  const graphDb = getGraphDbService();
  if (!graphDb || !graphDb.isInitialized()) return;

  const parsed = parseFrontmatter(markdown);
  const slug = parsed.slugRaw?.trim();
  if (!slug) return;

  const fm: InheritanceFrontmatter = extractInheritanceFrontmatter(markdown) ?? {
    slug,
    ...(parsed.version && { version: parsed.version }),
  };

  try {
    await graphDb.writeAdapterFromFrontmatter(
      slug,
      parsed.version || '0.0.0',
      fm,
      {
        title: parsed.title || slug,
      }
    );
  } catch (err) {
    structuredLogger.warn(
      `graph db: writeAdapterFromFrontmatter failed for "${slug}" — ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Low-level train step: validate protocol structure and persist adapter markdown.
 * Used by MCP **`train`** and HTTP routes after optional fork resolution.
 */
export async function executeTrainStore(
  memoryStore: MemoryQdrantStore,
  input: TrainStoreInput,
  runStore: (fn: () => Promise<Memory[]>) => Promise<Memory[]>
): Promise<TrainStoreOutput> {
  const explicitMime = input.mime?.trim();
  const inferredMime =
    (!explicitMime || explicitMime.length === 0) &&
    typeof input.artifact_name === 'string' &&
    input.artifact_name.trim().length > 0 &&
    typeof input.adapter_uri === 'string' &&
    input.adapter_uri.trim().length > 0
      ? inferArtifactMimeFromName(input.artifact_name.trim())
      : null;
  const effectiveMime = explicitMime && explicitMime.length > 0 ? explicitMime : inferredMime ?? undefined;
  const normalizedMime = typeof effectiveMime === 'string' ? normalizeArtifactMime(effectiveMime) : undefined;
  const isArtifact = !!normalizedMime && normalizedMime !== 'text/markdown';
  if (isArtifact) {
    if (!normalizedMime || !isAllowedArtifactMime(normalizedMime)) {
      throw new TrainError('UNSUPPORTED_MIME', `Mime type "${effectiveMime ?? ''}" is not in the allowlist`, {
        allowed: [...ALLOWED_ARTIFACT_MIMES]
      });
    }
    const artifactSize = validateArtifactContentSize(input.content);
    if (!artifactSize.ok) {
      throw new TrainError(artifactSize.code, artifactSize.message, artifactSize.details);
    }
    const memories = await runStore(() =>
      memoryStore.storeArtifact(input.content, {
        mime: normalizedMime,
        name: input.artifact_name!,
        adapterUri: input.adapter_uri!,
        llmModelId: input.llm_model_id,
        forceUpdate: !!input.force_update,
        ...(typeof input.relative_path === 'string' &&
          input.relative_path.trim().length > 0 && {
            relativePath: input.relative_path.trim()
          })
      })
    );
    return {
      items: memories.map((memory) => ({
        uri: `squadrules://artifact/${memory.memory_uuid}`,
        artifact_uuid: memory.memory_uuid,
        adapter_uri: input.adapter_uri!,
        label: memory.label,
        tags: memory.tags,
        content_type: normalizedMime
      })),
      status: 'stored'
    };
  }

  const docForStore = input.fork_new_adapter ? markdownWithoutAuthorSlugForFork(input.content) : input.content;
  const sizeCheck = validateAdapterMarkdownSize(docForStore);
  if (!sizeCheck.ok) {
    throw new TrainError(sizeCheck.code, sizeCheck.message, sizeCheck.details);
  }
  const validation = validateProtocolStructure(docForStore);
  if (!validation.valid) {
    throw new TrainError('PROTOCOL_STRUCTURE_INVALID', validation.message, {
      missing: validation.missing,
      must_obey: true,
      next_action: `call forward with ${buildAdapterUri(SQUADRULES_CREATION_PROTOCOL_SLUG)} for guided adapter creation`
    });
  }

  // Fail-closed inheritance structural validation (before memory write)
  const inheritanceWarnings = assertInheritanceFrontmatterValid(docForStore);

  const memories = await runStore(() =>
    memoryStore.storeAdapter([docForStore], input.llm_model_id, {
      forceUpdate: !!input.force_update,
      ...(input.protocol_version && { protocolVersion: input.protocol_version }),
      ...(input.fork_new_adapter && { forkNewAdapter: true })
    })
  );

  // Graceful-degradation graph write (after successful memory store)
  await tryGraphWrite(docForStore);

  return {
    items: memories.map((memory) => ({
      uri: buildLayerUri(memory.memory_uuid),
      layer_uuid: memory.memory_uuid,
      label: memory.label,
      tags: memory.tags,
      content_type: 'text/markdown'
    })),
    status: 'stored',
    ...(inheritanceWarnings.length > 0 && {
      warnings: inheritanceWarnings.map((w) => ({ code: w.code, message: w.message }))
    })
  };
}
