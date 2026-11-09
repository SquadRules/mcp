/**
 * Tune URI resolution (wire URI → adapter id → the layer set a tune will write).
 *
 * WHY SEPARATE
 * Three different tune paths need the same answer to "which stored layers does this
 * URI name, and may they be written?": the in-place markdown rewrite, the plain
 * `updates` path, and the space-reassignment path. Keeping the resolution here means
 * the write-permission check (`assertWritableTuneLayers`) cannot be skipped by one
 * path remembering it and another forgetting it.
 */
import type { QdrantService } from '../services/qdrant/service.js';
import type { Memory } from '../types/memory.js';
import { getSpaceContextFromStorage } from '../utils/tenant-context.js';
import { assertWireAdapterUri, parseSquadrulesUri, buildLayerUri } from './squadrules-uri.js';
import { isProtectedWriteSpace, protectedWriteErrorMessage } from '../utils/protected-space-write-guard.js';
import {
  adapterVersionOf,
  assertExpectedVersion,
  VersionGuardUnsupportedError
} from './version-cas.js';

export type AdapterLayerPoint = { uuid: string; payload: any };

function sortByLayerIndex(layers: AdapterLayerPoint[]): AdapterLayerPoint[] {
  return [...layers].sort((left, right) => {
    const li =
      typeof left.payload?.adapter?.layer_index === 'number'
        ? left.payload.adapter.layer_index
        : Number.MAX_SAFE_INTEGER;
    const ri =
      typeof right.payload?.adapter?.layer_index === 'number'
        ? right.payload.adapter.layer_index
        : Number.MAX_SAFE_INTEGER;
    return li - ri;
  });
}

export function selectAdapterLayerSet(layers: AdapterLayerPoint[], preferredSpaceId?: string): AdapterLayerPoint[] {
  if (layers.length <= 1) {
    return sortByLayerIndex(layers);
  }

  const groupedBySpace = new Map<string, AdapterLayerPoint[]>();
  for (const layer of layers) {
    const sid = typeof layer.payload?.space_id === 'string' ? layer.payload.space_id.trim() : '';
    const key = sid.length > 0 ? sid : '__unknown__';
    groupedBySpace.set(key, [...(groupedBySpace.get(key) ?? []), layer]);
  }

  if (groupedBySpace.size <= 1) {
    return sortByLayerIndex(layers);
  }

  const ctx = getSpaceContextFromStorage();
  const candidateSpaceIds = [preferredSpaceId, ctx.defaultWriteSpaceId].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  );
  for (const candidate of candidateSpaceIds) {
    const selected = groupedBySpace.get(candidate.trim());
    if (selected && selected.length > 0) {
      return sortByLayerIndex(selected);
    }
  }

  const fallbackSpaceId = [...groupedBySpace.keys()].sort((a, b) => a.localeCompare(b))[0];
  return sortByLayerIndex(groupedBySpace.get(fallbackSpaceId!) ?? layers);
}

export function assertWritableTuneLayers(layers: AdapterLayerPoint[]): void {
  for (const layer of layers) {
    const spaceId = typeof layer.payload?.space_id === 'string' ? layer.payload.space_id : '';
    if (isProtectedWriteSpace(spaceId)) {
      throw new Error(protectedWriteErrorMessage(spaceId));
    }
  }
}

/** Why a layer URI has no adapter version a guard could compare against. */
export type LayerGuardUnresolved = 'layer_not_found' | 'adapter_unresolved' | 'adapter_head_missing';

/** A stored layer plus the adapter head whose version governs it. */
export interface LayerAdapterAssociation {
  adapterId: string;
  head: AdapterLayerPoint;
  /** The adapter's layers in the target layer's own space, head first. */
  layers: AdapterLayerPoint[];
}

const UNSUPPORTED_GUARD_REASON: Record<LayerGuardUnresolved, string> = {
  layer_not_found: 'no stored layer exists at this URI',
  adapter_unresolved:
    'the stored row is not one of a resolvable adapter\u2019s stored layers, so there is no adapter version to compare',
  adapter_head_missing: 'the adapter head record is not readable, so there is no version to compare'
};

function unsupportedGuardMessage(
  target: string,
  expected: string,
  reason: LayerGuardUnresolved
): string {
  return (
    `VERSION_GUARD_UNSUPPORTED: expected_version ${expected} cannot be checked for ${target} \u2014 ` +
    `${UNSUPPORTED_GUARD_REASON[reason]}. Nothing was written: pass an adapter URI that resolves ` +
    'to a stored head, or omit expected_version to write without the guard.'
  );
}

/**
 * Prove that a layer URI addresses a stored member of one adapter, in that layer's space.
 *
 * The association is proven from the store, not from a payload field alone: the adapter's
 * own layer listing must enumerate this exact uuid **in the layer's own space**, and the
 * head must be the `layer_index === 1` row stored in that same space. A same-id adapter
 * copied into another space cannot lend its head version, and a stranded layer whose head
 * moved to another space has no comparable version at all. Both cases return no
 * association, so the caller fails closed with `VERSION_GUARD_UNSUPPORTED` instead of
 * guarding the write against a version the caller never saw.
 */
export async function resolveLayerAdapterAssociation(
  qdrantService: QdrantService,
  layerUuid: string
): Promise<{ association: LayerAdapterAssociation | null; reason: LayerGuardUnresolved | null }> {
  const layer = (await qdrantService.getMemoryByUUID(layerUuid)) as Memory | null;
  if (!layer) return { association: null, reason: 'layer_not_found' };

  const adapterId = typeof layer.adapter?.id === 'string' ? layer.adapter.id.trim() : '';
  if (adapterId.length === 0) return { association: null, reason: 'adapter_unresolved' };

  // A row with no stored space cannot be tied to a head "in the same space", so it fails
  // closed rather than being compared against whatever the cross-space listing returns.
  const layerSpaceId = typeof layer.space_id === 'string' ? layer.space_id.trim() : '';
  if (layerSpaceId.length === 0) return { association: null, reason: 'adapter_unresolved' };

  // Same space only — never the cross-space enumeration. A foreign head would let a copy
  // of this adapter id in another space decide whether this layer's write is protected.
  const sameSpace = sortByLayerIndex(await qdrantService.getAdapterLayers(adapterId)).filter(
    (row) => (typeof row.payload?.space_id === 'string' ? row.payload.space_id : '') === layerSpaceId
  );
  if (!sameSpace.some((row) => row.uuid === layerUuid)) {
    return { association: null, reason: 'adapter_unresolved' };
  }

  // `layer_index === 1` is the head, never "whichever row sorts first": a tail whose head
  // lives in another space has no version a caller could have compared against.
  const head = sameSpace.find((row) => row.payload?.adapter?.layer_index === 1);
  if (!head) return { association: null, reason: 'adapter_head_missing' };
  return { association: { adapterId, head, layers: sameSpace }, reason: null };
}

/**
 * Enforce `expected_version` on a tune path that writes stored layers directly.
 *
 * Adapter URIs compare against the selected adapter head. A layer URI is guarded only when
 * the store proves the layer belongs to a stored adapter; otherwise the request fails with
 * `VERSION_GUARD_UNSUPPORTED` instead of writing unguarded. Absent `expected_version` is a
 * no-op, which keeps an ordinary tune unchanged.
 */
export async function assertTuneExpectedVersionForTarget(
  qdrantService: QdrantService,
  uri: string,
  expectedVersion: string | undefined
): Promise<void> {
  const wanted = typeof expectedVersion === 'string' ? expectedVersion.trim() : '';
  if (wanted.length === 0) return;

  const parsed = parseSquadrulesUri(uri);
  if (parsed.kind === 'layer') {
    const target = buildLayerUri(parsed.id, parsed.executionId);
    const { association, reason } = await resolveLayerAdapterAssociation(qdrantService, parsed.id);
    if (!association) {
      const unresolved = reason ?? 'adapter_unresolved';
      throw new VersionGuardUnsupportedError(unsupportedGuardMessage(target, wanted, unresolved), {
        target,
        expected: wanted,
        reason: unresolved
      });
    }
    assertExpectedVersion(target, wanted, adapterVersionOf(association.head.payload as Memory));
    return;
  }

  const { adapterId } = await resolveAdapterIdFromWireUri(qdrantService, uri);
  const head = selectAdapterLayerSet(await qdrantService.getAdapterLayers(adapterId))[0];
  if (!head) {
    throw new VersionGuardUnsupportedError(unsupportedGuardMessage(uri, wanted, 'adapter_head_missing'), {
      target: uri,
      expected: wanted,
      reason: 'adapter_head_missing'
    });
  }
  assertExpectedVersion(uri, wanted, adapterVersionOf(head.payload as Memory));
}

export async function resolveAdapterIdFromWireUri(
  qdrantService: QdrantService,
  uri: string
): Promise<{ adapterId: string; canonicalAdapterUri: string }> {
  const canonicalAdapterUri = assertWireAdapterUri(uri);
  const parsed = parseSquadrulesUri(canonicalAdapterUri);
  const slugOutcome = await qdrantService.findFirstStepMemoryUuidBySlug(parsed.id);
  if (!slugOutcome.layerUuid) throw new Error(`Adapter not found: ${canonicalAdapterUri}`);
  const firstLayer = await qdrantService.getMemoryByUUID(slugOutcome.layerUuid);
  const adapterId =
    typeof firstLayer?.adapter?.id === 'string' && firstLayer.adapter.id.trim().length > 0
      ? firstLayer.adapter.id
      : slugOutcome.layerUuid;
  return { adapterId, canonicalAdapterUri };
}

export async function normalizeTuneUri(
  qdrantService: QdrantService,
  uri: string,
  preferredSpaceId?: string
): Promise<string> {
  const parsed = parseSquadrulesUri(uri);
  if (parsed.kind === 'layer') {
    return buildLayerUri(parsed.id, parsed.executionId);
  }

  const { adapterId } = await resolveAdapterIdFromWireUri(qdrantService, uri);
  const layers = selectAdapterLayerSet(await qdrantService.getAdapterLayers(adapterId), preferredSpaceId);
  assertWritableTuneLayers(layers);
  const head = layers[0]?.uuid ?? adapterId;
  return buildLayerUri(head);
}

export async function collectLayerMemoryUuidsForTune(
  qdrantService: QdrantService,
  uri: string,
  preferredSpaceId?: string
): Promise<string[]> {
  const parsed = parseSquadrulesUri(uri);
  if (parsed.kind === 'layer') {
    return [parsed.id];
  }
  const { adapterId } = await resolveAdapterIdFromWireUri(qdrantService, uri);
  const layers = selectAdapterLayerSet(await qdrantService.getAdapterLayers(adapterId), preferredSpaceId);
  assertWritableTuneLayers(layers);
  return layers.map((l) => l.uuid);
}

export async function reassignAdapterLayersToSpace(
  qdrantService: QdrantService,
  originalUri: string,
  targetSpaceId: string
): Promise<void> {
  const layerUuids = await collectLayerMemoryUuidsForTune(qdrantService, originalUri);
  for (const uuid of layerUuids) {
    await qdrantService.updateMemory(uuid, { space_id: targetSpaceId });
  }
}
