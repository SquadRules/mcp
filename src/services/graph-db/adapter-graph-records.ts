/**
 * Record → snapshot conversion and scoped lookups — services layer.
 *
 * WHY HERE
 * The graph is a *derived projection* of adapter records: the vector store owns the
 * content, the graph owns the inheritance topology. This module is the read-only half
 * of that projection — it turns stored `LayerRecord`s into `StoredAdapterSnapshot`s and
 * finds one adapter's records in one exact space — so `adapter-graph-sync.ts` stays
 * about writing nodes and edges.
 *
 * WHAT IT READS
 * Snapshots are built from **stored layer records**, not from bundled markdown: a
 * record exists only when the write succeeded, so a failed write can never leave a
 * node (or an edge) behind. Boot reconciliation reads the store (`scrollSpace`) and
 * backfills adapters that were version-skipped, which is what makes a lost or empty
 * graph recoverable without rewriting memory content.
 *
 * SCOPE
 * A snapshot carries the space id the record was stored in (`storedAdapterScope`).
 * Parent lookup tries the child's own scope first and the app space second, only via
 * `parentScopeCandidates` — the single policy every caller shares. The graph never
 * guesses `personal`.
 */
import type { Memory } from '../../types/memory.js';
import type { LayerRecord } from '../vector-store/types.js';
import type { InheritanceFrontmatter } from './adapter-inheritance.js';
import type { AdapterGraphScope } from './adapter-scope.js';
import { parentScopeCandidates, storedAdapterScope } from './adapter-scope.js';
import { InheritanceValidationUnavailableError } from './inheritance-write-validation.js';

/**
 * A store surface that can enumerate one space's layer records. Both backends
 * (`MemoryQdrantStore` and the embedded Lance record store) implement it.
 */
export interface AdapterRecordSource {
  scrollSpace(
    spaceId: string,
    options?: { paginate?: boolean; limit?: number }
  ): Promise<LayerRecord[]>;
}

/** One adapter, as it exists in the store, ready to project into the graph. */
export interface StoredAdapterSnapshot {
  slug: string;
  version: string;
  /** Space the record was stored in, plus how that scope was derived. */
  scope: AdapterGraphScope;
  frontmatter: InheritanceFrontmatter;
  title?: string;
  layerCount?: number;
}

/**
 * Inheritance frontmatter persisted on the stored head layer.
 *
 * Every field is copied, not just the fixed topology names: an author-declared
 * domain property must reach the graph/merge so `override:` can name it. The
 * `override` list is normalised because a backend may hand it back as a JSON array
 * or as the raw authoring string.
 */
export function inheritanceFromStoredRecord(head: Memory): InheritanceFrontmatter {
  const stored = head.adapter?.frontmatter;
  const frontmatter: InheritanceFrontmatter = {};
  if (!stored) return frontmatter;

  for (const [key, value] of Object.entries(stored)) {
    if (value === undefined || value === null) continue;
    frontmatter[key] = value;
  }
  const rawOverride: unknown = stored['override'];
  if (typeof rawOverride === 'string') {
    frontmatter.override = rawOverride
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((field: string) => field.trim().replace(/^['"]|['"]$/g, ''))
      .filter((field: string) => field.length > 0);
  }
  return frontmatter;
}

/** True for records that carry adapter layers (artifacts and plain memories are skipped). */
function isAdapterLayerRecord(record: LayerRecord): boolean {
  const payload = record.payload as Memory | undefined;
  if (!payload) return false;
  const contentType = payload.content_type;
  if (typeof contentType === 'string' && contentType.length > 0 && contentType !== 'text/markdown') {
    return false;
  }
  return Boolean(payload.slug || payload.adapter?.name);
}

/** Head layer of one adapter: `layer_index === 1`, else the first layer seen. */
function pickHeadLayer(layers: Memory[]): Memory | null {
  if (layers.length === 0) return null;
  const head = layers.find((layer) => (layer.adapter?.layer_index ?? 1) === 1);
  return head ?? layers[0] ?? null;
}

/**
 * Build a snapshot from the layers of one adapter.
 *
 * @param layers  - every layer record of a single adapter (any order)
 * @param context - log label describing who is projecting (e.g. `boot:app-space`)
 */
export function snapshotFromLayers(
  layers: Memory[],
  context: string,
  scope?: AdapterGraphScope
): StoredAdapterSnapshot | null {
  const head = pickHeadLayer(layers);
  if (!head) return null;
  return snapshotFromStoredMemory(head, scope ?? storedAdapterScope(head.space_id, context));
}

/**
 * Build a snapshot from the stored head layer of one adapter, with the scope the
 * caller already resolved (a write knows its tenant scope; a read knows the record's
 * `space_id`).
 */
export function snapshotFromStoredMemory(
  head: Memory,
  scope: AdapterGraphScope
): StoredAdapterSnapshot | null {
  const slug = (head.slug ?? head.adapter?.name ?? '').trim();
  if (!slug) return null;

  const frontmatter = inheritanceFromStoredRecord(head);
  const version =
    head.adapter?.protocol_version?.trim() ||
    (typeof frontmatter.version === 'string' ? frontmatter.version.trim() : '') ||
    '0.0.0';

  const snapshot: StoredAdapterSnapshot = {
    slug,
    version,
    scope,
    frontmatter: { ...frontmatter, slug, version }
  };
  if (head.adapter?.name) snapshot.title = head.adapter.name;
  if (typeof head.adapter?.layer_count === 'number') snapshot.layerCount = head.adapter.layer_count;
  return snapshot;
}

/** Group layer records by adapter, preserving first-seen order. */
export function groupRecordsByAdapter(records: LayerRecord[]): Memory[][] {
  const groups = new Map<string, Memory[]>();
  for (const record of records) {
    if (!isAdapterLayerRecord(record)) continue;
    const payload = record.payload as Memory;
    const key = payload.adapter?.id ?? payload.slug ?? record.uuid;
    const bucket = groups.get(key);
    if (bucket) bucket.push(payload);
    else groups.set(key, [payload]);
  }
  return [...groups.values()];
}

/** Snapshots for every adapter present in one space's records. */
export function snapshotsFromRecords(
  records: LayerRecord[],
  context: string
): StoredAdapterSnapshot[] {
  const snapshots: StoredAdapterSnapshot[] = [];
  for (const layers of groupRecordsByAdapter(records)) {
    const snapshot = snapshotFromLayers(layers, context);
    if (snapshot) snapshots.push(snapshot);
  }
  return snapshots;
}

/** Only a successful complete read can establish absence; never fall back after a failed read. */
async function readAdapterRecords(
  source: AdapterRecordSource,
  slug: string,
  spaceId: string
): Promise<LayerRecord[]> {
  if (!spaceId.trim()) {
    throw new InheritanceValidationUnavailableError('scope_unavailable', slug, spaceId);
  }
  if (!source || typeof source.scrollSpace !== 'function') {
    throw new InheritanceValidationUnavailableError('source_unavailable', slug, spaceId);
  }
  try {
    const records = await source.scrollSpace(spaceId, { paginate: true });
    if (!Array.isArray(records)) throw new Error('adapter record enumeration did not return an array');
    return records;
  } catch (err) {
    throw new InheritanceValidationUnavailableError('read_unavailable', slug, spaceId, err);
  }
}

/**
 * Look up one adapter's stored snapshot in one exact space.
 *
 * Used by `train`/`tune` to validate a child against the parent frontmatter that is
 * actually stored — the same record the graph edge will later point at — instead of
 * validating against `null` and degrading to a `parent_missing` warning.
 */
export async function resolveStoredAdapterSnapshot(
  source: AdapterRecordSource,
  slug: string,
  spaceId: string
): Promise<StoredAdapterSnapshot | null> {
  const wanted = slug.trim();
  if (!wanted) return null;
  const records = await readAdapterRecords(source, wanted, spaceId);
  const layers = groupRecordsByAdapter(records).find((group) => {
    const head = pickHeadLayer(group);
    return (head?.slug ?? head?.adapter?.name ?? '').trim() === wanted;
  });
  return layers ? snapshotFromLayers(layers, `parent:${spaceId}`) : null;
}

/**
 * Every stored layer record of one adapter, from one exact space.
 *
 * `resolveStoredAdapterSnapshot` answers "what does this adapter declare?" from its head
 * layer; effective-content resolution instead needs every layer body, because a child
 * layer inherits from the ancestor layer with the same `layer_index`. Returns `null`
 * when the adapter has no stored record in that space.
 */
export async function resolveStoredAdapterLayers(
  source: AdapterRecordSource,
  slug: string,
  spaceId: string
): Promise<Memory[] | null> {
  const wanted = slug.trim();
  if (!wanted) return null;
  const records = await readAdapterRecords(source, wanted, spaceId);
  for (const group of groupRecordsByAdapter(records)) {
    const head = pickHeadLayer(group);
    if (!head) continue;
    const groupSlug = (head.slug ?? head.adapter?.name ?? '').trim();
    if (groupSlug === wanted) return group;
  }
  return null;
}

/**
 * Resolve a parent adapter's stored snapshot using the shared scope policy
 * (child's scope first, then the app space). Returns `null` when it is stored in
 * neither after successful reads. Unavailable reads throw; app fallback is not attempted.
 */
export async function resolveStoredParentSnapshot(
  source: AdapterRecordSource,
  parentSlug: string,
  childSpaceId: string
): Promise<{ snapshot: StoredAdapterSnapshot; spaceId: string } | null> {
  if (!childSpaceId.trim()) {
    throw new InheritanceValidationUnavailableError('scope_unavailable', parentSlug, childSpaceId);
  }
  for (const candidate of parentScopeCandidates(childSpaceId)) {
    const snapshot = await resolveStoredAdapterSnapshot(source, parentSlug, candidate);
    if (snapshot) return { snapshot, spaceId: candidate };
  }
  return null;
}
