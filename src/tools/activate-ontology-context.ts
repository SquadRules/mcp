/**
 * Compose the scoped ontology context attached to `activate` (ADR 0047).
 *
 * Layer 3 retrieval is surfaced here as a fixed server-side projection:
 * relationships (inheritance path to root), evidence (open anomalies, pending and
 * accepted proposals, retained snapshots) and an explanation of the applied
 * evolution. No new tool exposes the graph, and no read leaves the adapter's scope.
 *
 * Activation never fails because of this projection: an unavailable graph, missing
 * adapter node, or failed read returns `null` (or a `degraded` reason) and the
 * activation result stands on its own.
 */
import type { MemoryQdrantStore } from '../services/memory/store.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { getGraphDb } from '../services/graph-db/graph-owner.js';
import { adapterGraphKey, storedAdapterScope } from '../services/graph-db/adapter-scope.js';
import type { ConceptNode } from '../services/graph-db/graph-types.js';
import {
  appliedRow,
  emptyEvidence,
  explainEvolution,
  readEvidence,
  resolveFilters
} from '../services/graph-db/ontology-context/evidence.js';
import type {
  ActivationOntologyContext,
  ExplicitActivationContext,
  OntologyRelationship,
  OntologyScopeInfo
} from '../services/graph-db/ontology-context/types.js';
import { structuredLogger } from '../utils/structured-logger.js';
import type { ActivateOutput } from './activate_schema.js';

export type {
  ActivationOntologyContext,
  ExplicitActivationContext
} from '../services/graph-db/ontology-context/types.js';

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Concept key only when the stored adapter actually declares one — never invented. */
function declaredConceptKey(adapter: {
  frontmatter?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): string | null {
  const candidate = trimmed(adapter.frontmatter?.['concept']) || trimmed(adapter.metadata?.['concept']);
  if (candidate.length === 0) return null;
  return candidate.startsWith('concept://') ? candidate : `concept://${candidate}`;
}

/** Resolve the stored scope of the top match: the child record's own space. */
async function resolveScope(
  memoryStore: MemoryQdrantStore,
  qdrantService: QdrantService | undefined,
  slug: string
): Promise<OntologyScopeInfo | null> {
  const entry = qdrantService ? await qdrantService.findFirstStepMemoryUuidBySlug(slug) : null;
  const child = entry?.layerUuid ? await memoryStore.getMemory(entry.layerUuid) : null;
  const scope = storedAdapterScope(child?.space_id, `activate-ontology:${slug}`);
  if (!scope.spaceId) return null;
  return {
    adapter_key: adapterGraphKey(scope.spaceId, slug),
    space_id: scope.spaceId,
    space_source: scope.source
  };
}

/**
 * Compose the ontology context for the top activation match.
 *
 * `null` means "no context available" (no match, no stored scope, no graph). It is a
 * graceful degradation, never an error: the caller keeps the activation result.
 */
export async function resolveActivationOntologyContext(
  memoryStore: MemoryQdrantStore,
  qdrantService: QdrantService | undefined,
  choices: ActivateOutput['choices'],
  explicit?: ExplicitActivationContext
): Promise<ActivationOntologyContext | null> {
  const slug = choices.find((c) => c.role === 'match' && c.slug)?.slug;
  if (!slug) return null;

  const graphDb = getGraphDb(memoryStore);
  if (!graphDb) return null;

  let scope: OntologyScopeInfo | null = null;
  try {
    scope = await resolveScope(memoryStore, qdrantService, slug);
  } catch (err) {
    structuredLogger.warn(
      `activate ontology: stored scope for "${slug}" unreadable (${err instanceof Error ? err.message : String(err)}) — context skipped`
    );
    return null;
  }
  if (!scope) return null;

  try {
    const adapter = await graphDb.getAdapter(scope.adapter_key);
    if (!adapter) {
      return {
        scope,
        context: resolveFilters(explicit, null),
        concept: null,
        relationships: [],
        evidence: emptyEvidence(),
        evolution: {
          current_adapter_version: null,
          current_snapshot: null,
          applied: [],
          resolution_notes: [],
          explanation: 'No graph-native snapshot is recorded for this adapter yet.'
        },
        degraded: 'adapter node not present in the graph yet (trained before graph bookkeeping)'
      };
    }

    const path = await graphDb.findPathToRoot(scope.adapter_key, 'nearest-first');
    const relationships: OntologyRelationship[] = path.map((step) => ({
      type: step.ancestor.type === 'concept' ? 'concept' : 'inherits',
      target: step.ancestor.key,
      depth: step.depth
    }));

    const conceptKey = declaredConceptKey(adapter);
    let concept: ConceptNode | null = null;
    if (conceptKey) {
      try {
        concept = await graphDb.getConcept(conceptKey);
      } catch (err) {
        structuredLogger.debug(
          `activate ontology: concept ${conceptKey} unreadable (${err instanceof Error ? err.message : String(err)})`
        );
      }
    }

    const { evidence, versions, proposals, degraded } = await readEvidence(
      graphDb,
      scope,
      slug,
      scope.adapter_key
    );
    const applied = versions.slice(0, 5).map(appliedRow);
    const accepted = proposals.filter((p) => p.status === 'accepted');
    const latest = versions[0] ?? null;

    return {
      scope,
      context: resolveFilters(explicit, adapter),
      concept: concept
        ? { key: concept.key, name: concept.name, baseline_attributes: concept.baseline_attributes ?? {} }
        : null,
      relationships,
      evidence,
      evolution: {
        current_adapter_version: latest?.adapter_version ?? adapter.version ?? null,
        current_snapshot: latest?.version_number ?? null,
        applied,
        resolution_notes: accepted.map((p) => `${p.field}: ${p.from_value ?? 'null'} -> ${p.to_value}`),
        explanation: explainEvolution(latest, applied, accepted)
      },
      degraded
    };
  } catch (err) {
    structuredLogger.warn(
      `activate ontology: context for "${slug}" failed (${err instanceof Error ? err.message : String(err)}) — continuing without it`
    );
    return null;
  }
}
