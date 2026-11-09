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
import { getGraphDb } from '../services/graph-db/graph-owner.js';
import {
  projectAdapterLineage,
  syncAdapterGraph
} from '../services/graph-db/adapter-graph-sync.js';
import { recordAdapterEvolution } from '../services/graph-db/adapter-evolution-hooks.js';
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
 * Project one just-written adapter **and its stored ancestry** into the graph owned by
 * `memoryStore`.
 *
 * Every successful markdown train lands here, whether or not the adapter declares
 * `inherits`: a plain adapter is a node too, and a node is what makes it immediately
 * discoverable to a child trained next. The head layer is read back so the projection
 * uses what was actually persisted — including the `space_id` the store returned,
 * which is the only scope authority here (never the request's or a guessed tenant).
 *
 * The ancestry walk in `projectAdapterLineage` returns root-first snapshots, so a
 * parent stored before this train is written before the child edge is reconciled.
 * Graceful degradation: no graph, no read, or a graph write error never fails the train,
 * and edge failures are reported by `syncAdapterGraph` rather than escaping.
 */
async function projectStoredAdapterLineage(
  memoryStore: MemoryQdrantStore,
  storedMemoryUuid: string,
  context: string
): Promise<Memory | null> {
  const graphDb = getGraphDb(memoryStore);
  if (!graphDb) return null;

  try {
    const head = await memoryStore.getMemory(storedMemoryUuid, { fresh: true });
    if (!head) {
      structuredLogger.warn(`train: graph projection skipped for ${storedMemoryUuid} — stored head not readable`);
      return null;
    }
    const lineage = await projectAdapterLineage(graphDb, memoryStore, head, context);
    if (lineage.length === 0) {
      structuredLogger.warn(`train: graph projection skipped for ${storedMemoryUuid} — no adapter snapshot`);
      return null;
    }
    const report = await syncAdapterGraph(graphDb, lineage);
    if (report.missing_parents.length > 0) {
      structuredLogger.warn(
        `train: graph edge skipped (${report.missing_parents.join(', ')}) — parent record not stored in this scope or the app space`
      );
    }
    if (report.failed.length > 0 || report.edge_failures.length > 0) {
      structuredLogger.warn(
        `train: graph projection incomplete — failed nodes: [${report.failed.join(', ')}], failed edges: [${report.edge_failures.join(', ')}]`
      );
    }
    return head;
  } catch (err) {
    structuredLogger.warn(
      `train: graph projection failed for ${storedMemoryUuid} — ${err instanceof Error ? err.message : String(err)}`
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

  // Graph projection is a derived index written only for memories that landed. It runs
  // for every markdown train, plain or inheriting, and takes its scope from the stored head.
  const headUuid = memories[0]?.memory_uuid;
  if (headUuid) {
    const projectedHead = await projectStoredAdapterLineage(memoryStore, headUuid, 'train');
    if (projectedHead) {
      await recordAdapterEvolution({
        owner: memoryStore,
        head: projectedHead,
        markdown: docForStore,
        source: memoryStore,
        changeType: 'created',
        reason: 'train: adapter markdown stored'
      });
    }
  }

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
