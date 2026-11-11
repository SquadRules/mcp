/**
 * Bounded evidence windows in the activate-time ontology context (gap G11) — real
 * LadybugDB, real LanceDB, real `train`, real projection. No mocks or fakes.
 *
 * What this suite pins:
 *
 *   1. The anomaly scope is a predicate of the query, not a filter applied to its
 *      result. That ordering is the whole point: the anomaly table is one shared
 *      stream, so a scope applied after the `LIMIT` lets foreign-scope rows occupy
 *      the window a scoped read is entitled to. A scoped read is asked for with a
 *      limit smaller than the number of competing rows, so only in-query filtering
 *      returns the local record at all.
 *   2. An unbounded local read still reports `*_truncated: false`: the flag is a
 *      fact about the window, not a constant.
 *   3. A count that filled its window is a floor, and says so: the anomaly, proposal
 *      and version reads each travel with their window size and a truncation flag,
 *      and the evolution prose inherits the truncation instead of stating a total
 *      the read never established.
 */
import {
  GraphFixture,
  adapterDoc,
  commentContract,
  loadProductionModules,
  type ProductionModules,
  type Runtime
} from './graph-db-fixture.js';
import type { ActivateOutput } from '../../src/tools/activate_schema.js';
import type {
  AnomalyNode,
  EvolutionProposalNode
} from '../../src/services/graph-db/graph-types.js';

const SPACE = 'space:it-window-local';
const FOREIGN = 'group:it-window-foreign';
const PARENT = 'win-parent';

/** Anomaly window `readEvidence` reads, mirrored so the fixtures can fill it. */
const ANOMALY_WINDOW = 200;
/** Proposal window `readEvidence` reads. */
const PROPOSAL_WINDOW = 50;
/** History window `readEvidence` reads. */
const VERSION_WINDOW = 20;
/** Retained snapshots `evolution.applied` lists. */
const APPLIED_WINDOW = 5;

let modules: ProductionModules;
let fixture: GraphFixture;

type ActivationContext = NonNullable<
  Awaited<ReturnType<ProductionModules['activateOntology']['resolveActivationOntologyContext']>>
>;

function parentDoc(): string {
  return adapterDoc({
    slug: PARENT,
    version: '1.0.0',
    title: 'Window Parent',
    extraFrontmatter: { has_fur: 'true' },
    sections: [{ heading: 'Step 1', body: 'parent step' }],
    contract: commentContract('parent')
  });
}

/** One match choice: the exact shape `executeActivate` hands to the projection. */
function matchChoice(slug: string): ActivateOutput['choices'][number] {
  return {
    uri: `squadrules://adapter/${slug}`,
    label: slug,
    adapter_name: slug,
    activation_score: 0.9,
    tags: [],
    next_action: `call forward with squadrules://adapter/${slug}`,
    adapter_version: '1.0.0',
    space_name: null,
    slug,
    role: 'match',
    forward_first_call: { uri: `squadrules://adapter/${slug}` }
  };
}

/** Real projection call under the real tenant context for `spaceId`. */
async function resolveContext(
  runtime: Runtime,
  spaceId: string,
  slug: string
): Promise<ActivationContext> {
  const context = await fixture.onSpace(spaceId, () =>
    modules.activateOntology.resolveActivationOntologyContext(
      runtime.memoryStore,
      runtime.qdrantService,
      [matchChoice(slug)]
    )
  );
  if (!context) throw new Error(`no activation context for ${slug} in ${spaceId}`);
  return context;
}

/** ISO timestamp `index` seconds after `base`, so ordering is explicit, not clock-based. */
function at(baseYear: number, index: number): string {
  return new Date(Date.UTC(baseYear, 0, 1) + index * 1000).toISOString();
}

/**
 * One stored anomaly attributed to `scope` the way the write path records it:
 * the scope lives in `metadata.scope_space_id`, and `routes_to` is the shared slug,
 * so scope is the only thing that distinguishes a local row from a foreign one.
 */
function anomalyRecord(key: string, scope: string, createdAt: string): AnomalyNode {
  return {
    key,
    type: 'Anomaly',
    discovered_by: PARENT,
    routes_to: PARENT,
    description: `${key} description`,
    created_at: createdAt,
    severity: 'medium',
    anomaly_type: 'contradiction',
    status: 'open',
    metadata: { scope_space_id: scope, scope_source: 'stored-record' }
  };
}

/** One pending proposal recorded against the parent's scoped key. */
function proposalRecord(index: number, adapterKey: string): EvolutionProposalNode {
  return {
    key: `window-proposal-${index}`,
    type: 'proposal',
    target_key: adapterKey,
    target_slug: PARENT,
    space: SPACE,
    change_type: 'parent_update',
    field: 'has_fur',
    from_value: 'true',
    to_value: 'false',
    reason: `window fill ${index}`,
    source_child: modules.scope.adapterGraphKey(SPACE, 'window-child'),
    evidence: { index },
    evidence_digest: `digest-${index}`,
    status: 'proposed',
    created_at: at(2020, index),
    created_by: 'user-it',
    actor_source: 'runtime-local',
    required_confirmations: 1
  };
}

beforeAll(async () => {
  modules = await loadProductionModules();
  fixture = new GraphFixture(modules);
});

afterAll(async () => {
  await fixture.dispose();
});

describe('the anomaly scope is applied inside the query (G11 §1–2)', () => {
  let runtime: Runtime;

  beforeAll(async () => {
    runtime = await fixture.openRuntime('window-scope');
    await fixture.train(runtime, SPACE, parentDoc());
    // The local row is the OLDEST one. A scope applied after `LIMIT` would keep the
    // newest rows — all foreign — and lose the local evidence entirely.
    await runtime.graph.createAnomaly(anomalyRecord('local-anomaly', SPACE, at(2019, 0)));
    for (let i = 0; i < 3; i += 1) {
      await runtime.graph.createAnomaly(
        anomalyRecord(`foreign-anomaly-${i}`, FOREIGN, at(2020, i))
      );
    }
  }, 60000);

  test('a scoped read with a limit inside the competing rows still returns the local one', async () => {
    // Two rows fit the limit and three foreign rows are newer than the local one, so
    // an unscoped read returns two foreign rows and nothing else.
    const scoped = await runtime.graph.listAnomalies({
      routesTo: PARENT,
      scopeSpaceId: SPACE,
      limit: 2
    });
    expect(scoped.map((row) => row.key)).toEqual(['local-anomaly']);

    // The scope never widened or narrowed the unscoped read: absent means the old
    // behaviour, all four rows regardless of where they were recorded.
    const unscoped = await runtime.graph.listAnomalies({ routesTo: PARENT, limit: 10 });
    expect(unscoped).toHaveLength(4);
    expect(unscoped.map((row) => row.key).sort()).toEqual([
      'foreign-anomaly-0',
      'foreign-anomaly-1',
      'foreign-anomaly-2',
      'local-anomaly'
    ]);
  });

  test('an unfilled window is reported as complete, not as a truncated one', async () => {
    const context = await resolveContext(runtime, SPACE, PARENT);

    expect(context.evidence.open_anomalies).toBe(1);
    // Nothing was cut off: with four rows in the table the flag stays false, so the
    // flag is evidence about the window rather than a constant.
    expect(context.evidence.open_anomalies_truncated).toBe(false);
    expect(context.evidence.anomaly_window).toBe(ANOMALY_WINDOW);
    expect(context.evidence.anomalies.map((row) => row.detail)).toEqual([
      'medium: local-anomaly description'
    ]);
  });
});

describe('a capped read reports its window instead of an exhaustive total (G11 §2)', () => {
  let runtime: Runtime;
  let adapterKey: string;

  beforeAll(async () => {
    runtime = await fixture.openRuntime('window-full');
    await fixture.train(runtime, SPACE, parentDoc());
    adapterKey = modules.scope.adapterGraphKey(SPACE, PARENT);

    // Anomalies: one row past the window in the local scope, plus the same number of
    // foreign rows that are NEWER. A read that filtered after the limit would return
    // only foreign rows; a read that filters in the query fills the local window.
    for (let i = 0; i < ANOMALY_WINDOW + 1; i += 1) {
      await runtime.graph.createAnomaly(
        anomalyRecord(`local-anomaly-${i}`, SPACE, at(2020, i))
      );
    }
    for (let i = 0; i < ANOMALY_WINDOW + 1; i += 1) {
      await runtime.graph.createAnomaly(
        anomalyRecord(`foreign-anomaly-${i}`, FOREIGN, at(2021, i))
      );
    }

    // Proposals: one past the proposal window, all pending for this scoped adapter.
    for (let i = 0; i < PROPOSAL_WINDOW + 1; i += 1) {
      await runtime.graph.createProposal(proposalRecord(i, adapterKey));
    }

    // Snapshots: `train` wrote version 1, so one past the version window in total.
    for (let i = 1; i <= VERSION_WINDOW; i += 1) {
      await runtime.graph.appendVersion({
        adapterKey,
        slug: PARENT,
        adapterVersion: `1.0.${i}`,
        space: SPACE,
        changeType: 'updated',
        reason: `window fill ${i}`,
        content: `${parentDoc()}\n<!-- snapshot ${i} -->`,
        metadataSnapshot: { snapshot: i },
        actor: { actor: 'user-it', actor_source: 'runtime-local' }
      });
    }
  }, 120000);

  test('foreign-scope anomalies fill no part of the local anomaly window', async () => {
    const context = await resolveContext(runtime, SPACE, PARENT);

    expect(context.evidence.open_anomalies).toBe(ANOMALY_WINDOW);
    expect(context.evidence.open_anomalies_truncated).toBe(true);
    expect(context.evidence.anomaly_window).toBe(ANOMALY_WINDOW);
    // Every listed row is local: the 201 newer foreign rows consumed nothing.
    expect(context.evidence.anomalies).toHaveLength(5);
    for (const row of context.evidence.anomalies) {
      expect(row.detail).toContain('local-anomaly-');
    }
  }, 60000);

  test('a proposal count that filled its window is a floor', async () => {
    const context = await resolveContext(runtime, SPACE, PARENT);

    expect(context.evidence.pending_proposals).toBe(PROPOSAL_WINDOW);
    expect(context.evidence.pending_proposals_truncated).toBe(true);
    expect(context.evidence.proposal_window).toBe(PROPOSAL_WINDOW);
    // Zero accepted proposals is likewise read from a filled window, so it is a floor
    // of zero — there may be accepted proposals the read never reached.
    expect(context.evidence.accepted_proposals).toBe(0);
    expect(context.evidence.accepted_proposals_truncated).toBe(true);
    expect(context.evidence.proposals).toHaveLength(5);
  }, 60000);

  test('a version count that filled its window says the history continues', async () => {
    const context = await resolveContext(runtime, SPACE, PARENT);

    expect(context.evidence.version_snapshots).toBe(VERSION_WINDOW);
    expect(context.evidence.version_snapshots_truncated).toBe(true);
    expect(context.evidence.version_window).toBe(VERSION_WINDOW);

    // The head is still exact: it is the newest row, which the window contains.
    expect(context.evolution.current_snapshot).toBe(String(VERSION_WINDOW + 1));
    expect(context.evolution.current_adapter_version).toBe(`1.0.${VERSION_WINDOW}`);
    expect(context.evolution.applied).toHaveLength(APPLIED_WINDOW);
    expect(context.evolution.applied_window).toBe(APPLIED_WINDOW);
    expect(context.evolution.applied_truncated).toBe(true);
    // The prose inherits the truncation: four is what `applied` lists, not the total.
    expect(context.evolution.explanation).toContain('at least 4 earlier snapshot(s)');

    // The bounded window is part of the declared `activate` output surface.
    const parsed = modules.activateSchema.activateOutputSchema.shape.ontology_context.safeParse(
      context
    );
    expect(parsed.success).toBe(true);
  }, 60000);
});
