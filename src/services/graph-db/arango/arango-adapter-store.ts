/**
 * ArangoDB adapter topology: nodes, inheritance edges, traversal.
 *
 * Every write is atomic: the node upsert is a single AQL UPSERT, and the edge
 * reconcile (remove old edges + insert the new one) runs inside one stream
 * transaction so a failed write never leaves a half-linked child.
 *
 * Traversal uses native AQL graph traversal over the `Inherits` edge collection,
 * identical in direction and depth cap to the embedded backend.
 */
import type { ArangoHttpClient } from './arango-http.js';
import type {
  AdapterNode,
  AdapterNodeWriteOptions,
  PathToRootResult,
  ResolvedInheritance
} from '../graph-types.js';
import { adapterGraphKey } from '../adapter-scope.js';
import { mergeResolvedProperties } from '../inheritance-merge.js';
import { adapterFromDoc, type ArangoDoc } from './arango-rows.js';

const MAX_DEPTH = 10;

/** Read one adapter node by scoped key. */
export async function getAdapter(
  client: ArangoHttpClient,
  adapterKey: string
): Promise<AdapterNode | null> {
  const rows = await client.query<ArangoDoc>(
    'FOR a IN Adapter FILTER a._key == @adapterKey LIMIT 1 RETURN a',
    { adapterKey }
  );
  return rows[0] ? adapterFromDoc(rows[0]) : null;
}

export async function getAllAdapters(client: ArangoHttpClient): Promise<AdapterNode[]> {
  const rows = await client.query<ArangoDoc>('FOR a IN Adapter RETURN a');
  return rows.map(adapterFromDoc);
}

interface TraversalRow {
  ancestor?: ArangoDoc;
  depth?: number;
}

/** Ancestors of an adapter using native AQL traversal, capped at 10 hops. */
export async function findPathToRoot(
  client: ArangoHttpClient,
  adapterKey: string,
  order: 'nearest-first' | 'root-first' = 'nearest-first'
): Promise<PathToRootResult[]> {
  const rows = await client.query<TraversalRow>(
    `FOR v, e, p IN 1..${MAX_DEPTH} OUTBOUND CONCAT('Adapter/', @adapterKey) Inherits
       RETURN { ancestor: v, depth: LENGTH(p.edges) }`,
    { adapterKey }
  );

  const results: PathToRootResult[] = [];
  for (const row of rows) {
    if (!row.ancestor) continue;
    const ancestor = adapterFromDoc(row.ancestor);
    results.push({
      ancestor,
      edge: {
        from: adapterKey,
        to: ancestor.key,
        relationship: 'inherits',
        created_at: new Date().toISOString()
      },
      depth: Number(row.depth ?? 0)
    });
  }
  results.sort((a, b) => (order === 'root-first' ? b.depth - a.depth : a.depth - b.depth));
  return results;
}

/** Resolve effective properties through the ancestor chain (shared merge). */
export async function resolveInheritance(
  client: ArangoHttpClient,
  adapterKey: string
): Promise<ResolvedInheritance | null> {
  const adapterNode = await getAdapter(client, adapterKey);
  if (!adapterNode) return null;
  const pathToRoot = await findPathToRoot(client, adapterKey, 'root-first');
  const ancestors = pathToRoot.map((row) => row.ancestor as AdapterNode);
  return {
    adapter: adapterNode,
    resolved_properties: mergeResolvedProperties(adapterNode, ancestors),
    inheritance_chain: pathToRoot.map((row) => row.ancestor)
  };
}

/** Slugs of adapters that inherit from the given scoped parent. */
export async function getChildren(
  client: ArangoHttpClient,
  spaceId: string,
  slug: string
): Promise<string[]> {
  const parentKey = adapterGraphKey(spaceId, slug);
  const rows = await client.query<{ slug?: string }>(
    `FOR c IN 1..1 OUTBOUND CONCAT('Adapter/', @parentKey) SpecializedBy
       RETURN { slug: c.slug }`,
    { parentKey }
  );
  const slugs = rows.map((row) => String(row.slug ?? '')).filter((value) => value.length > 0);
  return [...new Set(slugs)];
}

function adapterDoc(adapter: AdapterNode, includeCreatedAt: boolean): ArangoDoc {
  const doc: ArangoDoc = {
    _key: adapter.key,
    type: 'adapter',
    slug: adapter.slug,
    version: adapter.version,
    title: adapter.title,
    updated_at: adapter.updated_at,
    frontmatter: adapter.frontmatter ?? null,
    layer_count: adapter.layer_count ?? 0,
    contract_types: adapter.contract_types ?? [],
    space: adapter.space ?? '',
    tags: adapter.tags ?? [],
    metadata: adapter.metadata ?? {}
  };
  if (includeCreatedAt) doc['created_at'] = adapter.created_at;
  return doc;
}

/** Insert a new adapter node; a duplicate key fails. */
export async function createAdapterNode(
  client: ArangoHttpClient,
  adapter: AdapterNode
): Promise<void> {
  if (!adapter.space || adapter.space.trim().length === 0) {
    throw new Error('createAdapterNode: adapter.space is required — the graph never guesses a scope');
  }
  await client.query('INSERT @doc INTO Adapter', { doc: adapterDoc(adapter, true) });
}

/** Upsert an adapter node, preserving `created_at` on update. */
export async function upsertAdapterNode(
  client: ArangoHttpClient,
  adapter: AdapterNode
): Promise<void> {
  if (!adapter.space || adapter.space.trim().length === 0) {
    throw new Error('upsertAdapterNode: adapter.space is required — the graph never guesses a scope');
  }
  await client.query(
    `UPSERT { _key: @key }
       INSERT @insertDoc
       UPDATE @updateDoc
       IN Adapter`,
    {
      key: adapter.key,
      insertDoc: adapterDoc(adapter, true),
      updateDoc: adapterDoc(adapter, false)
    }
  );
}

/**
 * Upsert an adapter node from parsed frontmatter and return its scoped key.
 *
 * Every author-declared field is preserved (ADR 0043), not only the fixed topology
 * names, so arbitrary domain properties round-trip for override validation.
 */
export async function upsertAdapterFromFrontmatter(
  client: ArangoHttpClient,
  slug: string,
  version: string,
  frontmatter: Record<string, unknown>,
  opts: AdapterNodeWriteOptions
): Promise<string> {
  const now = new Date().toISOString();
  const adapterKey = adapterGraphKey(opts.spaceId, slug);

  const persistedFrontmatter: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(frontmatter)) {
    if (value === undefined || value === null) continue;
    if (field === 'override') {
      if (Array.isArray(value) && value.length > 0) persistedFrontmatter['override'] = value;
      continue;
    }
    persistedFrontmatter[field] = value;
  }
  persistedFrontmatter['slug'] = slug;
  persistedFrontmatter['version'] = version;

  await upsertAdapterNode(client, {
    key: adapterKey,
    type: 'adapter',
    slug,
    version,
    title: opts.title || slug,
    created_at: now,
    updated_at: now,
    frontmatter: { ...persistedFrontmatter, slug, version } as NonNullable<AdapterNode['frontmatter']>,
    layer_count: opts.layerCount || 0,
    contract_types: opts.contractTypes || [],
    space: opts.spaceId,
    tags: opts.tags || [],
    metadata: opts.metadata || {}
  });
  return adapterKey;
}

/** Create the `Inherits` edge and its `SpecializedBy` inverse atomically. */
export async function createInheritanceEdge(
  client: ArangoHttpClient,
  edge: {
    from: string;
    to: string;
    created_at: string;
    override_fields?: string[];
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await client.withTransaction(
    { write: ['Inherits', 'SpecializedBy'] },
    async (transactionId) => {
      await client.queryInTransaction(
        transactionId,
        `INSERT {
           _from: CONCAT('Adapter/', @from), _to: CONCAT('Adapter/', @to),
           relationship: 'inherits', inherited_fields: [], override_fields: @overrideFields,
           created_at: @createdAt, metadata: @metadata
         } INTO Inherits`,
        {
          from: edge.from,
          to: edge.to,
          overrideFields: edge.override_fields ?? [],
          createdAt: edge.created_at,
          metadata: edge.metadata ?? {}
        }
      );
      await client.queryInTransaction(
        transactionId,
        `INSERT {
           _from: CONCAT('Adapter/', @to), _to: CONCAT('Adapter/', @from),
           relationship: 'specialized_by', specialization_type: 'override',
           created_at: @createdAt, metadata: @metadata
         } INTO SpecializedBy`,
        {
          from: edge.from,
          to: edge.to,
          createdAt: edge.created_at,
          metadata: edge.metadata ?? {}
        }
      );
    }
  );
}

async function removeInheritanceEdges(
  client: ArangoHttpClient,
  transactionId: string,
  childKey: string
): Promise<void> {
  const childId = `Adapter/${childKey}`;
  await client.queryInTransaction(
    transactionId,
    'FOR e IN Inherits FILTER e._from == @childId REMOVE e IN Inherits',
    { childId }
  );
  await client.queryInTransaction(
    transactionId,
    'FOR e IN SpecializedBy FILTER e._to == @childId REMOVE e IN SpecializedBy',
    { childId }
  );
}

/**
 * Reconcile one child's edges atomically: drop the old edges, then link the declared
 * parent when that node exists. Returns the parent key linked, or `null`.
 */
export async function writeInheritanceEdges(
  client: ArangoHttpClient,
  childKey: string,
  frontmatter: Record<string, unknown>,
  opts: { parentSpaceId: string; now?: string }
): Promise<string | null> {
  const declaredParent = frontmatter['inherits'];
  const parentSlug = typeof declaredParent === 'string' ? declaredParent.trim() : '';
  const parentKey = parentSlug.length > 0 ? adapterGraphKey(opts.parentSpaceId, parentSlug) : null;
  const overrideFields = Array.isArray(frontmatter['override'])
    ? (frontmatter['override'] as string[])
    : [];

  return client.withTransaction(
    { write: ['Inherits', 'SpecializedBy'], read: ['Adapter'] },
    async (transactionId) => {
      await removeInheritanceEdges(client, transactionId, childKey);
      if (!parentKey) return null;

      const parentRows = await client.queryInTransaction<{ key?: string }>(
        transactionId,
        'FOR a IN Adapter FILTER a._key == @parentKey LIMIT 1 RETURN { key: a._key }',
        { parentKey }
      );
      if (parentRows.length === 0) return null;

      const createdAt = opts.now ?? new Date().toISOString();
      const metadata = { parent_scope_id: opts.parentSpaceId };
      await client.queryInTransaction(
        transactionId,
        `INSERT {
           _from: CONCAT('Adapter/', @childKey), _to: CONCAT('Adapter/', @parentKey),
           relationship: 'inherits', inherited_fields: [], override_fields: @overrideFields,
           created_at: @createdAt, metadata: @metadata
         } INTO Inherits`,
        { childKey, parentKey, overrideFields, createdAt, metadata }
      );
      await client.queryInTransaction(
        transactionId,
        `INSERT {
           _from: CONCAT('Adapter/', @parentKey), _to: CONCAT('Adapter/', @childKey),
           relationship: 'specialized_by', specialization_type: 'override',
           created_at: @createdAt, metadata: @metadata
         } INTO SpecializedBy`,
        { childKey, parentKey, createdAt, metadata }
      );
      return parentKey;
    }
  );
}

/** Drop a child's edges without creating a replacement. */
export async function clearInheritanceEdges(
  client: ArangoHttpClient,
  childKey: string
): Promise<void> {
  await client.withTransaction({ write: ['Inherits', 'SpecializedBy'] }, async (transactionId) => {
    await removeInheritanceEdges(client, transactionId, childKey);
  });
}
