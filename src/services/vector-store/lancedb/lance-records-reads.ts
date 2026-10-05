/**
 * Lance read/query layer for memory records.
 *
 * Every method mirrors the semantics of the Qdrant leaf helper it replaces
 * (`memory-retrieval.ts`, `protocol.ts` and the `store.ts` domain reads), down to
 * the space-source used for gating, the slug disambiguation precedence, the
 * pagination-until-exhausted scroll, and the exact returned object shape. Rows
 * carry the payload verbatim, so reads are byte-identical to the Qdrant path.
 */
import type { Memory } from '../../../types/memory.js';
import { SQUADRULES_APP_SPACE_ID } from '../../../config.js';
import { getSearchSpaceIds, getSpaceContext } from '../../../utils/tenant-context.js';
import { buildSpaceFilter, buildAdapterSiblingScrollFilter } from '../../../utils/space-filter.js';
import { ALLOWED_ARTIFACT_MIMES } from '../../../tools/artifact-mime.js';
import { structuredLogger } from '../../../utils/structured-logger.js';
import { pointToMemory } from '../../memory/qdrant-point-to-memory.js';
import type { LayerRecord, SlugResolveOutcome, ArtifactResolveOutcome } from '../types.js';
import type { LanceRecordEngine } from './lance-records-engine.js';
import type { LanceRecordRow } from './lance-records-schema.js';

interface RawPoint {
  id: string;
  payload: any;
}

function payloadOf(row: LanceRecordRow): any {
  return JSON.parse(row.payload) as Record<string, unknown>;
}

function rowToPoint(row: LanceRecordRow): RawPoint {
  return { id: row.id, payload: payloadOf(row) };
}

function toLayerRecord(row: LanceRecordRow): LayerRecord {
  return { uuid: row.id, payload: payloadOf(row) as unknown as Memory };
}

function slugPrecedence(spaceId: string): number {
  if (spaceId.startsWith('user:')) return 0;
  if (spaceId.startsWith('group:')) return 1;
  if (spaceId === SQUADRULES_APP_SPACE_ID || spaceId.startsWith('app:')) return 2;
  return 2;
}

export class LanceRecordReader {
  constructor(private readonly engine: LanceRecordEngine) {}

  /** Accessible-by-space single point (mirrors `retrieveAccessiblePointById`). */
  async retrieveAccessibleById(uuid: string): Promise<RawPoint | null> {
    const row = await this.engine.retrieveRaw(uuid);
    if (!row) return null;
    const point = rowToPoint(row);
    const spaceId = String((point.payload['space_id'] as string | undefined) ?? SQUADRULES_APP_SPACE_ID);
    const allowed = getSpaceContext().allowedSpaceIds;
    const canRead = allowed.includes(spaceId) || spaceId === SQUADRULES_APP_SPACE_ID;
    return canRead ? point : null;
  }

  /** Neutral `Memory` read (mirrors `store.getMemory`). */
  async getMemory(memoryUuid: string): Promise<Memory | null> {
    const point = await this.retrieveAccessibleById(memoryUuid);
    if (!point) return null;
    return pointToMemory(point);
  }

  /** `{uuid, payload}` retrieval (mirrors `retrieveById`). */
  async retrieveById(uuid: string): Promise<{ uuid: string; payload: any } | null> {
    const point = await this.retrieveAccessibleById(uuid);
    if (!point) return null;
    return { uuid: point.id, payload: point.payload };
  }

  /** Ad-hoc memory object (mirrors `getMemoryByUUID` exactly). */
  async getMemoryByUUID(uuid: string): Promise<any | null> {
    const result = await this.retrieveById(uuid);
    if (!result) return null;
    const payload = result.payload;
    return {
      id: result.uuid,
      label: payload.label || '',
      text: payload.text || '',
      domain: payload.domain || '',
      task: payload.task || '',
      type: payload.type || 'context',
      tags: payload.tags || [],
      protocol: payload.protocol,
      quality_metrics: payload.quality_metrics,
      quality_metadata: payload.quality_metadata,
      memory_uuid: uuid,
      adapter: payload.adapter ? {
        id: payload.adapter.id,
        name: payload.adapter.name,
        layer_index: payload.adapter.layer_index,
        layer_count: payload.adapter.layer_count,
        ...(typeof payload.adapter.protocol_version === 'string' && { protocol_version: payload.adapter.protocol_version }),
        ...(Array.isArray(payload.adapter.activation_patterns) && { activation_patterns: payload.adapter.activation_patterns }),
        ...(typeof payload.adapter.reward_signal === 'string' && { reward_signal: payload.adapter.reward_signal }),
        ...(typeof payload.adapter.chain_root === 'string' && payload.adapter.chain_root.length > 0 && { chain_root: payload.adapter.chain_root })
      } : undefined,
      inference_contract: payload.inference_contract,
      embedding: [],
      access_count: payload.quality_metrics?.retrievalCount || 0,
      last_accessed: new Date(payload.updated_at || payload.created_at || Date.now()),
      relevance_score: 1.0,
      created_at: new Date(payload.created_at || Date.now()),
      peak_contexts: [],
      certainty: 0.8,
      entropy: 0.2
    };
  }

  /** All non-artifact layers of one adapter, sorted by layer index. */
  async getAdapterLayers(adapterId: string, extraSpaceIds?: string[]): Promise<Array<{ uuid: string; payload: any }>> {
    const spaceIds = extraSpaceIds && extraSpaceIds.length > 0 ? extraSpaceIds : getSearchSpaceIds();
    const sibling = buildAdapterSiblingScrollFilter(spaceIds, adapterId);
    const rows = await this.engine.scroll({
      must: sibling.must,
      must_not: [{ key: 'content_type', match: { any: [...ALLOWED_ARTIFACT_MIMES] } }]
    });
    return rows
      .map((row) => ({ uuid: row.id, payload: payloadOf(row) }))
      .sort((a, b) => {
        const ai = typeof a.payload?.adapter?.layer_index === 'number' ? a.payload.adapter.layer_index : 0;
        const bi = typeof b.payload?.adapter?.layer_index === 'number' ? b.payload.adapter.layer_index : 0;
        return ai - bi;
      });
  }

  /** Exact slug -> adapter entry-layer point, deterministic on ambiguity. */
  async findFirstStepMemoryUuidBySlug(slug: string): Promise<SlugResolveOutcome> {
    const normalized = (slug || '').trim().toLowerCase();
    if (!normalized) return { layerUuid: null };
    const filter = buildSpaceFilter(getSearchSpaceIds(), {
      must: [
        { key: 'slug', match: { value: normalized } },
        { key: 'adapter.layer_index', match: { value: 1 } }
      ]
    });
    const rows = await this.engine.scroll(filter);
    if (rows.length === 0) return { layerUuid: null };
    const points = rows.map(rowToPoint).sort((a, b) => a.id.localeCompare(b.id));

    const byAdapterId = new Map<string, RawPoint>();
    for (const p of points) {
      const adapterId = typeof p.payload?.adapter?.id === 'string' ? p.payload.adapter.id : `__orphan_${p.id}`;
      if (!byAdapterId.has(adapterId)) byAdapterId.set(adapterId, p);
    }
    const unique = [...byAdapterId.values()];
    if (unique.length === 1) return { layerUuid: unique[0]!.id };

    const spaceOf = (p: RawPoint) => String(p.payload?.space_id ?? SQUADRULES_APP_SPACE_ID);
    const sorted = [...unique].sort((a, b) => {
      const ap = slugPrecedence(spaceOf(a));
      const bp = slugPrecedence(spaceOf(b));
      if (ap !== bp) return ap - bp;
      return a.id.localeCompare(b.id);
    });
    const winner = sorted[0]!;
    const chosenId = winner.id;
    const adapterHint = typeof winner.payload?.adapter?.id === 'string' ? winner.payload.adapter.id : chosenId;
    const winnerSpaceId = spaceOf(winner);
    const contenderSummary = sorted
      .map((p) => {
        const adapterId = typeof p.payload?.adapter?.id === 'string' ? p.payload.adapter.id : p.id;
        return `${adapterId}@${spaceOf(p)}`;
      })
      .join(', ');
    const note = `Slug "${normalized}" matched ${unique.length} adapters; selected "${adapterHint}" from "${winnerSpaceId}" by precedence (personal > group > app/system, then stable id). Candidates: ${contenderSummary}. Prefer an explicit adapter URI such as squadrules://adapter/${adapterHint} to avoid ambiguity.`;
    structuredLogger.warn(`[slug-resolve] ${note}`);
    return { layerUuid: chosenId, disambiguation_note: note };
  }

  /** Exact artifact slug -> single artifact point, null when ambiguous. */
  async findArtifactMemoryUuidBySlug(slug: string): Promise<ArtifactResolveOutcome> {
    const normalized = (slug || '').trim().toLowerCase();
    if (!normalized) return { artifactUuid: null };
    const rows = await this.engine.scroll(buildSpaceFilter(getSearchSpaceIds(), {
      must: [{ key: 'artifact.slug', match: { value: normalized } }]
    }));
    if (rows.length === 0) return { artifactUuid: null };
    if (rows.length > 1) {
      const candidates = rows.map((r) => r.id).join(', ');
      return { artifactUuid: null, disambiguation_note: `Artifact slug "${normalized}" is ambiguous. Matching artifact UUIDs: ${candidates}` };
    }
    return { artifactUuid: rows[0]!.id };
  }

  /** Points carrying a `protocol_id` (mirrors `findProtocolSteps`). */
  async findProtocolSteps(protocolId: string): Promise<Array<{ uuid: string; protocol: unknown; payload: Record<string, unknown> }>> {
    const rows = await this.engine.scroll(buildSpaceFilter(getSpaceContext().allowedSpaceIds, {
      must: [{ key: 'protocol_id', match: { value: protocolId } }]
    }));
    return rows
      .map((row) => {
        const payload = payloadOf(row);
        return { uuid: row.id, protocol: payload['protocol'], payload };
      })
      .filter((item) => item.protocol);
  }

  /** Single protocol step by domain/type/task/step (mirrors `findProtocolStep`). */
  async findProtocolStep(domain: string, type: string, task: string, step: number): Promise<{ uuid: string; payload: Record<string, unknown> } | null> {
    const rows = await this.engine.scroll(buildSpaceFilter(getSpaceContext().allowedSpaceIds, {
      must: [
        { key: 'domain', match: { value: domain } },
        { key: 'type', match: { value: type } },
        { key: 'task', match: { value: task } },
        { key: 'protocol.step', match: { value: step } }
      ]
    }), 1);
    if (rows.length === 0) return null;
    return { uuid: rows[0]!.id, payload: payloadOf(rows[0]!) };
  }

  /** Every layer point in one space. */
  async scrollSpace(spaceId: string, options: { paginate?: boolean; limit?: number } = {}): Promise<LayerRecord[]> {
    const rows = await this.engine.scroll(buildSpaceFilter([spaceId]), options.paginate === false ? options.limit : undefined);
    return rows.map(toLayerRecord);
  }

  /** Artifact layer points attached to an adapter, across searchable spaces. */
  async listAdapterArtifacts(adapterId: string): Promise<LayerRecord[]> {
    const rows = await this.engine.scroll(buildSpaceFilter(getSearchSpaceIds(), {
      must: [
        { key: 'adapter.id', match: { value: adapterId } },
        { key: 'content_type', match: { any: [...ALLOWED_ARTIFACT_MIMES] } }
      ]
    }));
    return rows.map(toLayerRecord);
  }

  /** First-layer footer points for the refining/creation protocol slugs. */
  async findProtocolFooterLayers(refineSlug: string, createSlug: string): Promise<LayerRecord[]> {
    const rows = await this.engine.scroll({
      must: [
        { key: 'slug', match: { any: [refineSlug, createSlug] } },
        { key: 'space_id', match: { value: SQUADRULES_APP_SPACE_ID } },
        { key: 'adapter.layer_index', match: { value: 1 } }
      ]
    }, 10);
    return rows.map(toLayerRecord);
  }

  /** Protocol version already stored for an app-space adapter slug. */
  async getStoredAdapterVersion(slug: string): Promise<string | undefined> {
    const rows = await this.engine.scroll({
      must: [
        { key: 'space_id', match: { value: SQUADRULES_APP_SPACE_ID } },
        { key: 'slug', match: { value: slug } }
      ]
    }, 1);
    const payload = rows[0] ? payloadOf(rows[0]) : undefined;
    const version = payload?.['protocol_version'];
    return typeof version === 'string' ? version : undefined;
  }
}
