import { isDeepStrictEqual } from 'node:util';
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
  finalizeAdapterMutation,
  type AdapterMutationReport
} from '../services/graph-db/adapter-write-finalize.js';
import { structuredLogger } from '../utils/structured-logger.js';
import { TrainError } from './train-error.js';
import {
  assertInheritanceFrontmatterValid,
  assertTrainDescendantsValid,
  assertTrainExpectedVersion
} from './train-validation.js';

export { TrainError };

/** Fork export includes `slug:` in YAML; same author slug in target space collides — allocate fresh. */
export function markdownWithoutAuthorSlugForFork(markdown: string): string {
  const parsed = parseFrontmatter(markdown);
  if (parsed.slugRaw === undefined && !Object.hasOwn(parsed.nested, 'slug')) return markdown;

  // The authoritative parser has no serializer and its views omit raw list lines.
  // Serialize the unchanged declarations from their original bytes, removing only
  // top-level identity lines. This preserves arrays, nested data, quotes and body.
  const contentStart = markdown.length - markdown.trimStart().length + 3;
  const closingIndex = markdown.indexOf('\n---', contentStart);
  const declarations = markdown.slice(contentStart, closingIndex)
    .split(/(?<=\n)/)
    .filter((line) => !/^slug[ \t]*:/i.test(line))
    .join('');
  const rewritten = markdown.slice(0, contentStart) + declarations + markdown.slice(closingIndex);

  const expected = { ...parsed, fields: { ...parsed.fields }, nested: { ...parsed.nested } };
  delete expected.slugRaw;
  delete expected.fields['slug'];
  delete expected.nested['slug'];
  if (!isDeepStrictEqual(parseFrontmatter(rewritten), expected)) {
    throw new TrainError('INVALID_SLUG', 'Fork identity cannot be changed without altering other frontmatter declarations.', {
      must_obey: true,
      next_action: 'use a top-level scalar slug declaration, then retry the fork'
    });
  }
  return rewritten;
}

/**
 * Read back the head layer of the adapter that was just stored.
 *
 * The head is read from the store rather than from the value handed to
 * `storeAdapter`, so the derived pass describes what was actually persisted —
 * including the `space_id` the store returned, which is the only scope authority
 * here (never the request's or a guessed tenant).
 *
 * Projection is deliberately NOT done here. `finalizeAdapterMutation` owns the whole
 * derived pass — projection of the final stored scope, history, degradation report —
 * and having two places project is how the write routes drifted apart.
 */
async function readStoredAdapterHead(
  memoryStore: MemoryQdrantStore,
  storedMemoryUuid: string
): Promise<Memory | null> {
  try {
    const head = await memoryStore.getMemory(storedMemoryUuid, { fresh: true });
    if (!head) {
      structuredLogger.warn(`train: stored head not readable for ${storedMemoryUuid} — derived pass skipped`);
      return null;
    }
    return head;
  } catch (err) {
    structuredLogger.warn(
      `train: stored head read failed for ${storedMemoryUuid} — ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
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

  // Fail-closed inheritance structural validation (before memory write), against the
  // parent frontmatter that is actually stored.
  const inheritanceWarnings = await assertInheritanceFrontmatterValid(docForStore, memoryStore);

  // CAS: a restore or an evolution apply may name the version it read. Checked before
  // the write so a moved adapter is an actionable conflict, never a silent overwrite.
  await assertTrainExpectedVersion(docForStore, input.expected_version, memoryStore);

  // Parent side of the same policy (ADR 0046 §6): the prospective document must not
  // invalidate a stored descendant. Checked before the write, so a conflict leaves no
  // half-updated parent and no new history row.
  await assertTrainDescendantsValid(docForStore, memoryStore);

  const memories = await runStore(() =>
    memoryStore.storeAdapter([docForStore], input.llm_model_id, {
      forceUpdate: !!input.force_update,
      ...(input.protocol_version && { protocolVersion: input.protocol_version }),
      ...(input.fork_new_adapter && { forkNewAdapter: true })
    })
  );

  // One finalizer for every route. It projects the final stored scope and records the
  // snapshot of that state, and it never throws: a post-commit graph failure is a
  // degraded derived index, reported below, never a failed adapter write.
  const headUuid = memories[0]?.memory_uuid;
  let graph: AdapterMutationReport | null = null;
  if (headUuid) {
    const storedHead = await readStoredAdapterHead(memoryStore, headUuid);
    if (storedHead) {
      graph = await finalizeAdapterMutation({
        owner: memoryStore,
        source: memoryStore,
        head: storedHead,
        submittedMarkdown: docForStore,
        changeType: 'created',
        reason: 'train: adapter markdown stored'
      });
    }
  }

  // Degradation travels on the existing `warnings` channel: the write succeeded, so it
  // is not an error, but it must be visible rather than only logged.
  const warnings = [
    ...inheritanceWarnings.map((w) => ({ code: w.code, message: w.message })),
    ...(graph?.graph_degraded
      ? [{ code: 'GRAPH_DEGRADED', message: `graph bookkeeping incomplete: ${graph.degradations.join('; ')}` }]
      : [])
  ];

  return {
    items: memories.map((memory) => ({
      uri: buildLayerUri(memory.memory_uuid),
      layer_uuid: memory.memory_uuid,
      label: memory.label,
      tags: memory.tags,
      content_type: 'text/markdown'
    })),
    status: 'stored',
    ...(warnings.length > 0 && { warnings })
  };
}
