/**
 * Row/filter primitives for the embedded LanceDB record store.
 *
 * Records are persisted in a Lance table shaped to be a faithful mirror of a
 * Qdrant point: the whole `payload` is kept verbatim as a JSON string (so reads
 * reconstruct a byte-identical `Memory` via `pointToMemory`), while the scalar
 * keys that appear in query filters are *promoted* to real columns so LanceQL
 * scans and ANN can select them. `toRow` derives those columns from a
 * Qdrant-shaped point, and `conditionToSql` translates the exact filter shape
 * emitted by `buildSpaceFilter` (`must` / `must_not` of `{key, match}` and
 * `{should}` / `{is_empty}` conditions) into a LanceQL `WHERE` clause.
 */
import { SQUADRULES_APP_SPACE_ID } from '../../../config.js';

/** A point shaped the way the Qdrant write handlers build them. */
export interface QdrantPointLike {
  id: string;
  payload: Record<string, unknown>;
  vector?: Record<string, unknown>;
}

/** One Lance record row: promoted scalars + verbatim payload + named vectors. */
export interface LanceRecordRow {
  id: string;
  space_id: string;
  slug: string;
  adapter_id: string;
  layer_index: number;
  layer_count: number;
  protocol_version: string;
  content_type: string;
  protocol_id: string;
  domain: string;
  task: string;
  type: string;
  artifact_slug: string;
  protocol_step: number;
  created_at: string;
  payload: string;
  bm25_json: string;
  [vectorColumn: string]: unknown;
}

/**
 * Dotted payload path -> promoted column. Covers every key that appears in a
 * query filter across retrieval, protocol, slug-mint and artifact code paths.
 */
const KEY_TO_COLUMN: Record<string, keyof LanceRecordRow> = {
  space_id: 'space_id',
  slug: 'slug',
  'adapter.id': 'adapter_id',
  'adapter.layer_index': 'layer_index',
  'artifact.slug': 'artifact_slug',
  'protocol_id': 'protocol_id',
  'protocol.step': 'protocol_step',
  content_type: 'content_type',
  domain: 'domain',
  task: 'task',
  type: 'type'
};

/** Escape a value for a LanceQL string literal. */
export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Coerce a stored numeric cell to a plain `number[]`. A data-inferred embedding
 * column reads back as an Apache Arrow `Vector` (not a JS array), so an
 * `Array.isArray` test alone would silently drop every embedding.
 */
export function toNumberArray(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    return value.every((n) => typeof n === 'number') ? (value as number[]) : null;
  }
  if (value && typeof value === 'object' && typeof (value as { length?: unknown }).length === 'number' && Symbol.iterator in value) {
    const arr = Array.from(value as Iterable<unknown>);
    return arr.length > 0 && arr.every((n) => typeof n === 'number') ? (arr as number[]) : null;
  }
  return null;
}

/** Column name for a dotted payload key, if it is promoted; else undefined. */
export function columnForKey(key: string): keyof LanceRecordRow | undefined {
  return KEY_TO_COLUMN[key];
}

function renderMatch(column: keyof LanceRecordRow, match: Record<string, unknown>): string {
  if ('value' in match) {
    const value = match['value'];
    if (typeof value === 'number') return `${column} = ${value}`;
    if (typeof value === 'boolean') return `${column} = ${value}`;
    return `${column} = ${sqlLiteral(String(value))}`;
  }
  if ('any' in match) {
    const list = Array.isArray(match['any']) ? match['any'] : [];
    if (list.length === 0) return '1 = 0';
    const inList = list.map((v) => (typeof v === 'number' ? String(v) : sqlLiteral(String(v)))).join(', ');
    return `${column} IN (${inList})`;
  }
  throw new Error(`Unsupported Lance match clause: ${JSON.stringify(match)}`);
}

function renderCondition(condition: Record<string, unknown>): string {
  if ('should' in condition) {
    const branches = Array.isArray(condition['should']) ? condition['should'] : [];
    if (branches.length === 0) return '1 = 1';
    return `(${branches.map((b) => renderCondition(b as Record<string, unknown>)).join(' OR ')})`;
  }
  if ('must' in condition) {
    const inner = Array.isArray(condition['must']) ? condition['must'] : [];
    return `(${inner.map((b) => renderCondition(b as Record<string, unknown>)).join(' AND ')})`;
  }
  if ('is_empty' in condition) {
    const isEmpty = condition['is_empty'] as { key?: string };
    const column = isEmpty?.key ? columnForKey(isEmpty.key) : undefined;
    if (!column) throw new Error(`Unsupported is_empty key: ${isEmpty?.key}`);
    return `(${column} IS NULL OR ${column} = '')`;
  }
  const key = condition['key'] as string | undefined;
  const match = condition['match'] as Record<string, unknown> | undefined;
  if (!key || !match) throw new Error(`Unsupported Lance condition: ${JSON.stringify(condition)}`);
  const column = columnForKey(key);
  if (!column) throw new Error(`Cannot filter on unpromoted payload key: ${key}`);
  return renderMatch(column, match);
}

/**
 * Build a LanceQL `WHERE` string from Qdrant-style `must` / `must_not` arrays.
 * Returns undefined when there is nothing to constrain (match-all).
 */
export function buildWhere(filter: {
  must?: Array<Record<string, unknown>>;
  must_not?: Array<Record<string, unknown>>;
}): string | undefined {
  const must = filter.must ?? [];
  const mustNot = filter.must_not ?? [];
  const parts: string[] = [];
  if (must.length > 0) parts.push(`(${must.map(renderCondition).join(' AND ')})`);
  for (const neg of mustNot) parts.push(`NOT (${renderCondition(neg)})`);
  if (parts.length === 0) return undefined;
  return parts.join(' AND ');
}

function readString(payload: Record<string, unknown>, key: string): string {
  const v = payload[key];
  return typeof v === 'string' ? v : '';
}

/** Convert a Qdrant-shaped point to a Lance row (payload verbatim, scalars promoted). */
export function toRow(point: QdrantPointLike): LanceRecordRow {
  const payload = point.payload ?? {};
  const adapter = (payload['adapter'] ?? {}) as Record<string, unknown>;
  const artifact = (payload['artifact'] ?? {}) as Record<string, unknown>;
  const protocol = (payload['protocol'] ?? {}) as Record<string, unknown>;
  const row: LanceRecordRow = {
    id: String(point.id),
    space_id: typeof payload['space_id'] === 'string' && payload['space_id'].length > 0
      ? payload['space_id']
      : SQUADRULES_APP_SPACE_ID,
    slug: readString(payload, 'slug'),
    adapter_id: typeof adapter['id'] === 'string' ? adapter['id'] : '',
    layer_index: typeof adapter['layer_index'] === 'number' ? adapter['layer_index'] : 0,
    layer_count: typeof adapter['layer_count'] === 'number' ? adapter['layer_count'] : 0,
    protocol_version: typeof adapter['protocol_version'] === 'string' ? adapter['protocol_version'] : '',
    content_type: readString(payload, 'content_type'),
    protocol_id: readString(payload, 'protocol_id'),
    domain: readString(payload, 'domain'),
    task: readString(payload, 'task'),
    type: readString(payload, 'type'),
    artifact_slug: typeof artifact['slug'] === 'string' ? artifact['slug'] : '',
    protocol_step: typeof protocol['step'] === 'number' ? protocol['step'] : 0,
    created_at: readString(payload, 'created_at'),
    payload: JSON.stringify(payload),
    bm25_json: ''
  };
  const vector = point.vector ?? {};
  const bm25 = vector['bm25'];
  if (bm25 && typeof bm25 === 'object') row.bm25_json = JSON.stringify(bm25);
  for (const [name, value] of Object.entries(vector)) {
    if (name === 'bm25') continue;
    if (Array.isArray(value) && value.every((n) => typeof n === 'number')) {
      row[name] = value as number[];
    }
  }
  return row;
}

