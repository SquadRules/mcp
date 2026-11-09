/**
 * Shared-backend parity for evidence-gated evolution and activate-time ontology
 * context (ADR 0046, ADR 0047) — real ArangoDB <= 3.11.
 *
 * Same explicit selection contract as `graph-db-arango-shared.test.ts`: when
 * `SQUADRULES_ARANGO_URL`/`SQUADRULES_ARANGO_DATABASE` are set the suite RUNS and
 * FAILS on any deployment or parity problem; otherwise it skips loudly and shared
 * parity stays UNPROVEN. With `SQUADRULES_ARANGO_REQUIRED=true` (the CI lane) an
 * unconfigured run FAILS instead: a required lane cannot be satisfied by a skip.
 *
 * What this pins on the shared backend:
 *
 *   1. Agent-declared `anomaly:` frontmatter persists with its scoped source child.
 *   2. A proposal is frequency-gated on three **distinct children**, not executions.
 *   3. A duplicate confirmer is one row (no manufactured quorum); distinct agents
 *      settle the proposal and the plan names the ordinary `tune`.
 *   4. Applying the plan appends snapshot 2 and records the resolution.
 *   5. `activate`'s ontology projection reads the same scoped evidence and history.
 */
import { createHash } from 'node:crypto';

import { selectSharedBackend } from './graph-db-arango-selection.js';
import {
  GraphFixture,
  adapterDoc,
  commentContract,
  loadProductionModules,
  type ProductionModules,
  type Runtime
} from './graph-db-fixture.js';
import type { ActivateOutput } from '../../src/tools/activate_schema.js';

const SELECTION = selectSharedBackend('graph-db-arango-evolution');
const SHARED_SELECTED = SELECTION.selected;
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

if (!SHARED_SELECTED) {
  // See the shared suite: a console.warn here is swallowed by a fully skipped run.
  process.stderr.write(SELECTION.skipBanner);
}

if (SELECTION.required && !SHARED_SELECTED) {
  // See the shared suite: a required lane fails with the missing names instead of
  // reporting a green file that executed nothing.
  test('the shared backend is configured because a lane requires it', () => {
    throw new Error(SELECTION.requirementMessage);
  });
}

let modules: ProductionModules;
let fixture: GraphFixture;

const SPACE = `space:it-arango-evo-${RUN}`;
const PARENT = 'shared-evo-parent';
const PARENT_URI = `squadrules://adapter/${PARENT}`;

function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function parentDoc(version: string, hasFur: string): string {
  return adapterDoc({
    slug: PARENT,
    version,
    title: 'Shared Evolution Parent',
    extraFrontmatter: { has_fur: hasFur },
    sections: [{ heading: 'Step 1', body: 'shared parent step' }],
    contract: commentContract('shared parent')
  });
}

function childDoc(slug: string, declared: boolean): string {
  return adapterDoc({
    slug,
    version: '1.0.0',
    title: `Shared Evo Child ${slug}`,
    inherits: PARENT,
    override: ['has_fur'],
    extraFrontmatter: { has_fur: 'false' },
    ...(declared
      ? { anomaly: { type: 'contradiction', field: 'has_fur', reason: `${slug} disagrees`, routes_to: PARENT } }
      : {}),
    sections: [{ heading: 'Step 1', body: `${slug} step` }],
    contract: commentContract(slug)
  });
}

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

const describeShared = SHARED_SELECTED ? describe : describe.skip;

beforeAll(async () => {
  if (!SHARED_SELECTED) return;
  modules = await loadProductionModules({
    SQUADRULES_GRAPH_BACKEND: 'arango',
    SQUADRULES_GRAPH_BACKEND_STRICT: 'true'
  });
  fixture = new GraphFixture(modules);
});

afterAll(async () => {
  if (fixture) await fixture.dispose();
});

describeShared('evidence-gated evolution on the shared backend (ADR 0046)', () => {
  let runtime: Runtime;
  const children = ['shared-evo-a', 'shared-evo-b', 'shared-evo-c'];

  beforeAll(async () => {
    runtime = await fixture.openRuntime('arango-evolution');
    await fixture.train(runtime, SPACE, parentDoc('1.0.0', 'true'));
    // Every child declares its `anomaly:` frontmatter explicitly. Frequency at proposal
    // time is counted by `distinctReportingChildren`, which reads Anomaly nodes with a
    // matching `metadata.field` — automatically detected contradictions never produce an
    // Anomaly node, so declaring all three is the only way to reach the three-children bar.
    for (const slug of children) await fixture.train(runtime, SPACE, childDoc(slug, true));
  });

  test('explicit anomaly frontmatter persists with its scoped source child', async () => {
    const anomalies = await runtime.graph.listAnomalies({ routesTo: PARENT });
    expect(anomalies).toHaveLength(children.length);
    const firstChildKey = modules.scope.adapterGraphKey(SPACE, children[0]!);
    const firstChildAnomaly = anomalies.find((row) => row.source_child === firstChildKey);
    expect(firstChildAnomaly?.anomaly_type).toBe('contradiction');
    expect(firstChildAnomaly?.source_child).toBe(firstChildKey);
    expect(firstChildAnomaly?.metadata?.['scope_space_id']).toBe(SPACE);
  });

  test('three distinct children raise the bar; two confirmations do not settle it', async () => {
    const parentKey = modules.scope.adapterGraphKey(SPACE, PARENT);
    const proposals = await runtime.graph.listProposals({ targetKey: parentKey });
    const byChild = new Map(proposals.map((row) => [row.source_child, row]));
    const third = byChild.get(modules.scope.adapterGraphKey(SPACE, children[2]!))!;
    expect(third.required_confirmations).toBe(3);
    expect(third.evidence['frequency_met']).toBe(true);
    expect((third.evidence['supporting_children'] as string[]).length).toBe(3);

    // The default subject here is deliberately distinct from the `user-it` that
    // trained the children (and therefore recorded the proposal): ADR 0046 §6 rejects
    // `self_confirmation_forbidden`, so the first two duplicate-voter confirms must come
    // from an identity that is not the proposer.
    const confirm = (distinctChild: string, userId = 'user-confirmer') =>
      fixture.onSpace(
        SPACE,
        () =>
          modules.evolution.confirmProposal(runtime.graph, {
            proposalKey: third.key,
            actorKind: 'agent',
            decision: 'confirm',
            distinctChild
          }),
        userId
      );
    await confirm(modules.scope.adapterGraphKey(SPACE, children[0]!));
    // The same runtime identity twice is still one vote and one stored row.
    await confirm(modules.scope.adapterGraphKey(SPACE, children[1]!));

    expect(await runtime.graph.listConfirmations(third.key)).toHaveLength(1);
    const duplicated = await modules.evolution.loadConsensus(runtime.graph, third.key);
    expect(duplicated!.consensus.confirming_actors).toHaveLength(1);
    expect(duplicated!.consensus.decision).toBe('pending');

    // Consensus needs three distinct children across stored rows AND two thirds of the
    // distinct agents. Rows dedupe by (proposal, actor, decision), so children[1] never
    // actually landed at line 170; agent-b confirms children[2] and agent-c confirms
    // children[1] so the three stored rows carry children[0], [2], [1] — three distinct.
    await confirm(modules.scope.adapterGraphKey(SPACE, children[2]!), 'agent-b');
    await confirm(modules.scope.adapterGraphKey(SPACE, children[1]!), 'agent-c');
    const settled = await modules.evolution.settleProposal(runtime.graph, third.key);
    expect(settled!.consensus.decision).toBe('accept');
    expect(settled!.apply_plan!.target_uri).toBe(PARENT_URI);
    expect(settled!.apply_plan!.expected_version).toBe('1.0.0');
    expect(settled!.apply_plan!.instructions).toContain('tune');
  });

  test('applying the accepted plan appends snapshot 2, then activate reads it', async () => {
    const parentKey = modules.scope.adapterGraphKey(SPACE, PARENT);
    const declined = await runtime.graph.listProposals({ targetKey: parentKey, status: 'accepted' });
    expect(declined).toHaveLength(1);

    const tuned = parentDoc('1.1.0', 'false');
    const applied = await fixture.tune(runtime, SPACE, PARENT_URI, tuned, { expectedVersion: '1.0.0' });
    expect(applied.results[0]!.status).toBe('updated');

    const latest = await runtime.graph.getLatestVersion(parentKey);
    expect(latest!.version_number).toBe('2');
    expect(latest!.parent_version).toBe('1');
    expect(latest!.content_digest).toBe(sha(tuned));

    await modules.evolution.resolveProposal(
      runtime.graph,
      declined[0]!.key,
      'applied',
      'applied via tune 1.0.0 -> 1.1.0'
    );
    expect((await runtime.graph.getProposal(declined[0]!.key))!.metadata?.['resolution']).toBe('applied');

    const ctx = await fixture.onSpace(SPACE, () =>
      modules.activateOntology.resolveActivationOntologyContext(
        runtime.memoryStore,
        runtime.qdrantService,
        [matchChoice(PARENT)],
        { task: 'review the shared adapter' }
      )
    );
    expect(ctx).not.toBeNull();
    expect(ctx!.scope.space_id).toBe(SPACE);
    expect(ctx!.scope.space_source).toBe('stored-record');
    expect(ctx!.evidence.open_anomalies).toBe(children.length);
    expect(ctx!.evidence.accepted_proposals).toBe(1);
    expect(ctx!.evolution.current_snapshot).toBe('2');
    expect(ctx!.evolution.current_adapter_version).toBe('1.1.0');
    expect(ctx!.evolution.applied[0]!.content_digest).toBe(sha(tuned));
    expect(ctx!.evolution.explanation).toContain('Snapshot 2');
    expect(ctx!.context.task).toBe('review the shared adapter');
    expect(ctx!.degraded).toBeNull();
    expect(modules.activateSchema.activateOutputSchema.shape.ontology_context.safeParse(ctx).success).toBe(
      true
    );
  });
});
