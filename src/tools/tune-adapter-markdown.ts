/**
 * Tune: in-place adapter-markdown rewrite (ADR 0045/0046 write path).
 *
 * WHY SEPARATE
 * Rewriting an adapter's markdown is the only tune path that has to satisfy every
 * fail-closed gate before it writes a single layer: markdown size, H1/identity,
 * layer count, inherited-frontmatter structure, the descendant gate, and the
 * expected-version CAS. Keeping it in its own module means `executeTune` stays a
 * dispatcher, and the order of those gates is readable in one place instead of
 * buried between the space-move and plain-update branches.
 *
 * ORDER OF GATES (all before any write): CAS -> size -> identity/layer count ->
 * inheritance structure -> descendants. A failure at any step leaves the parent
 * byte-identical and appends no history row.
 *
 * AFTER THE WRITE
 * `verifyTuneLayerPersistence` confirms persisted layer text readback — layer existence
 * plus `text` equality only (see `tune-verify.ts`); it does not prove `inference_contract`,
 * frontmatter, tags or version. The stored records are then read back and handed to
 * `finalizeAdapterMutation`, the one derived pass every adapter write uses: it projects
 * the stored topology and appends the history snapshot. That pass is derived index work
 * and never fails the tune; it reports what it could not complete.
 *
 * CONCURRENCY
 * `expected_version` is compared against a head read a moment earlier, so on its own it
 * is a precheck, not a compare-and-swap: two writers interleaving between that read and
 * the write would both pass. The read → validate → persist → history window therefore
 * runs under a per-adapter lock (`adapter-write-lock.ts`).
 */
import type { QdrantService } from '../services/qdrant/service.js';
import { CodeBlockProcessor } from '../services/code-block-processor.js';
import { IDGenerator } from '../services/id-generator.js';
import { buildHeaderMemoryAdapter } from '../services/memory/adapter-builder.js';
import { parseFrontmatter } from '../utils/frontmatter.js';
import { buildLayerUri } from './squadrules-uri.js';
import { validateAdapterMarkdownSize } from '../services/memory/validate-adapter-markdown-size.js';
import { verifyTuneLayerPersistence } from './tune-verify.js';
import {
  validateInheritanceFrontmatter,
  parseOverrideList,
  type InheritanceFrontmatter,
  type StructuralWarning
} from '../services/graph-db/adapter-inheritance.js';
import { storedAdapterScope } from '../services/graph-db/adapter-scope.js';
import {
  finalizeAdapterMutation,
  type AdapterMutationReport
} from '../services/graph-db/adapter-write-finalize.js';
import { adapterIdentityLockKey, withAdapterWriteLock } from '../services/graph-db/adapter-write-lock.js';
import { adapterVersionOf, assertExpectedVersion } from './version-cas.js';
import { resolveStoredParentSnapshot } from '../services/graph-db/adapter-graph-records.js';
import {
  InheritanceValidationUnavailableError,
  inheritanceWriteStructureErrors
} from '../services/graph-db/inheritance-write-validation.js';
import { toStoredAdapterFrontmatter } from '../services/memory/stored-adapter-frontmatter.js';
import { assertDescendantsValid } from '../services/graph-db/descendant-validation.js';
import type { MemoryQdrantStore } from '../services/memory/store.js';
import type { Memory } from '../types/memory.js';
import { structuredLogger } from '../utils/structured-logger.js';
import {
  assertWritableTuneLayers,
  readAdapterRecordsByUuid,
  resolveAdapterIdFromWireUri,
  selectAdapterLayerSet
} from './tune-uri-resolution.js';

/**
 * Extract inheritance-relevant frontmatter from adapter markdown for tune.
 * Returns null when neither inheritance nor an override list needs validation.
 */
function extractInheritanceFrontmatterForTune(markdown: string): InheritanceFrontmatter | null {
  const parsed = parseFrontmatter(markdown);
  if (!parsed.inherits && !parsed.overrideRaw) return null;

  const fm: InheritanceFrontmatter = {};
  if (parsed.inherits) fm.inherits = parsed.inherits;
  if (parsed.slugRaw) fm.slug = parsed.slugRaw;
  if (parsed.version) fm.version = parsed.version;
  if (parsed.title) fm.title = parsed.title;
  if (parsed.chainRoot) fm.chain_root = parsed.chainRoot;
  if (parsed.overrideRaw) {
    fm.override = parseOverrideList(parsed.overrideRaw);
  }

  return fm;
}

/**
 * Validate inheritance frontmatter before the tune write (fail-closed).
 *
 * The parent is resolved from storage with the shared scope policy (own space first,
 * app space second) so the validator sees the frontmatter the graph edge will point
 * at. An unavailable store or scope cannot establish absence and fails the write.
 */
export async function assertTuneInheritanceValid(
  markdown: string,
  source: MemoryQdrantStore | undefined,
  spaceId: string
): Promise<StructuralWarning[]> {
  const fm = extractInheritanceFrontmatterForTune(markdown);
  if (!fm) return [];

  const localErrors = inheritanceWriteStructureErrors(fm);
  if (localErrors.length > 0) {
    const messages = localErrors.map((e) => `[${e.code}] ${e.message}`).join('; ');
    throw new Error(`Inheritance validation failed: ${messages}`);
  }
  // No unknown-field policy is imposed on an override list without inheritance.
  if (!fm.inherits) return [];
  if (!spaceId.trim()) {
    throw new InheritanceValidationUnavailableError('scope_unavailable', fm.inherits, spaceId);
  }
  if (!source) {
    throw new InheritanceValidationUnavailableError('source_unavailable', fm.inherits, spaceId);
  }
  const parent = await resolveStoredParentSnapshot(source, fm.inherits, spaceId);
  const result = validateInheritanceFrontmatter(fm, parent?.snapshot.frontmatter ?? null);

  if (result.errors.length > 0) {
    const messages = result.errors.map((e) => `[${e.code}] ${e.message}`).join('; ');
    throw new Error(`Inheritance validation failed: ${messages}`);
  }

  return result.warnings;
}

/**
 * What a markdown tune produced.
 *
 * `graph` is the post-write derived pass. It is returned, never thrown: by the time it
 * runs the layers are already persisted, so its failures are degradations of a derived
 * index. A caller surfaces `graph_degraded` in its own result instead of failing.
 */
export interface AdapterTuneOutcome {
  /** Layer URI of the tuned adapter head. */
  layerUri: string;
  /** Stored adapter the tune wrote — the identity the lock and history key off. */
  adapterId: string;
  /** Derived pass over the final stored state, or `null` when none could run. */
  graph: AdapterMutationReport | null;
}

export async function tuneAdapterMarkdownInPlace(
  qdrantService: QdrantService,
  adapterUri: string,
  markdownDoc: string,
  memoryStore?: MemoryQdrantStore,
  expectedVersion?: string
): Promise<AdapterTuneOutcome> {
  const { adapterId } = await resolveAdapterIdFromWireUri(qdrantService, adapterUri);
  // One critical section for the whole read → validate → persist → history window. The
  // version guard compares a head read inside it, so serializing here is what makes that
  // comparison mean something; without the lock it is only a precheck.
  return withAdapterWriteLock(adapterIdentityLockKey(adapterId), () =>
    tuneAdapterMarkdownLocked(
      qdrantService,
      adapterUri,
      adapterId,
      markdownDoc,
      memoryStore,
      expectedVersion
    )
  );
}

async function tuneAdapterMarkdownLocked(
  qdrantService: QdrantService,
  adapterUri: string,
  adapterId: string,
  markdownDoc: string,
  memoryStore: MemoryQdrantStore | undefined,
  expectedVersion: string | undefined
): Promise<AdapterTuneOutcome> {
  const existingLayers = selectAdapterLayerSet(await qdrantService.getAdapterLayers(adapterId));
  assertWritableTuneLayers(existingLayers);
  if (existingLayers.length === 0) {
    throw new Error(`Adapter not found: ${adapterUri}`);
  }

  // CAS before any validation/write: a stale base is an actionable conflict, not a
  // silent overwrite of a parent that evolved while this change was prepared.
  assertExpectedVersion(adapterUri, expectedVersion, adapterVersionOf(existingLayers[0]?.payload as Memory));

  const currentModel = existingLayers[0]?.payload?.llm_model_id;
  const llmModelId =
    typeof currentModel === 'string' && currentModel.trim().length > 0 ? currentModel.trim() : 'tune-in-place';

  const fullDocCheck = validateAdapterMarkdownSize(markdownDoc);
  if (!fullDocCheck.ok) {
    throw new Error(`${fullDocCheck.message} (${fullDocCheck.code})`);
  }

  const parsedDoc = parseFrontmatter(markdownDoc);
  const adapterMarkdown = parsedDoc.body.length > 0 ? parsedDoc.body : markdownDoc;
  const codeBlockProcessor = new CodeBlockProcessor();
  const nextLayers = buildHeaderMemoryAdapter(adapterMarkdown, llmModelId, new Date(), codeBlockProcessor);
  if (nextLayers.length === 0) {
    throw new Error('Invalid adapter markdown: expected H1 with at least one layer');
  }

  const nextAdapterName = nextLayers[0]?.adapter?.name?.trim() ?? '';
  if (!nextAdapterName) {
    throw new Error('Invalid adapter markdown: missing adapter title (H1)');
  }
  const expectedAdapterId = IDGenerator.generateAdapterUUIDv5(nextAdapterName);
  if (expectedAdapterId !== adapterId) {
    throw new Error(
      `Adapter title "${nextAdapterName}" resolves to ${expectedAdapterId}, but tune target is ${adapterId}. Keep the H1 unchanged when tuning by adapter URI.`
    );
  }

  if (nextLayers.length !== existingLayers.length) {
    throw new Error(
      `Layer count mismatch: adapter has ${existingLayers.length} layers, markdown has ${nextLayers.length}. Use train(force_update=true) for structural adapter changes.`
    );
  }

  const frontmatterVersion =
    typeof parsedDoc.version === 'string' && parsedDoc.version.trim().length > 0 ? parsedDoc.version.trim() : undefined;
  if (frontmatterVersion) {
    for (const memory of nextLayers) {
      if (memory.adapter) {
        memory.adapter.protocol_version = frontmatterVersion;
      }
    }
  }

  // Scope used for inheritance *validation* only: the space the layers are stored in,
  // which may differ from the tenant default for a tune that targets another allowed
  // space. Projection re-derives its scope from the stored head record instead.
  const existingSpaceId =
    typeof existingLayers[0]?.payload?.space_id === 'string' ? existingLayers[0].payload.space_id : '';
  const validationScope = storedAdapterScope(existingSpaceId, 'tune');

  // Fail-closed inheritance structural validation (before memory write)
  await assertTuneInheritanceValid(markdownDoc, memoryStore, validationScope.spaceId);

  // Parent side of the same policy (ADR 0046 §6): the prospective document must not
  // invalidate a stored descendant. Validated before any layer is written, so a
  // conflict leaves the parent byte-identical and appends no history row.
  const parentSlug = ((existingLayers[0]?.payload as Memory | undefined)?.slug ?? nextAdapterName).trim();
  await assertDescendantsValid({
    owner: qdrantService,
    source: memoryStore ?? null,
    parentSlug,
    spaceId: validationScope.spaceId,
    markdown: markdownDoc
  });

  // The tuned document's frontmatter, in the normalized subset the parser supports and the
  // converter persists (see `toStoredAdapterFrontmatter`): lowercased scalar and nested
  // declarations, not general lossless YAML. Removing `inherits:` must still remove it from
  // the record (not leave the previous value shadowing it), and an arbitrary author property
  // must survive so a child's `override:` of it is not a false
  // `override_unknown_field`. `null` means the document declares no frontmatter.
  const storedFrontmatter = toStoredAdapterFrontmatter(parsedDoc);

  for (let i = 0; i < existingLayers.length; i++) {
    const existing = existingLayers[i]!;
    const next = nextLayers[i]!;
    const existingAdapter =
      existing.payload?.adapter && typeof existing.payload.adapter === 'object'
        ? (existing.payload.adapter as Record<string, unknown>)
        : {};
    const nextAdapter = next.adapter;

    const adapterUpdate: Record<string, unknown> = {
      ...existingAdapter,
      id: adapterId,
      name: nextAdapter?.name ?? existingAdapter['name'],
      layer_index: i + 1,
      layer_count: nextLayers.length,
      activation_patterns: Array.isArray(nextAdapter?.activation_patterns) ? nextAdapter.activation_patterns : [],
      reward_signal: typeof nextAdapter?.reward_signal === 'string' ? nextAdapter.reward_signal : ''
    };
    if (typeof nextAdapter?.protocol_version === 'string' && nextAdapter.protocol_version.trim().length > 0) {
      adapterUpdate['protocol_version'] = nextAdapter.protocol_version.trim();
    }
    if (storedFrontmatter) {
      adapterUpdate['frontmatter'] = storedFrontmatter;
    } else {
      // Drop the previous record's frontmatter: `...existingAdapter` would otherwise
      // keep a removed `inherits:` alive for the graph and the merge.
      delete adapterUpdate['frontmatter'];
    }

    // A markdown content tune rewrites prose, label, tags and adapter metadata only. The
    // stored executable gate is deliberately NOT part of this payload: `updateMemory` merges
    // `{ ...existingPayload, ...safeUpdates }` (see `qdrant/memory-updates.ts`), so omitting
    // the key leaves the stored `inference_contract` untouched, while sending
    // `next.inference_contract ?? null` would let a prose edit replace the gate the markdown
    // merely echoes — or clear it outright. Intentional gate changes go through
    // train(force_update=true) alone.
    await qdrantService.updateMemory(existing.uuid, {
      label: next.label,
      text: next.text,
      tags: next.tags,
      adapter: adapterUpdate
    });
  }

  await verifyTuneLayerPersistence(qdrantService, existingLayers, nextLayers);

  // Derived pass over the state the store now holds. The records are read back rather
  // than reusing `nextLayers` because `updateMemory` merges: the stored head carries the
  // fields this module deliberately did not send (notably the preserved
  // `inference_contract`), and history must describe what a read will now return.
  const stored = await readAdapterRecordsByUuid(
    qdrantService,
    existingLayers.map((layer) => layer.uuid)
  );
  if (!stored) {
    structuredLogger.warn(
      `tune: stored layers unreadable after writing ${adapterUri} — the derived pass will report what it could not read`
    );
  }
  const graph = await finalizeAdapterMutation({
    owner: qdrantService,
    source: memoryStore ?? null,
    head: stored?.head ?? nextLayers[0]!,
    layers: stored?.layers ?? null,
    submittedMarkdown: markdownDoc,
    changeType: 'updated',
    reason: 'tune: adapter markdown updated'
  });

  return { layerUri: buildLayerUri(existingLayers[0]!.uuid), adapterId, graph };
}
