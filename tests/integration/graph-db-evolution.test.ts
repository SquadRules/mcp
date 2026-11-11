/**
 * Evidence-gated evolution (ADR 0046) — real LadybugDB, real LanceDB, real
 * `train` / `tune` paths. No mocks, stubs or module fakes.
 *
 * What this suite pins:
 *
 *   1. Explicit `anomaly:` frontmatter on a trained document is persisted as an
 *      `Anomaly` node with the scoped child as `source_child`, and the parent is
 *      left untouched.
 *   2. Automatic detection is limited to what is deterministic: a disagreeing
 *      primitive domain property and an exactly opposing Must Always / Must Never
 *      statement. Nothing here hashes prose and calls it verified.
 *   3. Frequency is three or more **distinct children**, not executions.
 *   4. A duplicate confirmer never makes quorum; distinct agents do.
 *   5. Acceptance hands back a plan naming the ordinary `tune` and the observed
 *      `expected_version`, and applying it is a validated write that appends history.
 *   6. A parent change that would invalidate a stored descendant fails closed
 *      before anything is written — no partial parent, no history row.
 */

import {
  GraphFixture,
  adapterDoc,
  commentContract,
  loadProductionModules,
  type ProductionModules,
  type Runtime
} from './graph-db-fixture.js';

const SPACE = 'space:it-evolution';
const PARENT = 'evo-parent';
const PARENT_URI = `squadrules://adapter/${PARENT}`;

let modules: ProductionModules;
let fixture: GraphFixture;

/** Parent adapter; `fields` are the domain properties children may contradict. */
function parentDoc(fields: Record<string, string> = {}, rules?: string, stepBody = 'parent step'): string {
  return adapterDoc({
    slug: PARENT,
    version: '1.0.0',
    title: 'Evolution Parent',
    extraFrontmatter: fields,
    sections: [
      ...(rules ? [{ heading: 'Policy', body: rules }] : []),
      { heading: 'Step 1', body: stepBody }
    ],
    contract: commentContract('parent')
  });
}

interface ChildOptions {
  fields?: Record<string, string>;
  rules?: string;
  /** Emit an agent-declared `anomaly:` block reporting this parent field. */
  anomalyField?: string;
}

/** Child adapter that inherits the parent and may contradict it. */
function childDoc(slug: string, options: ChildOptions = {}): string {
  const fields = options.fields ?? {};
  return adapterDoc({
    slug,
    version: '1.0.0',
    title: `Evolution Child ${slug}`,
    inherits: PARENT,
    override: Object.keys(fields),
    extraFrontmatter: fields,
    ...(options.anomalyField
      ? {
          anomaly: {
            type: 'contradiction',
            field: options.anomalyField,
            reason: `${slug} disagrees with ${PARENT}`,
            routes_to: PARENT
          }
        }
      : {}),
    sections: [
      ...(options.rules ? [{ heading: 'Policy', body: options.rules }] : []),
      { heading: 'Step 1', body: `${slug} step` }
    ],
    contract: commentContract(slug)
  });
}

beforeAll(async () => {
  modules = await loadProductionModules();
  fixture = new GraphFixture(modules);
});

afterAll(async () => {
  await fixture.dispose();
});

describe('explicit anomaly frontmatter (ADR 0046 §1)', () => {
  test('is persisted with its scoped source child and never mutates the parent', async () => {
    const runtime: Runtime = await fixture.openRuntime('anomaly');
    await fixture.train(runtime, SPACE, parentDoc({ has_fur: 'true' }));
    await fixture.train(runtime, SPACE, childDoc('anomaly-child', { anomalyField: 'has_fur' }));

    const anomalies = await runtime.graph.listAnomalies({ routesTo: PARENT });
    expect(anomalies).toHaveLength(1);
    const anomaly = anomalies[0]!;
    expect(anomaly.anomaly_type).toBe('contradiction');
    expect(anomaly.status).toBe('open');
    expect(anomaly.description).toBe('anomaly-child disagrees with evo-parent');
    // The unique source child is the scoped identity, not a free-text name.
    expect(anomaly.source_child).toBe(modules.scope.adapterGraphKey(SPACE, 'anomaly-child'));
    expect(anomaly.metadata?.['field']).toBe('has_fur');
    expect(anomaly.metadata?.['scope_space_id']).toBe(SPACE);

    // Recording an anomaly is not a resolution: the parent keeps its version and bytes.
    const parentKey = modules.scope.adapterGraphKey(SPACE, PARENT);
    const parentHistory = await runtime.graph.listVersions(parentKey);
    expect(parentHistory).toHaveLength(1);
    expect(parentHistory[0]!.change_type).toBe('created');
  });
});

describe('deterministic detection only (ADR 0046 §2)', () => {
  test('a disagreeing primitive property and an opposing rule each raise a proposal', async () => {
    const runtime = await fixture.openRuntime('detection');
    await fixture.train(runtime, SPACE, parentDoc({ has_fur: 'true' }, '**Must Always:**\n\n- greet politely'));
    await fixture.train(
      runtime,
      SPACE,
      childDoc('detect-child', { fields: { has_fur: 'false' }, rules: '**Must Never:**\n\n- greet politely' })
    );

    const parentKey = modules.scope.adapterGraphKey(SPACE, PARENT);
    const proposals = await runtime.graph.listProposals({ targetKey: parentKey });
    const property = proposals.find((row) => row.field === 'has_fur');
    expect(property).toBeDefined();
    expect(property!.from_value).toBe('true');
    expect(property!.to_value).toBe('false');
    expect(property!.source_child).toBe(modules.scope.adapterGraphKey(SPACE, 'detect-child'));
    expect(property!.required_confirmations).toBe(1);
    // A digest proves the evidence bytes, never the claim inside them.
    expect(property!.evidence_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(property!.evidence['detected_from']).toBe('frontmatter-primitives-and-rule-statements');

    const rule = proposals.find((row) => row.field === 'must_always');
    expect(rule).toBeDefined();
    expect(rule!.from_value).toBe('must always: greet politely');
    expect(rule!.to_value).toBe('must never: greet politely');

    // No free-text detector ran: the child body sentence matched no rule heading.
    expect(proposals.filter((row) => row.field === 'must_never')).toHaveLength(0);
  });
});

describe('frequency is distinct children, consensus is distinct agents (ADR 0046 §4–5)', () => {
  test('the third distinct child raises the bar to three confirmations', async () => {
    const runtime = await fixture.openRuntime('frequency');
    await fixture.train(runtime, SPACE, parentDoc({ has_fur: 'true' }));

    const children = ['freq-a', 'freq-b', 'freq-c'];
    for (const slug of children) {
      await fixture.train(runtime, SPACE, childDoc(slug, { fields: { has_fur: 'false' }, anomalyField: 'has_fur' }));
    }

    const parentKey = modules.scope.adapterGraphKey(SPACE, PARENT);
    const proposals = await runtime.graph.listProposals({ targetKey: parentKey });
    const byChild = new Map(proposals.map((row) => [row.source_child, row]));
    const third = byChild.get(modules.scope.adapterGraphKey(SPACE, 'freq-c'))!;

    expect(third.required_confirmations).toBe(3);
    expect(third.evidence['frequency_met']).toBe(true);
    expect((third.evidence['supporting_children'] as string[]).length).toBe(3);
    // The first child alone did not meet the bar.
    expect(byChild.get(modules.scope.adapterGraphKey(SPACE, 'freq-a'))!.required_confirmations).toBe(1);

    // Duplicate confirmer: the same runtime identity confirming twice is one vote,
    // and the second confirmation is a no-op rather than a second record. The identity
    // here is deliberately different from the `user-it` that trained the children and
    // therefore created the proposal: ADR 0046 §6 forbids a proposer from confirming
    // their own change, so `confirm` uses a distinct default subject.
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
    await confirm(modules.scope.adapterGraphKey(SPACE, 'freq-a'));
    await confirm(modules.scope.adapterGraphKey(SPACE, 'freq-b'));

    const duplicated = await modules.evolution.loadConsensus(runtime.graph, third.key);
    expect(duplicated!.consensus.confirming_actors).toHaveLength(1);
    expect(duplicated!.consensus.decision).toBe('pending');
    expect(await runtime.graph.listConfirmations(third.key)).toHaveLength(1);

    // Consensus requires both three distinct children reporting the anomaly AND two
    // thirds of the required distinct agents. Rows are deduped by (proposal, actor,
    // decision), so freq-b never actually landed at line 192; the two new agents use
    // freq-c and freq-b so three distinct children appear across the three stored rows.
    await confirm(modules.scope.adapterGraphKey(SPACE, 'freq-c'), 'agent-b');
    await confirm(modules.scope.adapterGraphKey(SPACE, 'freq-b'), 'agent-c');

    const settled = await modules.evolution.settleProposal(runtime.graph, third.key);
    expect(settled!.consensus.decision).toBe('accept');
    expect(settled!.proposal.status).toBe('accepted');
    const plan = settled!.apply_plan!;
    expect(plan.target_uri).toBe(PARENT_URI);
    expect(plan.expected_version).toBe('1.0.0');
    expect(plan.instructions).toContain('expected_version 1.0.0');
    expect(plan.instructions).toContain('tune');

    // Applying the plan is a normal validated write that appends history.
    const applied = await fixture.tune(runtime, SPACE, PARENT_URI, parentDoc({ has_fur: 'false' }), {
      expectedVersion: plan.expected_version!
    });
    expect(applied.results[0]!.status).toBe('updated');

    const latest = await runtime.graph.getLatestVersion(parentKey);
    expect(latest!.version_number).toBe('2');
    expect(latest!.change_type).toBe('updated');
    expect(latest!.reason).toBe('tune: adapter markdown updated');

    // Resolution is recorded on the proposal, so the history and the record agree.
    await modules.evolution.resolveProposal(runtime.graph, third.key, 'applied', 'applied via tune 1.0.0 -> 2');
    const resolved = await runtime.graph.getProposal(third.key);
    expect(resolved!.metadata?.['resolution']).toBe('applied');
    expect(resolved!.metadata?.['resolution_note']).toContain('applied via tune');

    // The descendants still resolve: the field they override is still declared, and
    // the projection preserved the primitive as a boolean rather than a string.
    const parentNode = await runtime.graph.getAdapter(parentKey);
    expect(parentNode!.frontmatter?.['has_fur']).toBe(false);
  });
});

describe('descendant validation gates the parent change (ADR 0046 §6)', () => {
  test('a change that would invalidate a child writes nothing', async () => {
    const runtime = await fixture.openRuntime('descendants');
    await fixture.train(runtime, SPACE, parentDoc({ has_fur: 'true' }));
    await fixture.train(runtime, SPACE, childDoc('desc-child', { fields: { has_fur: 'false' } }));

    const parentKey = modules.scope.adapterGraphKey(SPACE, PARENT);
    const before = await runtime.graph.listVersions(parentKey);
    expect(before).toHaveLength(1);

    // Dropping `has_fur` would make the child's `override: [has_fur]` invalid.
    const rejected = await fixture.tune(runtime, SPACE, PARENT_URI, parentDoc(), {
      expectedVersion: '1.0.0'
    });
    expect(rejected.results[0]!.status).toBe('error');
    expect(rejected.results[0]!.message).toContain('DESCENDANT_VALIDATION_FAILED');
    expect(rejected.results[0]!.message).toContain('desc-child');
    expect(rejected.results[0]!.message).toContain('override_unknown_field');
    expect(rejected.total_updated).toBe(0);

    // No partial write: same number of snapshots, same parent bytes.
    const after = await runtime.graph.listVersions(parentKey);
    expect(after).toHaveLength(before.length);
    const head = await runtime.graph.getLatestVersion(parentKey);
    expect(head!.version_number).toBe('1');
    // The recorded body is the durable stored state, not the submitted document (G3).
    expect(head!.content).toContain('has_fur: true');
    expect(head!.content).toContain('parent step');
    expect(head!.content).not.toContain('has_fur: false');
  });

  test('a change that keeps the overridden field is applied and descendants inherit it', async () => {
    const runtime = await fixture.openRuntime('descendants-ok');
    await fixture.train(runtime, SPACE, parentDoc({ has_fur: 'true' }));
    await fixture.train(runtime, SPACE, childDoc('desc-keep', { fields: { has_fur: 'false' } }));

    // A real change to the parent body, with the child's overridden field still declared.
    const applied = await fixture.tune(
      runtime,
      SPACE,
      PARENT_URI,
      parentDoc({ has_fur: 'true' }, undefined, 'parent step v2'),
      { expectedVersion: '1.0.0' }
    );
    expect(applied.results[0]!.status).toBe('updated');

    const parentKey = modules.scope.adapterGraphKey(SPACE, PARENT);
    const latest = await runtime.graph.getLatestVersion(parentKey);
    expect(latest!.version_number).toBe('2');
    expect(latest!.parent_version).toBe('1');

    // The child edge survives, so the child resolves the updated parent without a rewrite.
    const path = await fixture.pathSlugs(runtime, SPACE, 'desc-keep');
    expect(path).toEqual([PARENT]);
    // The child is reported with the scope its node is stored in, not a bare slug.
    expect(await runtime.graph.getChildren(SPACE, PARENT)).toEqual([
      { key: modules.scope.adapterGraphKey(SPACE, 'desc-keep'), slug: 'desc-keep', space: SPACE }
    ]);
  });

  test('a tune that leaves the durable state unchanged appends no history row', async () => {
    const runtime = await fixture.openRuntime('no-change');
    await fixture.train(runtime, SPACE, parentDoc({ has_fur: 'true' }));
    const parentKey = modules.scope.adapterGraphKey(SPACE, PARENT);
    const before = await runtime.graph.getLatestVersion(parentKey);

    // Re-submitting the same document reaches storage through the same finalizer; the
    // recorded bytes are already the stored bytes, so a new snapshot would record no change.
    const replay = await fixture.tune(runtime, SPACE, PARENT_URI, parentDoc({ has_fur: 'true' }), {
      expectedVersion: '1.0.0'
    });
    expect(replay.results[0]!.status).toBe('updated');

    expect(await runtime.graph.listVersions(parentKey)).toHaveLength(1);
    expect((await runtime.graph.getLatestVersion(parentKey))!.content_digest).toBe(before!.content_digest);
  });
});
