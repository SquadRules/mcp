/**
 * LadybugDB adapter writes: nodes, inheritance edges, concepts.
 *
 * Scope invariant: the node key is `adapter:<spaceId>:<slug>` and the caller
 * supplies the scope — this module never invents one. Node writes are upserts so a
 * re-train replaces the same node instead of duplicating topology.
 */
import type { Connection } from '@ladybugdb/core';
import type { AdapterNode, AdapterNodeWriteOptions, ConceptNode } from '../graph-types.js';
import { adapterGraphKey } from '../adapter-scope.js';
import { executeStatement, readRows } from './ladybug-exec.js';

/** Create an adapter node; a duplicate key is an error (use `upsertAdapterNode`). */
export async function createAdapterNode(
  connection: Connection,
  adapter: AdapterNode
): Promise<void> {
  if (!adapter.space || adapter.space.trim().length === 0) {
    throw new Error('createAdapterNode: adapter.space is required — the graph never guesses a scope');
  }
  await executeStatement(
    connection,
    `CREATE (a:Adapter {
       key: $key, type: $type, slug: $slug, version: $version, title: $title,
       created_at: $created_at, updated_at: $updated_at, frontmatter: $frontmatter,
       layer_count: $layer_count, contract_types: $contract_types, space: $space,
       tags: $tags, metadata: $metadata
     })`,
    {
      key: adapter.key,
      type: adapter.type,
      slug: adapter.slug,
      version: adapter.version,
      title: adapter.title,
      created_at: adapter.created_at,
      updated_at: adapter.updated_at,
      frontmatter: JSON.stringify(adapter.frontmatter || null),
      layer_count: adapter.layer_count || 0,
      contract_types: JSON.stringify(adapter.contract_types || []),
      space: adapter.space,
      tags: JSON.stringify(adapter.tags || []),
      metadata: JSON.stringify(adapter.metadata || {})
    }
  );
}

/** Upsert an adapter node: update the existing node's mutable columns, else create. */
export async function upsertAdapterNode(
  connection: Connection,
  adapter: AdapterNode
): Promise<void> {
  if (!adapter.space || adapter.space.trim().length === 0) {
    throw new Error('upsertAdapterNode: adapter.space is required — the graph never guesses a scope');
  }
  const existing = await readRows(
    connection,
    'MATCH (a:Adapter {key: $key}) RETURN a.key as key',
    { key: adapter.key }
  );
  if (existing.length === 0) {
    await createAdapterNode(connection, adapter);
    return;
  }
  await executeStatement(
    connection,
    `MATCH (a:Adapter {key: $key})
     SET a.version = $version, a.title = $title, a.updated_at = $updated_at,
         a.frontmatter = $frontmatter, a.layer_count = $layer_count,
         a.contract_types = $contract_types, a.space = $space,
         a.tags = $tags, a.metadata = $metadata`,
    {
      key: adapter.key,
      version: adapter.version,
      title: adapter.title,
      updated_at: adapter.updated_at,
      frontmatter: JSON.stringify(adapter.frontmatter || null),
      layer_count: adapter.layer_count || 0,
      contract_types: JSON.stringify(adapter.contract_types || []),
      space: adapter.space,
      tags: JSON.stringify(adapter.tags || []),
      metadata: JSON.stringify(adapter.metadata || {})
    }
  );
}

/**
 * Upsert an adapter node from parsed frontmatter and return its scoped key.
 *
 * Every author-declared field is preserved, not only the fixed topology names: an
 * arbitrary domain property (`risk_level: high`) must round-trip so a child can
 * override what the parent really declared (ADR 0043).
 */
export async function upsertAdapterFromFrontmatter(
  connection: Connection,
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

  await upsertAdapterNode(connection, {
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

/** Create the `Inherits` edge and its `SpecializedBy` inverse. */
export async function createInheritanceEdge(
  connection: Connection,
  edge: {
    from: string;
    to: string;
    created_at: string;
    override_fields?: string[];
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await executeStatement(
    connection,
    `MATCH (child:Adapter {key: $from}), (parent:Adapter {key: $to})
     CREATE (child)-[e:Inherits {
       relationship: 'inherits',
       inherited_fields: $inherited_fields,
       override_fields: $override_fields,
       created_at: $created_at,
       metadata: $metadata
     }]->(parent)`,
    {
      from: edge.from,
      to: edge.to,
      inherited_fields: JSON.stringify([]),
      override_fields: JSON.stringify(edge.override_fields || []),
      created_at: edge.created_at,
      metadata: JSON.stringify(edge.metadata || {})
    }
  );
  await executeStatement(
    connection,
    `MATCH (parent:Adapter {key: $to}), (child:Adapter {key: $from})
     CREATE (parent)-[e:SpecializedBy {
       relationship: 'specialized_by',
       specialization_type: 'override',
       created_at: $created_at,
       metadata: $metadata
     }]->(child)`,
    {
      from: edge.from,
      to: edge.to,
      created_at: edge.created_at,
      metadata: JSON.stringify(edge.metadata || {})
    }
  );
}

/** Remove a child's existing inheritance edges (idempotent re-train). */
async function removeInheritanceEdges(connection: Connection, childKey: string): Promise<void> {
  try {
    await executeStatement(
      connection,
      'MATCH (child:Adapter {key: $childKey})-[e:Inherits]->(parent:Adapter) DELETE e',
      { childKey }
    );
    await executeStatement(
      connection,
      'MATCH (parent:Adapter)-[e:SpecializedBy]->(child:Adapter {key: $childKey}) DELETE e',
      { childKey }
    );
  } catch {
    // Edge deletion is best-effort: absent edges are a no-op.
  }
}

/**
 * Reconcile one child's edges: drop the old edges, then link the declared parent
 * when that node exists. Returns the parent key linked, or `null`.
 */
export async function writeInheritanceEdges(
  connection: Connection,
  childKey: string,
  frontmatter: Record<string, unknown>,
  opts: { parentSpaceId: string; now?: string }
): Promise<string | null> {
  await removeInheritanceEdges(connection, childKey);

  const declaredParent = frontmatter['inherits'];
  const parentSlug = typeof declaredParent === 'string' ? declaredParent.trim() : '';
  if (parentSlug.length === 0) return null;

  const parentKey = adapterGraphKey(opts.parentSpaceId, parentSlug);
  const parentRows = await readRows(
    connection,
    'MATCH (a:Adapter {key: $parentKey}) RETURN a.key as key',
    { parentKey }
  );
  if (parentRows.length === 0) return null;

  const declaredOverride = frontmatter['override'];
  const overrideFields = Array.isArray(declaredOverride) ? (declaredOverride as string[]) : [];
  await createInheritanceEdge(connection, {
    from: childKey,
    to: parentKey,
    created_at: opts.now ?? new Date().toISOString(),
    override_fields: overrideFields,
    metadata: { parent_scope_id: opts.parentSpaceId }
  });
  return parentKey;
}

/** Drop a child's edges without creating a replacement. */
export async function clearInheritanceEdges(
  connection: Connection,
  childKey: string
): Promise<void> {
  await removeInheritanceEdges(connection, childKey);
}

/** Upsert a concept node (retrieval inputs; concepts are not derived from adapters). */
export async function upsertConcept(connection: Connection, concept: ConceptNode): Promise<void> {
  await executeStatement(
    connection,
    `MERGE (c:Concept {key: $key})
     SET c.type = 'concept', c.name = $name, c.definition = $definition,
         c.created_at = $created_at, c.updated_at = $updated_at,
         c.baseline_attributes = $baseline_attributes, c.tags = $tags, c.metadata = $metadata`,
    {
      key: concept.key,
      name: concept.name,
      definition: concept.definition,
      created_at: concept.created_at,
      updated_at: concept.updated_at,
      baseline_attributes: JSON.stringify(concept.baseline_attributes || {}),
      tags: JSON.stringify(concept.tags || []),
      metadata: JSON.stringify(concept.metadata || {})
    }
  );
}
