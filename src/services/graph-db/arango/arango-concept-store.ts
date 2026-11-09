/**
 * ArangoDB concept nodes (retrieval inputs; concepts are authored, not derived).
 */
import type { ArangoHttpClient } from './arango-http.js';
import type { ConceptNode } from '../graph-types.js';
import { conceptFromDoc, type ArangoDoc } from './arango-rows.js';

/** Upsert a concept node. */
export async function upsertConcept(
  client: ArangoHttpClient,
  concept: ConceptNode
): Promise<void> {
  const doc: ArangoDoc = {
    _key: concept.key,
    type: 'concept',
    name: concept.name,
    definition: concept.definition,
    created_at: concept.created_at,
    updated_at: concept.updated_at,
    baseline_attributes: concept.baseline_attributes ?? {},
    tags: concept.tags ?? [],
    metadata: concept.metadata ?? {}
  };
  await client.query('UPSERT { _key: @key } INSERT @doc UPDATE @doc IN Concept', {
    key: concept.key,
    doc
  });
}

export async function getConcept(
  client: ArangoHttpClient,
  conceptKey: string
): Promise<ConceptNode | null> {
  const rows = await client.query<ArangoDoc>(
    'FOR c IN Concept FILTER c._key == @conceptKey LIMIT 1 RETURN c',
    { conceptKey }
  );
  return rows[0] ? conceptFromDoc(rows[0]) : null;
}
