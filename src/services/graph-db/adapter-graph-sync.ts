/**
 * Adapter graph projection — services layer (SquadRules 6, Touchpoint 3).
 *
 * WHY HERE
 * The graph is a *derived projection* of adapter records: the vector store owns the
 * content, the graph owns the inheritance topology. Anything that projects one onto
 * the other therefore belongs in the services layer, next to both. Resources and
 * tools call into it; they never implement it, and `src/resources/**` never imports
 * from `src/tools/**`.
 *
 * WHAT IT PROJECTS FROM
 * Snapshots come from `adapter-graph-records.ts`, which builds them from **stored
 * layer records**, not from bundled markdown: a record exists only when the write
 * succeeded, so a failed write can never leave a node (or an edge) behind. This module
 * consumes those snapshots and writes the topology.
 *
 * ORDERING
 * Nodes first, edges second, in two passes. The node pass cannot fail because a
 * parent is missing, and the edge pass sees every node the node pass created — so a
 * child enumerated before its parent is still linked. Per-adapter node failures are
 * collected and their edges skipped: no edge ever points at a node that was not
 * written. Edge reconciliation runs for **every** written node, including one that
 * declares no `inherits`: that is what clears an edge the record has stopped
 * declaring. Edge failures are collected separately (`edge_failures`) instead of
 * escaping the function — the documented "never throws" contract covers parent
 * resolution and edge clearing too, not just the edge write.
 *
 * SCOPE
 * Parent lookup goes through `parentScopeCandidates` — the single policy every caller
 * shares — and the resolved parent scope is recorded on the edge. The graph never
 * guesses `personal`.
 *
 * HISTORY
 * Topology (who inherits from whom, and the frontmatter that produced it) is
 * rebuildable from records. Graph-native history — `Anomaly` nodes written by
 * `reward` — is NOT reconstructible from memory content and is not projected here.
 */
import type { Memory } from '../../types/memory.js';
import { adapterGraphKey, parentScopeCandidates } from './adapter-scope.js';
import { SQUADRULES_APP_SPACE_ID } from '../../config.js';
import { structuredLogger } from '../../utils/structured-logger.js';
import type { GraphRepository } from './graph-repository.js';
import {
  resolveStoredParentSnapshot,
  snapshotFromLayers,
  snapshotsFromRecords,
  type AdapterRecordSource,
  type StoredAdapterSnapshot
} from './adapter-graph-records.js';

/** Outcome of one projection pass. Counts are of adapters actually written. */
export interface AdapterGraphSyncReport {
  adapters: number;
  nodes: number;
  edges: number;
  /** `child -> parent` pairs whose parent node does not exist in any candidate scope. */
  missing_parents: string[];
  /** Slugs whose node write failed; their edges are skipped. */
  failed: string[];
  /** `child -> parent` pairs whose edge reconciliation threw; the old edge may remain. */
  edge_failures: string[];
  /** True when there was no graph to project into (disabled, failed open, detached). */
  skipped: boolean;
}

const EMPTY_REPORT: AdapterGraphSyncReport = {
  adapters: 0,
  nodes: 0,
  edges: 0,
  missing_parents: [],
  failed: [],
  edge_failures: [],
  skipped: false
};

/** Upper bound on a stored ancestry walk; a cycle or a very deep chain fails closed. */
const MAX_ANCESTRY_DEPTH = 32;

/**
 * Project snapshots into the graph: every node first, then every edge.
 *
 * Never throws: a failing node write is recorded in `failed` (its edges are
 * skipped), and a failing parent resolution/edge clear/edge write is recorded in
 * `edge_failures`. Both failure kinds are reported to the caller rather than
 * swallowed, so a projection result is truthful instead of merely quiet.
 */
export async function syncAdapterGraph(
  graphDb: GraphRepository | null | undefined,
  snapshots: StoredAdapterSnapshot[]
): Promise<AdapterGraphSyncReport> {
  if (!graphDb || !graphDb.isInitialized() || snapshots.length === 0) {
    return { ...EMPTY_REPORT, adapters: snapshots.length, skipped: !graphDb || !graphDb.isInitialized() };
  }

  const report: AdapterGraphSyncReport = {
    adapters: snapshots.length,
    nodes: 0,
    edges: 0,
    missing_parents: [],
    failed: [],
    edge_failures: [],
    skipped: false
  };

  // Pass 1 — nodes only.
  const written = new Map<string, StoredAdapterSnapshot>();
  for (const snapshot of snapshots) {
    try {
      await graphDb.upsertAdapterFromFrontmatter(snapshot.slug, snapshot.version, snapshot.frontmatter, {
        spaceId: snapshot.scope.spaceId,
        ...(snapshot.title !== undefined && { title: snapshot.title }),
        ...(snapshot.layerCount !== undefined && { layerCount: snapshot.layerCount })
      });
      written.set(adapterGraphKey(snapshot.scope.spaceId, snapshot.slug), snapshot);
      report.nodes++;
    } catch (err) {
      report.failed.push(snapshot.slug);
      structuredLogger.warn(
        `graph sync: node write failed for "${snapshot.slug}" (scope ${snapshot.scope.spaceId}) — ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  // Pass 2 — edges only, for adapters whose node landed. This runs for EVERY
  // written adapter, including one with no `inherits`: reconciling the edge set is
  // how a removed parent declaration clears the edge the record used to have.
  for (const [childKey, snapshot] of written) {
    const parentSlug = snapshot.frontmatter.inherits;
    try {
      if (!parentSlug) {
        // `writeInheritanceEdges` clears first and returns null for a plain adapter.
        await graphDb.writeInheritanceEdges(childKey, snapshot.frontmatter, {
          parentSpaceId: snapshot.scope.spaceId
        });
        continue;
      }

      const parentSpaceId = await resolveParentScope(graphDb, parentSlug, snapshot.scope.spaceId);
      if (!parentSpaceId) {
        // The stored record names a parent that is not projected (yet). Clear any edge
        // left by an earlier projection so the graph never keeps topology the record
        // has stopped declaring.
        await graphDb.clearInheritanceEdges(childKey);
        report.missing_parents.push(`${snapshot.slug} -> ${parentSlug}`);
        continue;
      }
      const linked = await graphDb.writeInheritanceEdges(childKey, snapshot.frontmatter, { parentSpaceId });
      if (linked) report.edges++;
    } catch (err) {
      const pair = `${snapshot.slug} -> ${parentSlug ?? '(none)'}`;
      report.edge_failures.push(pair);
      structuredLogger.warn(
        `graph sync: edge reconciliation failed for "${pair}" — ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  return report;
}

/**
 * Resolve which scope a parent adapter node lives in: the child's own scope first,
 * then the app space (bundled, read-only content every space can inherit from).
 * Returns `null` when the parent node exists in neither.
 */
export async function resolveParentScope(
  graphDb: GraphRepository,
  parentSlug: string,
  childSpaceId: string
): Promise<string | null> {
  for (const candidate of parentScopeCandidates(childSpaceId)) {
    const node = await graphDb.getAdapter(adapterGraphKey(candidate, parentSlug));
    if (node) return candidate;
  }
  return null;
}

/**
 * Reconcile the graph from the records actually stored in the given spaces.
 *
 * This is the boot recovery path: it reads the store (so version-skipped adapters
 * are included, and adapters whose write failed are not) and re-projects topology.
 * It never writes to memory content, so a lost graph cannot corrupt the store.
 *
 * @param graphDb  - the graph owned by this runtime; `null` makes this a no-op
 * @param source   - the store to enumerate
 * @param spaceIds - spaces to walk. Callers pass the space(s) they legitimately own
 *                   (boot passes the injected app space) — never an arbitrary scan.
 */
export async function reconcileAdapterGraphFromStore(
  graphDb: GraphRepository | null | undefined,
  source: AdapterRecordSource,
  spaceIds: string[]
): Promise<AdapterGraphSyncReport> {
  if (!graphDb || !graphDb.isInitialized()) {
    return { ...EMPTY_REPORT, skipped: true };
  }

  const snapshots: StoredAdapterSnapshot[] = [];
  for (const spaceId of spaceIds) {
    try {
      const records = await source.scrollSpace(spaceId, { paginate: true });
      snapshots.push(...snapshotsFromRecords(records, `boot:${spaceId}`));
    } catch (err) {
      structuredLogger.warn(
        `graph sync: could not read space "${spaceId}" (${err instanceof Error ? err.message : String(err)}) — skipping it`
      );
    }
  }

  const report = await syncAdapterGraph(graphDb, snapshots);
  structuredLogger.debug(
    `graph sync: ${report.nodes} node(s), ${report.edges} edge(s), ${report.missing_parents.length} missing parent(s), ${report.failed.length} failed node(s), ${report.edge_failures.length} failed edge(s) (spaces: ${spaceIds.join(', ') || 'none'})`
  );
  return report;
}

/**
 * Project one just-written adapter **and its stored ancestry** into the graph.
 *
 * The child's snapshot must not be the first thing the edge pass sees: its parent
 * node has to exist before the edge can resolve. Walking the stored ancestry
 * root-first and projecting parent snapshots before the child makes a fresh
 * `parent` train followed immediately by a `child` train discoverable without a
 * reboot.
 *
 * Returns every snapshot in projection order (root first, child last), or an empty
 * array when the write's head could not be read back. Never throws: a missing
 * ancestor is simply absent from the returned list and the caller's projection
 * reports it as a missing parent.
 *
 * `source` may be omitted by a caller that has no record-enumerating surface (the CLI
 * and HTTP tune paths). The head snapshot is then projected on its own — the node is
 * still written and its edges are still reconciled against whatever parent node the
 * graph already holds.
 */
export async function projectAdapterLineage(
  graphDb: GraphRepository | null | undefined,
  source: AdapterRecordSource | null | undefined,
  head: Memory,
  context: string
): Promise<StoredAdapterSnapshot[]> {
  if (!graphDb || !graphDb.isInitialized()) return [];

  const headSnapshot = snapshotFromLayers([head], context);
  if (!headSnapshot) return [];

  const lineage: StoredAdapterSnapshot[] = [headSnapshot];
  const seen = new Set<string>([headSnapshot.slug]);
  let current = headSnapshot;

  for (let depth = 0; source && depth < MAX_ANCESTRY_DEPTH; depth++) {
    const parentSlug = current.frontmatter.inherits;
    if (!parentSlug) break;
    if (seen.has(parentSlug)) {
      structuredLogger.warn(
        `graph sync: inheritance cycle detected while projecting "${headSnapshot.slug}" (repeated "${parentSlug}") — stopping the ancestry walk`
      );
      break;
    }
    const parent = await resolveStoredParentSnapshot(source, parentSlug, current.scope.spaceId);
    if (!parent) break;
    seen.add(parentSlug);
    lineage.push(parent.snapshot);
    current = parent.snapshot;
  }

  // Root first so every parent node exists before the child edge is reconciled.
  lineage.reverse();
  return lineage;
}

/** The app space is the only space boot reconciliation may assume on its own. */
export function defaultReconcileSpaceIds(): string[] {
  return [SQUADRULES_APP_SPACE_ID];
}
