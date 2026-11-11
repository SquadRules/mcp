/**
 * The one adapter-mutation finalizer (ADR 0045 §1, ADR 0046 §6).
 *
 * WHY THIS EXISTS
 * Adapter writes reach storage through several routes — a markdown `train`, a
 * markdown `tune`, a layer/field `update`, a space-only move. Before this module
 * each route decided for itself whether to project the graph and append history,
 * and two of them decided not to. That is how a successful supported write could
 * leave the graph stale or leave no snapshot at all: not by a bug in the hook, but
 * by a route that never called it.
 *
 * So every route calls exactly this. It performs the whole derived pass over the
 * *final stored state*:
 *
 *   1. read the stored head + layers (the state a reader will now see),
 *   2. project that topology into the graph,
 *   3. reconstruct the durable stored document and append it as history,
 *   4. report anything that did not complete.
 *
 * WHY THE FINAL STATE, NOT THE REQUEST
 * A move changes the scope; a prose tune does not change the executable contract.
 * Projecting or snapshotting the *requested* document would describe something the
 * store never held. Reading back the stored record is the only way to describe what
 * the caller's next read will actually get.
 *
 * CONTRACT: this function never throws.
 * The caller's write has already been persisted. A graph failure at this point is a
 * degraded derived index, not a failed write — reporting it as a failed write would
 * invite a retry that duplicates content. Every step is therefore guarded
 * individually, so one failing step does not skip the others, and the report says
 * which ones degraded.
 */
import type { Memory } from '../../types/memory.js';
import { structuredLogger } from '../../utils/structured-logger.js';
import { adapterGraphKey, storedAdapterScope } from './adapter-scope.js';
import {
  resolveStoredAdapterLayers,
  type AdapterRecordSource
} from './adapter-graph-records.js';
import {
  projectAdapterLineage,
  reconcileAdapterGraphFromStore,
  syncAdapterGraph,
  type AdapterGraphSyncReport
} from './adapter-graph-sync.js';
import {
  reconstructStoredAdapterMarkdown,
  type SnapshotSource
} from './adapter-stored-markdown.js';
import { getGraphDb } from './graph-owner.js';
import {
  recordAdapterEvolution,
  type AdapterEvolutionReport
} from './adapter-evolution-hooks.js';
import type { GraphRepository } from './graph-repository.js';

/** Everything the finalizer needs about the write that already succeeded. */
export interface AdapterMutationInput {
  /** Store the graph is attached to (`getGraphDb` owner). */
  owner: object;
  /** Record-enumerating surface used to read the adapter's stored layers. */
  source?: AdapterRecordSource | null;
  /** Stored head layer of the adapter that was just written. */
  head: Memory;
  /**
   * Every stored layer of that adapter, when the caller already holds them.
   * Preferred: without them the finalizer tries `source`, and a reconstruction
   * that cannot see every layer would describe a different document.
   */
  layers?: Memory[] | null;
  /** Exact bytes the caller submitted. Provenance only — never the snapshot body. */
  submittedMarkdown?: string | null;
  changeType: 'created' | 'updated' | 'restored';
  reason: string;
  /** Space the adapter was moved OUT of, when this mutation was a space move. */
  movedFromSpaceId?: string | null;
}

/** What the recorded snapshot claims about the stored adapter. */
export interface AdapterSnapshotShape {
  layer_count: number;
  contract_count: number;
  reward_signal: boolean;
  boundary_complete: boolean;
}

/** Outcome of the derived pass. `graph_degraded` is the one thing to surface. */
export interface AdapterMutationReport {
  /** True when any derived step did not complete. */
  graph_degraded: boolean;
  /** What the projection actually wrote, or `null` when there was no graph. */
  projection: AdapterGraphSyncReport | null;
  history: AdapterEvolutionReport;
  /** How the history body was obtained. */
  snapshot_source: SnapshotSource | null;
  /** Digest of the history body — what a restore would reproduce. */
  content_digest: string | null;
  /** Shape of the reconstructed body, or `null` when it could not be rebuilt. */
  snapshot: AdapterSnapshotShape | null;
  /** Human-readable reasons, in the order the steps ran. */
  degradations: string[];
  /**
   * Known incompleteness of the graph after this pass. Distinct from a failed
   * step: these are consequences of what the port can express.
   */
  residuals: string[];
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Read every stored layer of the adapter the head describes.
 *
 * Returns `null` when the source cannot enumerate (no source, an unreadable
 * store): the caller must then fall back to submitted provenance rather than
 * snapshot a partially-read document.
 */
async function readStoredLayers(
  input: AdapterMutationInput,
  host: GraphRepository,
  slug: string,
  spaceId: string
): Promise<Memory[] | null> {
  if (input.layers && input.layers.length > 0) return input.layers;
  if (!input.source) return null;
  try {
    return await resolveStoredAdapterLayers(input.source, slug, spaceId);
  } catch (err) {
    structuredLogger.warn(
      `adapter finalize: could not read stored layers for "${slug}" in ${spaceId} — ${describe(err)}`
    );
    return null;
  }
  // `host` is accepted so this signature stays stable if a backend ever offers a
  // direct layer read; today the record source is the only portable surface.
  void host;
}

/**
 * Reconcile a move's source and destination scopes.
 *
 * The graph is a projection of records, so the honest repair for a move is to
 * re-project both spaces from what they now hold: the destination gains the
 * adapter, and the source loses any edge it no longer justifies. The previous
 * scope's own key is cleared explicitly because re-projection cannot remove a node
 * whose record is simply gone, and a stale inheritance edge is what a reader would
 * otherwise still traverse.
 */
async function reconcileMovedScopes(
  graphDb: GraphRepository,
  input: AdapterMutationInput,
  slug: string,
  destinationSpaceId: string,
  report: AdapterMutationReport
): Promise<void> {
  const previousSpaceId = (input.movedFromSpaceId ?? '').trim();
  if (previousSpaceId.length === 0 || previousSpaceId === destinationSpaceId) return;

  const previousKey = adapterGraphKey(previousSpaceId, slug);
  try {
    await graphDb.clearInheritanceEdges(previousKey);
  } catch (err) {
    report.graph_degraded = true;
    report.degradations.push(`previous-scope edge clear failed for ${previousKey} — ${describe(err)}`);
  }
  report.residuals.push(
    `node ${previousKey} is no longer backed by a record; the port has no node delete, so it stays until the graph is rebuilt`
  );

  if (!input.source) {
    report.graph_degraded = true;
    report.degradations.push('previous-scope re-projection skipped — no record source to enumerate it');
    return;
  }
  try {
    const reconcile = await reconcileAdapterGraphFromStore(graphDb, input.source, [
      previousSpaceId,
      destinationSpaceId
    ]);
    if (reconcile.failed.length > 0 || reconcile.edge_failures.length > 0) {
      report.graph_degraded = true;
      report.degradations.push(
        `previous-scope re-projection incomplete — failed nodes: [${reconcile.failed.join(', ')}], failed edges: [${reconcile.edge_failures.join(', ')}]`
      );
    }
  } catch (err) {
    report.graph_degraded = true;
    report.degradations.push(`previous-scope re-projection failed — ${describe(err)}`);
  }
}

/**
 * Run the whole derived pass for one successful adapter mutation.
 *
 * Never throws (see the module contract). A caller should surface
 * `graph_degraded` and `degradations` in its own result rather than fail the call.
 */
export async function finalizeAdapterMutation(
  input: AdapterMutationInput
): Promise<AdapterMutationReport> {
  const report: AdapterMutationReport = {
    graph_degraded: false,
    projection: null,
    history: {
      version: null,
      anomaly_key: null,
      proposal_keys: [],
      skipped: 'not attempted',
      no_change: false,
      change_type: null,
      snapshot_source: null,
      content_digest: null,
      degraded: []
    },
    snapshot_source: null,
    content_digest: null,
    snapshot: null,
    degradations: [],
    residuals: []
  };

  let graphDb: GraphRepository | null = null;
  try {
    graphDb = getGraphDb(input.owner);
  } catch (err) {
    report.degradations.push(`graph lookup failed — ${describe(err)}`);
  }
  if (!graphDb || !graphDb.isInitialized()) {
    report.history.skipped = 'no graph repository for this store';
    return report;
  }

  const scope = storedAdapterScope(input.head.space_id, `finalize:${input.changeType}`);
  const slug = (input.head.slug ?? input.head.adapter?.name ?? '').trim();
  if (slug.length === 0) {
    report.history.skipped = 'stored head has no adapter identity';
    report.graph_degraded = true;
    report.degradations.push('stored head carries no slug, so nothing could be projected or recorded');
    return report;
  }

  // 1. Project the final stored topology.
  try {
    const lineage = await projectAdapterLineage(graphDb, input.source ?? null, input.head, input.changeType);
    if (lineage.length === 0) {
      report.graph_degraded = true;
      report.degradations.push('projection skipped — no adapter snapshot could be built from the stored head');
    } else {
      report.projection = await syncAdapterGraph(graphDb, lineage);
      if (report.projection.failed.length > 0 || report.projection.edge_failures.length > 0) {
        report.graph_degraded = true;
        report.degradations.push(
          `projection incomplete — failed nodes: [${report.projection.failed.join(', ')}], failed edges: [${report.projection.edge_failures.join(', ')}]`
        );
      }
      if (report.projection.missing_parents.length > 0) {
        report.degradations.push(
          `parent not projected: ${report.projection.missing_parents.join(', ')}`
        );
      }
    }
  } catch (err) {
    report.graph_degraded = true;
    report.degradations.push(`projection failed — ${describe(err)}`);
  }

  // 2. A move also has a source scope to repair.
  try {
    await reconcileMovedScopes(graphDb, input, slug, scope.spaceId, report);
  } catch (err) {
    report.graph_degraded = true;
    report.degradations.push(`move reconciliation failed — ${describe(err)}`);
  }

  // 3. Reconstruct the durable stored document. This is what history records.
  const layers = await readStoredLayers(input, graphDb, slug, scope.spaceId);
  const reconstructed = layers ? reconstructStoredAdapterMarkdown(layers) : null;
  const snapshotSource: SnapshotSource = reconstructed ? 'stored-state' : 'submitted';
  const content = reconstructed?.markdown ?? input.submittedMarkdown ?? '';
  if (content.trim().length === 0) {
    report.history.skipped = 'no durable content available to snapshot';
    report.graph_degraded = true;
    report.degradations.push(
      'history skipped — the stored layers were unreadable and the caller supplied no submitted document'
    );
    return report;
  }
  if (!reconstructed) {
    report.degradations.push(
      `history body is the submitted document, not the reconstructed stored state (no layer read possible for "${slug}")`
    );
  }
  report.snapshot_source = snapshotSource;
  report.content_digest = reconstructed?.digest ?? null;
  if (reconstructed) {
    report.snapshot = {
      layer_count: reconstructed.layer_count,
      contract_count: reconstructed.contract_count,
      reward_signal: reconstructed.reward_signal,
      boundary_complete: reconstructed.boundary_complete
    };
    if (!reconstructed.boundary_complete) {
      // The body cannot re-parse into the same layer split, so a restore would activate
      // different text than the records the snapshot claims to describe.
      report.graph_degraded = true;
      report.degradations.push(
        `snapshot body is not layer-exact (${reconstructed.layer_count} layers, ${reconstructed.contract_count} gates) — a restore would see a different split`
      );
    }
  }

  // 4. Append history. `recordAdapterEvolution` never throws; it reports.
  try {
    report.history = await recordAdapterEvolution({
      owner: input.owner,
      head: input.head,
      markdown: content,
      submittedMarkdown: input.submittedMarkdown ?? null,
      snapshotSource,
      source: input.source ?? null,
      changeType: input.changeType,
      reason: input.reason
    });
    // `no_change` is not a degradation: the durable bytes already are the head snapshot,
    // which is the honest outcome of a second pass over an unchanged write.
    if (report.history.skipped && !report.history.no_change) report.graph_degraded = true;
    if (report.history.degraded.length > 0) {
      report.graph_degraded = true;
      report.degradations.push(...report.history.degraded);
    }
  } catch (err) {
    // Unreachable by contract; kept so a future regression degrades instead of throwing.
    report.graph_degraded = true;
    report.history = { ...report.history, skipped: describe(err) };
    report.degradations.push(`history pass failed — ${describe(err)}`);
  }

  if (report.degradations.length > 0) {
    structuredLogger.warn(
      `adapter finalize: ${slug} (${scope.spaceId}) degraded — ${report.degradations.join('; ')}`
    );
  }
  return report;
}
