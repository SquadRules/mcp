/**
 * Activate-time ontology context (ADR 0047) — real LadybugDB, real LanceDB, real
 * `train` writes feeding the projection `executeActivate()` calls at
 * `src/tools/activate.ts` (the `resolveActivationOntologyContext` touchpoint).
 * No mocks, stubs or module fakes.
 *
 * What this suite pins:
 *
 *   1. Every read is addressed by the stored adapter's scoped key: relationships
 *      come from the recorded inheritance path, evidence from anomalies/proposals
 *      carrying the same scope, history from the scoped key.
 *   2. Provenance is recorded per filter: `task`/`domain` caller-declared, `human`
 *      from the runtime actor, `org` only from a *permitted group* space. No input
 *      can add a scope.
 *   3. One slug in two spaces is two contexts: the sibling space's history and
 *      anomalies are invisible even though the slug matches.
 *   4. `explainEvolution` names the current snapshot and the accepted evolution, and
 *      the digest is presented as integrity of the bytes.
 *   5. Degradation is honest: no attached graph → `null` (activation stands); a
 *      stored record with no graph node → a context with a `degraded` reason and
 *      zeroed evidence, never invented rows.
 */
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';

import {
  GraphFixture,
  adapterDoc,
  commentContract,
  loadProductionModules,
  type ProductionModules,
  type Runtime
} from './graph-db-fixture.js';
import type { ActivateOutput } from '../../src/tools/activate_schema.js';

const SPACE_A = 'space:it-activate-a';
const SPACE_B = 'group:it-activate-b';
const PARENT = 'act-parent';
const CHILD = 'act-child';
const SHARED = 'shared-slug';

let modules: ProductionModules;
let fixture: GraphFixture;

type ActivationContext = NonNullable<
  Awaited<ReturnType<ProductionModules['activateOntology']['resolveActivationOntologyContext']>>
>;

function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Parent adapter declaring the domain property children may contradict. */
function parentDoc(domain = 'python'): string {
  return adapterDoc({
    slug: PARENT,
    version: '1.0.0',
    title: 'Activation Parent',
    extraFrontmatter: { domain, has_fur: 'true' },
    sections: [{ heading: 'Step 1', body: 'parent step' }],
    contract: commentContract('parent')
  });
}

/** Child inheriting the parent, overriding the property and reporting the conflict. */
function childDoc(domain = 'python'): string {
  return adapterDoc({
    slug: CHILD,
    version: '1.0.0',
    title: 'Activation Child',
    inherits: PARENT,
    override: ['has_fur'],
    extraFrontmatter: { domain, has_fur: 'false' },
    anomaly: { type: 'contradiction', field: 'has_fur', reason: 'child disagrees', routes_to: PARENT },
    sections: [{ heading: 'Step 1', body: 'child step' }],
    contract: commentContract('child')
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
  slug: string,
  explicit?: { task?: string; domain?: string }
): Promise<ActivationContext | null> {
  return fixture.onSpace(spaceId, () =>
    modules.activateOntology.resolveActivationOntologyContext(
      runtime.memoryStore,
      runtime.qdrantService,
      [matchChoice(slug)],
      explicit
    )
  );
}

beforeAll(async () => {
  modules = await loadProductionModules();
  fixture = new GraphFixture(modules);
});

afterAll(async () => {
  await fixture.dispose();
});

describe('scoped projection of a real trained adapter (ADR 0047 §1–3)', () => {
  let runtime: Runtime;
  const child = childDoc();

  beforeAll(async () => {
    runtime = await fixture.openRuntime('context');
    await fixture.train(runtime, SPACE_A, parentDoc());
    await fixture.train(runtime, SPACE_A, child);

    // One proposal the projection will see as accepted; `settleProposal` writes the
    // same status through the same port method, so this is the real storage record.
    const parentKey = modules.scope.adapterGraphKey(SPACE_A, PARENT);
    const [proposal] = await runtime.graph.listProposals({ targetKey: parentKey });
    expect(proposal).toBeDefined();
    await runtime.graph.updateProposalStatus(proposal!.key, 'accepted', {
      resolution: 'applied',
      resolution_note: 'applied via tune 1.0.0 -> 2'
    });
  });

  test('reads only the stored scope and records where each filter came from', async () => {
    const ctx = await resolveContext(runtime, SPACE_A, CHILD, { task: 'rotate credentials' });
    expect(ctx).not.toBeNull();

    expect(ctx!.scope).toEqual({
      adapter_key: modules.scope.adapterGraphKey(SPACE_A, CHILD),
      space_id: SPACE_A,
      space_source: 'stored-record'
    });
    expect(ctx!.context.task).toBe('rotate credentials');
    expect(ctx!.context.domain).toBe('python');
    expect(ctx!.context.human).toBe('human://user-it');
    // A non-group space is not an organization: org stays null rather than borrowed.
    expect(ctx!.context.org).toBeNull();
    expect(ctx!.context.sources).toEqual({
      task: 'caller-declared',
      domain: 'stored-adapter-frontmatter',
      human: 'runtime-actor'
    });
    expect(ctx!.degraded).toBeNull();
  });

  test('relationships come from the child, evidence from what targets the parent', async () => {
    const childCtx = (await resolveContext(runtime, SPACE_A, CHILD))!;

    // The recorded inheritance path, nearest first — one edge, no invented ancestor.
    expect(childCtx.relationships).toEqual([
      { type: 'inherits', target: modules.scope.adapterGraphKey(SPACE_A, PARENT), depth: 1 }
    ]);
    expect(childCtx.concept).toBeNull();
    // The anomaly and the proposal are recorded *against the parent*: they are
    // evidence about `act-parent`, so they appear on the parent's projection.
    expect(childCtx.evidence.open_anomalies).toBe(0);
    expect(childCtx.evidence.accepted_proposals).toBe(0);
    expect(childCtx.evidence.version_snapshots).toBe(1);
    expect(childCtx.evolution.current_snapshot).toBe('1');
    expect(childCtx.evolution.applied[0]!.content_digest).toBe(sha(child));
    expect(childCtx.evolution.explanation).toContain('Snapshot 1');
    expect(childCtx.evolution.explanation).not.toContain('Accepted evolution');
    expect(childCtx.degraded).toBeNull();

    const parentCtx = (await resolveContext(runtime, SPACE_A, PARENT))!;
    // A root has no inherited ancestor, and nothing is fabricated to fill the list.
    expect(parentCtx.relationships).toEqual([]);
    expect(parentCtx.evidence.open_anomalies).toBe(1);
    // Description is the child's declared reason; severity defaults in the graph.
    expect(parentCtx.evidence.anomalies[0]!.detail).toBe('medium: child disagrees');
    expect(parentCtx.evidence.accepted_proposals).toBe(1);
    expect(parentCtx.evidence.pending_proposals).toBe(0);
    expect(parentCtx.evidence.proposals).toEqual([]);
    expect(parentCtx.evidence.version_snapshots).toBe(1);

    expect(parentCtx.evolution.current_adapter_version).toBe('1.0.0');
    expect(parentCtx.evolution.current_snapshot).toBe('1');
    const applied = parentCtx.evolution.applied[0]!;
    expect(applied.change_type).toBe('created');
    expect(applied.changed_by).toBe('user-it');
    // The digest proves these bytes, not the truth of the change recorded.
    expect(applied.content_digest).toBe(sha(parentDoc()));
    expect(parentCtx.evolution.resolution_notes).toEqual(['has_fur: true -> false']);
    expect(parentCtx.evolution.explanation).toContain('Snapshot 1');
    expect(parentCtx.evolution.explanation).toContain('Accepted evolution: has_fur on act-parent');

    // The projection is the declared `activate` output surface, not an ad-hoc object.
    for (const ctx of [childCtx, parentCtx]) {
      const parsed = modules.activateSchema.activateOutputSchema.shape.ontology_context.safeParse(ctx);
      expect(parsed.success).toBe(true);
    }
  });

  test('a caller-declared domain overrides the stored one and never widens scope', async () => {
    const ctx = (await resolveContext(runtime, SPACE_A, CHILD, { domain: 'typescript' }))!;
    expect(ctx.context.domain).toBe('typescript');
    expect(ctx.context.sources['domain']).toBe('caller-declared');
    expect(ctx.scope.space_id).toBe(SPACE_A);
  });
});

describe('scope isolation between two spaces with the same slug (ADR 0047 §2)', () => {
  let runtime: Runtime;
  const bodyA = adapterDoc({
    slug: SHARED,
    version: '1.0.0',
    title: 'Shared In A',
    extraFrontmatter: { has_fur: 'true' },
    sections: [{ heading: 'Step 1', body: 'space a step' }],
    contract: commentContract('space a')
  });
  const bodyB = adapterDoc({
    slug: SHARED,
    version: '2.0.0',
    title: 'Shared In B',
    extraFrontmatter: { has_fur: 'true' },
    sections: [{ heading: 'Step 1', body: 'space b step' }],
    contract: commentContract('space b')
  });

  beforeAll(async () => {
    runtime = await fixture.openRuntime('isolation');
    await fixture.train(runtime, SPACE_A, bodyA);
    await fixture.train(runtime, SPACE_B, bodyB);
    // A child in B raises an anomaly about the same slug. It must not appear in A.
    await fixture.train(
      runtime,
      SPACE_B,
      adapterDoc({
        slug: 'isolated-child',
        version: '1.0.0',
        title: 'Isolated Child',
        inherits: SHARED,
        override: ['has_fur'],
        extraFrontmatter: { has_fur: 'false' },
        anomaly: { type: 'contradiction', field: 'has_fur', reason: 'b only', routes_to: SHARED },
        sections: [{ heading: 'Step 1', body: 'b child step' }],
        contract: commentContract('isolated child')
      })
    );
  });

  test('each space reads its own snapshot and the sibling anomaly is filtered out', async () => {
    const ctxA = (await resolveContext(runtime, SPACE_A, SHARED))!;
    expect(ctxA.scope.space_id).toBe(SPACE_A);
    expect(ctxA.scope.adapter_key).toBe(modules.scope.adapterGraphKey(SPACE_A, SHARED));
    expect(ctxA.evolution.applied[0]!.content_digest).toBe(sha(bodyA));
    expect(ctxA.evolution.current_adapter_version).toBe('1.0.0');
    expect(ctxA.evidence.open_anomalies).toBe(0);
    expect(ctxA.relationships).toEqual([]);
    // No permitted group space in this context, so no organization is claimed.
    expect(ctxA.context.org).toBeNull();

    const ctxB = (await resolveContext(runtime, SPACE_B, SHARED))!;
    expect(ctxB.scope.space_id).toBe(SPACE_B);
    expect(ctxB.evolution.applied[0]!.content_digest).toBe(sha(bodyB));
    expect(ctxB.evolution.current_adapter_version).toBe('2.0.0');
    expect(ctxB.evidence.open_anomalies).toBe(1);
    // org comes from the permitted group space, never from the caller.
    expect(ctxB.context.org).toBe(SPACE_B);
    expect(ctxB.context.sources['org']).toBe('permitted-space');
  });
});

describe('degradation never blocks activation (ADR 0047 §4)', () => {
  test('no attached graph returns null and the activation result stands', async () => {
    const runtime = await fixture.openRuntime('no-graph', { attach: false });
    await fixture.train(runtime, SPACE_A, parentDoc());

    expect(await resolveContext(runtime, SPACE_A, PARENT)).toBeNull();
  });

  test('a stored record with no graph node degrades instead of inventing evidence', async () => {
    const runtime = await fixture.openRuntime('late-graph', { attach: false });
    await fixture.train(runtime, SPACE_A, parentDoc());
    // The graph bookkeeping starts now: the record predates it.
    modules.owner.attachGraphDb(runtime.graph, runtime.memoryStore);

    const ctx = (await resolveContext(runtime, SPACE_A, PARENT, { task: 'ship it' }))!;
    expect(ctx.scope.space_id).toBe(SPACE_A);
    expect(ctx.degraded).toContain('not present in the graph');
    expect(ctx.evidence.open_anomalies).toBe(0);
    expect(ctx.evidence.version_snapshots).toBe(0);
    expect(ctx.evolution.applied).toEqual([]);
    expect(ctx.evolution.current_snapshot).toBeNull();
    expect(ctx.evolution.explanation).toContain('No graph-native snapshot');
    // The filters still resolve, so the caller sees the request context it supplied.
    expect(ctx.context.task).toBe('ship it');
  });
});
