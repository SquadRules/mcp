/**
 * LadybugDB adapter reads: node lookup, ancestor traversal, effective resolution.
 *
 * Merge semantics follow docs/specs/graph-schema.md §5.4 and ADR 0043: a descendant
 * replaces an inherited field only when it names the field in its own `override:`
 * list; identity fields always come from the child.
 */
import type { Connection } from '@ladybugdb/core';
import type {
  AdapterChildRef,
  AdapterNode,
  ConceptNode,
  InheritanceEdge,
  PathToRootResult,
  ResolvedInheritance
} from '../graph-types.js';
import { adapterGraphKey, parseAdapterGraphKey } from '../adapter-scope.js';
import { mergeResolvedProperties } from '../inheritance-merge.js';
import { adapterFromAliasRow, adapterFromRow, parseJson, readRows } from './ladybug-exec.js';

/** Read one adapter node by scoped key. */
export async function getAdapter(
  connection: Connection,
  adapterKey: string
): Promise<AdapterNode | null> {
  const rows = await readRows(connection, 'MATCH (a:Adapter {key: $adapterKey}) RETURN a', {
    adapterKey
  });
  const first = rows[0];
  return first ? adapterFromAliasRow(first) : null;
}

/** Read every adapter node (diagnostics and boot reconciliation tests). */
export async function getAllAdapters(connection: Connection): Promise<AdapterNode[]> {
  const rows = await readRows(connection, 'MATCH (a:Adapter) RETURN a');
  return rows
    .map((row) => adapterFromAliasRow(row))
    .filter((node): node is AdapterNode => node !== null);
}

/** Flatten the columns returned by the ancestor traversal into an adapter node. */
function ancestorFromRow(row: Record<string, unknown>): AdapterNode {
  return adapterFromRow({
    key: row['key'],
    type: row['type'],
    slug: row['slug'],
    version: row['version'],
    title: row['title'],
    created_at: row['created_at'],
    updated_at: row['updated_at'],
    frontmatter: row['frontmatter'],
    layer_count: row['layer_count'],
    contract_types: row['contract_types'],
    space: row['space'],
    tags: row['tags'],
    metadata: row['metadata']
  });
}

/**
 * Ancestors of an adapter, one row per reachable ancestor.
 *
 * `depth` is 1 for the direct parent. The traversal is capped at 10 hops, matching
 * the embedded query in docs/specs/graph-schema.md §6.1.
 */
export async function findPathToRoot(
  connection: Connection,
  adapterKey: string,
  order: 'nearest-first' | 'root-first' = 'nearest-first'
): Promise<PathToRootResult[]> {
  const rows = await readRows<Record<string, unknown>>(
    connection,
    `MATCH path = (child:Adapter {key: $adapterKey})-[:Inherits*1..10]->(ancestor:Adapter)
     RETURN ancestor.key as key,
            ancestor.type as type,
            ancestor.slug as slug,
            ancestor.version as version,
            ancestor.title as title,
            ancestor.created_at as created_at,
            ancestor.updated_at as updated_at,
            ancestor.frontmatter as frontmatter,
            ancestor.layer_count as layer_count,
            ancestor.contract_types as contract_types,
            ancestor.space as space,
            ancestor.tags as tags,
            ancestor.metadata as metadata,
            length(path) as depth`,
    { adapterKey }
  );

  const results = rows.map((row) => {
    const ancestor = ancestorFromRow(row);
    const edge: InheritanceEdge = {
      from: adapterKey,
      to: ancestor.key,
      relationship: 'inherits',
      created_at: new Date().toISOString()
    };
    return { ancestor, edge, depth: Number(row['depth'] ?? 0) };
  });

  results.sort((a, b) =>
    order === 'root-first' ? b.depth - a.depth : a.depth - b.depth
  );
  return results;
}

/**
 * Resolve an adapter's effective properties through its ancestor chain.
 *
 * Returns `null` when the adapter node is absent. A node with no ancestors resolves
 * to its own properties. The merge itself lives in `../inheritance-merge.ts` so the
 * ArangoDB backend produces an identical result.
 */
export async function resolveInheritance(
  connection: Connection,
  adapterKey: string
): Promise<ResolvedInheritance | null> {
  const adapterNode = await getAdapter(connection, adapterKey);
  if (!adapterNode) return null;

  const pathToRoot = await findPathToRoot(connection, adapterKey, 'root-first');
  const ancestors = pathToRoot.map((row) => row.ancestor as AdapterNode);
  return {
    adapter: adapterNode,
    resolved_properties: mergeResolvedProperties(adapterNode, ancestors),
    inheritance_chain: pathToRoot.map((row) => row.ancestor)
  };
}

/**
 * Children of one scoped parent, each with the scope its node is stored in.
 *
 * The edge is traversed to the child node, so the child's own `key`/`space` are read
 * rather than reconstructed from the parent's scope: an app-space parent is inherited
 * by children stored in other spaces. A node projected before the `space` column was
 * populated still carries its scope in the key, which is the fallback — never the
 * parent's space, which is exactly the value that must not be assumed.
 */
export async function getChildren(
  connection: Connection,
  spaceId: string,
  slug: string
): Promise<AdapterChildRef[]> {
  const parentKey = adapterGraphKey(spaceId, slug);
  const rows = await readRows<Record<string, unknown>>(
    connection,
    `MATCH (parent:Adapter {key: $parentKey})-[:SpecializedBy]->(child:Adapter)
     RETURN child.key as key, child.slug as slug, child.space as space`,
    { parentKey }
  );
  const children = new Map<string, AdapterChildRef>();
  for (const row of rows) {
    const childSlug = String(row['slug'] ?? '').trim();
    if (childSlug.length === 0) continue;
    const key = String(row['key'] ?? '').trim();
    const space = String(row['space'] ?? '').trim() || (parseAdapterGraphKey(key)?.spaceId ?? '');
    children.set(key, { key, slug: childSlug, space });
  }
  return [...children.values()];
}

/** Read one concept node by key. */
export async function getConcept(
  connection: Connection,
  conceptKey: string
): Promise<ConceptNode | null> {
  const rows = await readRows<Record<string, unknown>>(
    connection,
    'MATCH (c:Concept {key: $conceptKey}) RETURN c',
    { conceptKey }
  );
  const nested = rows[0]?.['c'];
  if (!nested || typeof nested !== 'object') return null;
  const row = nested as unknown as Record<string, unknown>;
  return {
    key: String(row['key'] ?? ''),
    type: 'concept',
    name: String(row['name'] ?? ''),
    definition: String(row['definition'] ?? ''),
    created_at: String(row['created_at'] ?? ''),
    updated_at: String(row['updated_at'] ?? ''),
    baseline_attributes: parseJson<Record<string, unknown>>(row['baseline_attributes'], {}),
    tags: parseJson<string[]>(row['tags'], []),
    metadata: parseJson<Record<string, unknown>>(row['metadata'], {})
  };
}
