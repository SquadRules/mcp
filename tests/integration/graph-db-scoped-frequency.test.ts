/**
 * Scoped anomaly frequency for the evolution ladder (ADR 0046 §§3–4) — real LadybugDB,
 * real LanceDB, real `train` and the real reward producers. No mocks or stubs.
 *
 * What this suite pins:
 *
 *   1. A reward failure writes an anomaly that names its scope, its exact target AND its
 *      claim, so a later count can tell two same-slug adapters apart.
 *   2. The frequency count behind `frequency_met` is about the exact scoped target and the
 *      exact claim: a reward failure in another space with the same routing slug, and a
 *      different contested field on the same target, do not raise the bar.
 *   3. Enough rows route to one slug that a slug-only aggregation would have reported a
 *      met frequency; the scoped count reports the truth instead.
 */

import {
  GraphFixture,
  adapterDoc,
  commentContract,
  loadProductionModules,
  type ProductionModules,
  type Runtime
} from './graph-db-fixture.js';

const SPACE = 'space:it-scoped-frequency';
const OTHER_SPACE = 'space:it-scoped-frequency-other';
const PARENT = 'scope-parent';
const CLAIM = 'reward_failure';

let modules: ProductionModules;
let fixture: GraphFixture;
let rewardAnomaly: typeof import('../../src/tools/reward-anomaly.js');
let rewardEvolution: typeof import('../../src/tools/reward-evolution.js');

/** Parent adapter that declares the primitive a child may disagree with. */
function parentDoc(): string {
  return adapterDoc({
    slug: PARENT,
    version: '1.0.0',
    title: 'Scoped Frequency Parent',
    extraFrontmatter: { has_fur: 'true' },
    sections: [{ heading: 'Step 1', body: 'parent step' }],
    contract: commentContract('parent')
  });
}

/** Child of the parent, optionally disagreeing with it or declaring an anomaly. */
function childDoc(
  slug: string,
  options: { fields?: Record<string, string>; anomalyField?: string } = {}
): string {
  const fields = options.fields ?? {};
  const overridden = Object.keys(fields);
  return adapterDoc({
    slug,
    version: '1.0.0',
    title: `Scoped Frequency Child ${slug}`,
    inherits: PARENT,
    ...(overridden.length > 0 ? { override: overridden } : {}),
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
    sections: [{ heading: 'Step 1', body: `${slug} step` }],
    contract: commentContract(slug)
  });
}

beforeAll(async () => {
  modules = await loadProductionModules();
  fixture = new GraphFixture(modules);
  rewardAnomaly = await import('../../src/tools/reward-anomaly.js');
  rewardEvolution = await import('../../src/tools/reward-evolution.js');
});

afterAll(async () => {
  await fixture.dispose();
});

describe('frequency counts the exact scoped target and claim (ADR 0046 §§3–4)', () => {
  test('another space and an unrelated field never move frequency_met', async () => {
    const runtime: Runtime = await fixture.openRuntime('scoped-frequency');
    await fixture.train(runtime, SPACE, parentDoc());
    // The same slug, a genuinely different adapter: nothing about it reports on SPACE.
    await fixture.train(runtime, OTHER_SPACE, parentDoc());

    /** Train a child and record a real reward failure against its layer. */
    const failedReward = async (space: string, slug: string) => {
      const trained = await fixture.train(
        runtime,
        space,
        childDoc(slug, { fields: { has_fur: 'false' } })
      );
      const uri = `squadrules://layer/${trained.headUuid}`;
      const outcome = await fixture.onSpace(space, () =>
        rewardAnomaly.recordRewardAnomaly(runtime.qdrantService, {
          uri,
          layerUuid: trained.headUuid,
          outcome: 'failure',
          feedback: `${slug} failed`
        })
      );
      expect(outcome).not.toBeNull();
      return { uri, outcome: outcome! };
    };

    const first = await failedReward(SPACE, 'scope-a');
    const second = await failedReward(SPACE, 'scope-b');
    const foreign = await failedReward(OTHER_SPACE, 'scope-foreign');
    // A child in this space reporting a DIFFERENT contested field on the same target.
    await fixture.train(runtime, SPACE, childDoc('scope-other', { anomalyField: 'has_fur' }));

    expect(second.outcome.routes_to).toBe(PARENT);

    // Four distinct children route to the same slug: that is what a slug-only count saw.
    const routingWide = await runtime.graph.listAnomalies({ routesTo: PARENT });
    const routingChildren = new Set(
      routingWide.map((row) => row.source_child).filter((key): key is string => Boolean(key))
    );
    expect(routingChildren.size).toBe(4);
    // ... but one of them belongs to another space, and one reports another claim.
    expect(foreign.outcome.space_id).toBe(OTHER_SPACE);
    expect(
      routingWide.filter((row) => row.source_child === foreign.outcome.child_key)[0]?.metadata?.[
        'target_space_id'
      ]
    ).toBe(OTHER_SPACE);

    const evolving = await fixture.onSpace(SPACE, () =>
      rewardEvolution.recordRewardEvolution(runtime.qdrantService, first.outcome, {
        uri: first.uri,
        outcome: 'failure',
        feedback: 'scope-a failed'
      })
    );
    expect(evolving.proposal).not.toBeNull();
    expect(evolving.frequency_truncated).toBe(false);
    expect(evolving.frequency_window).toBe(500);
    // Two real reporters in this space, not the four that share the routing slug.
    expect(evolving.distinct_children).toBe(2);

    const firstProposal = await runtime.graph.getProposal(evolving.proposal!);
    expect(firstProposal!.field).toBe(CLAIM);
    expect(firstProposal!.evidence['distinct_children']).toBe(2);
    expect(firstProposal!.evidence['frequency_met']).toBe(false);
    expect(firstProposal!.required_confirmations).toBe(1);

    // A third reporter in THIS scope is what raises the bar.
    const third = await failedReward(SPACE, 'scope-c');
    const raised = await fixture.onSpace(SPACE, () =>
      rewardEvolution.recordRewardEvolution(runtime.qdrantService, third.outcome, {
        uri: third.uri,
        outcome: 'failure',
        feedback: 'scope-c failed'
      })
    );
    expect(raised.distinct_children).toBe(3);

    const thirdProposal = await runtime.graph.getProposal(raised.proposal!);
    expect(thirdProposal!.field).toBe(CLAIM);
    expect(thirdProposal!.evidence['distinct_children']).toBe(3);
    expect(thirdProposal!.evidence['frequency_met']).toBe(true);
    expect(thirdProposal!.required_confirmations).toBe(3);

    // The slug now carries five children; only the three in this scope decided.
    const widened = await runtime.graph.listAnomalies({ routesTo: PARENT });
    expect(new Set(widened.map((row) => row.source_child)).size).toBe(5);
  }, 600_000);
});
