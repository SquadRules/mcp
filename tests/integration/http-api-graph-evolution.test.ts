/**
 * HTTP reward → evolution proposals over a REAL server (ADR 0046, ADR 0045).
 *
 * Every call is a real `fetch` against the shipped server process (`dist/bootstrap.js`)
 * started by `ChildApiServer` on its own ephemeral port: real Express router, real
 * embedded LanceDB record store, real embedded LadybugDB graph, real local fastembed
 * embedder, auth disabled (the production single-tenant request context). A child
 * process is required because real ONNX must not run inside a Jest vm realm (ADR 0004).
 *
 * Review gate, recorded rather than bypassed: `executeTrain` exempts exactly two real
 * contracts from `review_evidence` — artifact trains (non-markdown mime) and fork trains
 * (`source_adapter_uri`). The gate is shape-first, so no test here fabricates a critic
 * PASS; every authored write is a fork train of the bundled `critic-loop` adapter that
 * boot injection system-seeds into the app space.
 *
 * The contract under test, in the order the ladder settles it:
 *   1. a failed reward records a proposal and never rewrites the parent;
 *   2. three distinct children reporting the same parent raise the bar to three
 *      confirmations — frequency is distinct children, never execution count;
 *   3. an auth-disabled HTTP caller is `runtime-local`, and ADR 0046 §6 requires an
 *      authenticated subject for every vote. confirmProposal refuses that identity with
 *      `authenticated_subject_required` before anything is written, so neither a repeated
 *      call, a `human_expert` claim, nor evidence can bypass the guard over HTTP. The
 *      dedupe-by-identity consensus rules that guard enforces are exercised end-to-end
 *      by the embedded suite (`graph-db-evolution.test.ts`), which supplies a stable
 *      `userId` through the space context.
 *   4. whatever the caller sends on a confirmation attempt, the parent's bytes and
 *      history stay untouched — the ladder is proposal-only until an authenticated
 *      subject confirms it.
 */

import { ChildApiServer } from './http-api-graph-child-server.js';
import { exportMarkdown, forkTrain } from './http-api-graph-client.js';
import { httpAdapterDoc, shellContract } from './http-api-graph-docs.js';

const PARENT = 'http-evolution-parent';
const FEEDBACK = 'parent caps retry at 3; this child retries 5';
const CHILDREN = ['http-reward-child-one', 'http-reward-child-two', 'http-reward-child-three'];

let server: ChildApiServer;
let parentContentBefore = '';
let parentHistoryVersions = 0;
const layers = new Map<string, string>();
let proposal = '';

/** Layer URI of a trained child — the only URI `reward` accepts. */
function layerUri(slug: string): string {
  const id = layers.get(slug);
  if (!id) throw new Error(`no layer recorded for ${slug}`);
  return `squadrules://layer/${id}`;
}

function parentDoc(): string {
  return httpAdapterDoc({
    title: 'Http Evolution Parent',
    sections: [{ heading: 'Parent Step', body: 'evolution-parent-body' }],
    contract: shellContract('echo evolution-parent')
  });
}

function childDoc(title: string): string {
  return httpAdapterDoc({
    title,
    inherits: PARENT,
    sections: [{ heading: 'Child Step', body: `body for ${title}` }],
    contract: shellContract('echo evolution-child')
  });
}

/** A failed reward for one child; returns the evolution report the route produced. */
async function failReward(slug: string): Promise<Record<string, unknown>> {
  const reply = await server.post('/api/reward', {
    uri: layerUri(slug),
    outcome: 'failure',
    feedback: FEEDBACK
  });
  expect(reply.status).toBe(200);
  const evolution = reply.body['evolution'] as Record<string, unknown> | undefined;
  expect(evolution).toBeDefined();
  return evolution ?? {};
}

/** A confirmation that carries NO feedback: feedback would be folded into evidence. */
async function confirm(
  slug: string,
  extra: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const reply = await server.post('/api/reward', {
    uri: layerUri(slug),
    outcome: 'failure',
    proposal,
    proposal_decision: 'confirm',
    ...extra
  });
  expect(reply.status).toBe(200);
  const evolution = reply.body['evolution'] as Record<string, unknown> | undefined;
  expect(evolution).toBeDefined();
  return evolution ?? {};
}

beforeAll(async () => {
  server = await ChildApiServer.start('graph-evolution');
  const parent = await forkTrain(server, parentDoc());
  if (parent.status !== 200) throw new Error(`parent fork train failed: ${JSON.stringify(parent.body)}`);
  expect(parent.slug).toBe(PARENT);
  layers.set(parent.slug, parent.layerUuid);

  const titles = ['Http Reward Child One', 'Http Reward Child Two', 'Http Reward Child Three'];
  for (let index = 0; index < CHILDREN.length; index += 1) {
    const trained = await forkTrain(server, childDoc(titles[index] ?? ''));
    if (trained.status !== 200) {
      throw new Error(`child fork train failed: ${JSON.stringify(trained.body)}`);
    }
    expect(trained.slug).toBe(CHILDREN[index]);
    layers.set(trained.slug, trained.layerUuid);
  }

  const head = await exportMarkdown(server, `squadrules://adapter/${PARENT}`);
  expect(head.status).toBe(200);
  parentContentBefore = String(head.body['content']);
  const snapshot = await exportMarkdown(server, `squadrules://adapter/${PARENT}`, '1');
  expect(snapshot.status).toBe(200);
  parentHistoryVersions = Number(snapshot.body['history_versions']);
  expect(parentHistoryVersions).toBeGreaterThanOrEqual(1);
}, 600_000);

afterAll(async () => {
  await server?.dispose();
}, 600_000);

describe('HTTP reward: a failure proposes, it never rewrites the parent', () => {
  test('one child raises a proposal and the parent bytes stay identical', async () => {
    const evolution = await failReward(CHILDREN[0] ?? '');

    expect(String(evolution['proposal'])).toMatch(/^proposal:[a-f0-9]{32}$/);
    expect(String(evolution['anomaly'])).toMatch(/^anomaly:[0-9a-f-]{36}$/);
    expect(evolution['status']).toBe('proposed');
    expect(evolution['required_confirmations']).toBe(1);
    expect(evolution['distinct_children']).toBe(1);
    // Nothing confirmed yet: the ladder has not decided anything.
    expect(evolution['decision']).toBe('pending');
    expect(evolution['apply_plan']).toBeNull();
    expect(String(evolution['next_action'])).toContain('pending');

    // PROPOSAL-ONLY: the parent's served bytes are untouched by the failure.
    const head = await exportMarkdown(server, `squadrules://adapter/${PARENT}`);
    expect(head.status).toBe(200);
    expect(head.body['content']).toBe(parentContentBefore);
  }, 600_000);
});

describe('HTTP reward: three distinct children raise the bar to three', () => {
  test('frequency is distinct children, and the third child still writes nothing', async () => {
    await failReward(CHILDREN[1] ?? '');
    const third = await failReward(CHILDREN[2] ?? '');

    expect(String(third['proposal'])).toMatch(/^proposal:[a-f0-9]{32}$/);
    proposal = String(third['proposal']);
    expect(third['required_confirmations']).toBe(3);
    expect(third['distinct_children']).toBe(3);
    expect(['pending', 'branch']).toContain(third['decision']);
    expect(third['apply_plan']).toBeNull();

    const head = await exportMarkdown(server, `squadrules://adapter/${PARENT}`);
    expect(head.body['content']).toBe(parentContentBefore);
  }, 600_000);
});

describe('HTTP reward: an auth-disabled caller cannot confirm (ADR 0046 §6)', () => {
  // The child server runs with `AUTH_ENABLED=false`, so `resolveGraphActor()` reports
  // `actor_source: 'runtime-local'` for every request. `confirmProposal` rejects that
  // identity before anything is written; the returned evolution carries a diagnostic and
  // every consensus field stays null. See the file header for the ladder's semantics at
  // HTTP level and for where the dedupe-by-identity consensus rules are actually proven.

  test('a bare proposal_decision fails with authenticated_subject_required', async () => {
    const blocked = await confirm(CHILDREN[0] ?? '');

    expect(blocked['status']).toBeNull();
    expect(blocked['decision']).toBeNull();
    expect(blocked['required_confirmations']).toBeNull();
    expect(blocked['apply_plan']).toBeNull();
    const diagnostic = blocked['diagnostic'] as { code?: string } | undefined;
    expect(diagnostic?.code).toBe('authenticated_subject_required');
    expect(String(blocked['next_action'])).toContain('blocked: authenticated_subject_required');
  }, 600_000);

  test('claiming proposal_actor_kind=human_expert does not bypass the subject guard', async () => {
    const blocked = await confirm(CHILDREN[1] ?? '', { proposal_actor_kind: 'human_expert' });

    // A kind claim is not authority without an authenticated subject: the guard fires
    // before consensus ever sees the label. Same diagnostic code as the plain path.
    const diagnostic = blocked['diagnostic'] as { code?: string } | undefined;
    expect(diagnostic?.code).toBe('authenticated_subject_required');
    expect(blocked['decision']).toBeNull();
    expect(blocked['apply_plan']).toBeNull();
  }, 600_000);

  test('proposal_evidence does not bypass the subject guard and never mutates the parent', async () => {
    const blocked = await confirm(CHILDREN[2] ?? '', {
      proposal_evidence: {
        observed: 'retry_limit=5',
        expected: 'retry_limit=3',
        reproduced_by: 'http-reward-child-three'
      }
    });

    const diagnostic = blocked['diagnostic'] as { code?: string } | undefined;
    expect(diagnostic?.code).toBe('authenticated_subject_required');
    expect(blocked['apply_plan']).toBeNull();
    expect(blocked['proposal']).toBe(proposal);

    // PROPOSAL-ONLY INVARIANT: a rejected confirmation attempt must not touch the
    // parent's stored bytes or history, even when the caller supplies evidence.
    const head = await exportMarkdown(server, `squadrules://adapter/${PARENT}`);
    expect(head.status).toBe(200);
    expect(head.body['content']).toBe(parentContentBefore);
    const snapshot = await exportMarkdown(server, `squadrules://adapter/${PARENT}`, '1');
    expect(snapshot.body['history_versions']).toBe(parentHistoryVersions);
  }, 600_000);
});
