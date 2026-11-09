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
 *   3. confirmations are attributed from the stored record and deduped by identity, so
 *      one runtime-local caller cannot reach quorum (two thirds of distinct agents) by
 *      repeating itself or by claiming `human_expert`;
 *   4. evidence outranks votes: one evidenced confirmation accepts the proposal and
 *      hands back an apply plan, and the parent's bytes and history stay untouched.
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

describe('HTTP reward: confirmations are attributed and deduped by identity', () => {
  test('three children confirming through one runtime-local caller never reach quorum', async () => {
    for (const slug of CHILDREN) await confirm(slug);
    const last = await confirm(CHILDREN[0] ?? '');

    // Three confirmations by ONE identity collapse into one confirmation row, and its
    // child is the one the caller actually reported: dedupe is the mechanism, not a bug.
    expect(last['distinct_children']).toBe(1);
    expect(last['required_confirmations']).toBe(3);
    // Two thirds of distinct agents is two, and auth-disabled is one identity: the
    // repeated confirmations collapse instead of manufacturing a quorum.
    expect(last['decision']).toBe('pending');
    expect(last['decided_by']).toBe('quorum not reached');
    expect(last['apply_plan']).toBeNull();
    expect(String(last['next_action'])).toContain('pending');
  }, 600_000);

  test('a claimed human_expert without an authenticated subject is not a second voter', async () => {
    const claimed = await confirm(CHILDREN[1] ?? '', { proposal_actor_kind: 'human_expert' });

    // Same identity, different label: it must not count as another agent nor as authority.
    expect(claimed['decision']).toBe('pending');
    expect(claimed['decided_by']).toBe('quorum not reached');
    expect(String(claimed['decided_by'])).not.toContain('human expert');
    expect(claimed['apply_plan']).toBeNull();
  }, 600_000);

  test('evidence outranks votes, and the accepted plan still writes nothing', async () => {
    const accepted = await confirm(CHILDREN[2] ?? '', {
      proposal_evidence: {
        observed: 'retry_limit=5',
        expected: 'retry_limit=3',
        reproduced_by: 'http-reward-child-three'
      }
    });

    expect(accepted['proposal']).toBe(proposal);
    expect(accepted['status']).toBe('accepted');
    expect(accepted['decision']).toBe('accept');
    expect(String(accepted['decided_by'])).toContain('evidence from');

    const plan = accepted['apply_plan'] as Record<string, unknown>;
    expect(plan['target_uri']).toBe(`squadrules://adapter/${PARENT}`);
    expect(plan['field']).toBe('reward_failure');
    expect(plan['from_value']).toBeNull();
    expect(plan['to_value']).toBe(FEEDBACK);
    // The plan is instructions for a normal tune, never a hidden parent write.
    expect(String(plan['instructions'])).toContain(`squadrules://adapter/${PARENT}`);
    expect(String(accepted['next_action'])).toBe(String(plan['instructions']));

    // Acceptance settled a record; it did not apply it.
    const head = await exportMarkdown(server, `squadrules://adapter/${PARENT}`);
    expect(head.status).toBe(200);
    expect(head.body['content']).toBe(parentContentBefore);
    const snapshot = await exportMarkdown(server, `squadrules://adapter/${PARENT}`, '1');
    expect(snapshot.body['history_versions']).toBe(parentHistoryVersions);
  }, 600_000);
});
