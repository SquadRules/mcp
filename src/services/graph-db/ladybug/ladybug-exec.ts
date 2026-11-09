/**
 * LadybugDB query helpers and row mapping.
 *
 * The embedded driver returns either a single `QueryResult` or an array of them
 * depending on the statement shape, so every read funnels through `readRows`.
 * Row values are flat primitives; JSON is stored as text and parsed at the edge
 * so callers see typed nodes.
 */
import type { Connection, LbugValue } from '@ladybugdb/core';
import type { AdapterNode } from '../graph-types.js';

export type QueryParams = Record<string, LbugValue>;

/** Execute a statement, ignoring any result rows. */
export async function executeStatement(
  connection: Connection,
  query: string,
  params?: QueryParams
): Promise<void> {
  const statement = await connection.prepare(query);
  await connection.execute(statement, params);
}

/** Execute a read statement and return all rows. */
export async function readRows<T = Record<string, unknown>>(
  connection: Connection,
  query: string,
  params?: QueryParams
): Promise<T[]> {
  const statement = await connection.prepare(query);
  const result = await connection.execute(statement, params);
  const queryResult = Array.isArray(result) ? result[0] : result;
  if (!queryResult) return [];
  return (await queryResult.getAll()) as T[];
}

/** Parse a JSON text column, tolerating null/blank/invalid values. */
export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw.trim().length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Map a raw `Adapter` row (flat columns) to an `AdapterNode`. */
export function adapterFromRow(row: Record<string, unknown>): AdapterNode {
  const node: AdapterNode = {
    key: String(row['key'] ?? ''),
    type: 'adapter',
    slug: String(row['slug'] ?? ''),
    version: String(row['version'] ?? ''),
    title: String(row['title'] ?? ''),
    created_at: String(row['created_at'] ?? ''),
    updated_at: String(row['updated_at'] ?? ''),
    layer_count: Number(row['layer_count'] ?? 0),
    contract_types: parseJson<string[]>(row['contract_types'], []),
    tags: parseJson<string[]>(row['tags'], []),
    metadata: parseJson<Record<string, unknown>>(row['metadata'], {})
  };
  const frontmatter = parseJson<NonNullable<AdapterNode['frontmatter']> | null>(
    row['frontmatter'],
    null
  );
  if (frontmatter) node.frontmatter = frontmatter;
  if (typeof row['space'] === 'string') node.space = row['space'];
  return node;
}

/** Map a raw `Adapter` row nested under an alias (`RETURN a`). */
export function adapterFromAliasRow(row: Record<string, unknown>, alias = 'a'): AdapterNode | null {
  const nested = row[alias];
  if (!nested || typeof nested !== 'object') return null;
  return adapterFromRow(nested as unknown as Record<string, unknown>);
}
