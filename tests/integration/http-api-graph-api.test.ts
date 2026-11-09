/**
 * HTTP API — inheritance, activation, history, evolution over a REAL server (ADR 0042–0047).
 *
 * Every request is a real `fetch` against the shipped server process
 * (`dist/bootstrap.js`) started by `ChildApiServer` on its own ephemeral port: real
 * Express router, real embedded LanceDB record store, real embedded LadybugDB graph,
 * real local fastembed embedder, auth disabled. A child process is required because
 * real ONNX must not run inside a Jest vm realm (ADR 0004) and integration tests may
 * not swap the embedding provider for a fake.
 *
 * Review gate, recorded rather than bypassed: `executeTrain` exempts exactly two real
 * contracts from `review_evidence` — artifact trains (non-markdown mime) and fork
 * trains (`source_adapter_uri`). The review gate itself is shape-first, so no test may
 * fabricate a critic PASS. Every authored write here is a fork train of the bundled
 * `critic-loop` adapter that boot injection system-seeds into the app space.
 *
 * Covers:
 *   1. parent write then child write declaring `inherits:` → `POST /api/activate`
 *      returns the child identity, the full lineage and the merged executable contracts;
 *   2. a structural `override` is vetoed before any write;
 *   3. `POST /api/export` serves the current head and one historical snapshot with its
 *      own digest, and a missing version fails instead of falling back to the head;
 *   4. an incomplete chain reports `inheritance_resolved: false` with a reason naming
 *      the missing parent instead of a false `resolved: true`;
 *   5. `POST /api/activate` carries the caller's `context` into the scoped ontology
 *      projection, which reads only the adapter's own stored space;
 *   6. `POST /api/forward` executes the merged content and leaves no checkpoint behind
 *      once the walk finished (terminal cleanup).
 *
 * The reward → proposal ladder lives in `http-api-graph-evolution.test.ts`: it needs its
 * own ordered scenario (three reporting children, then confirmations), and splitting it
 * keeps each suite under the file-length budget.
 */
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { ChildApiServer } from './http-api-graph-child-server.js';
import { exportMarkdown, forkTrain } from './http-api-graph-client.js';
import { httpAdapterDoc, shellContract } from './http-api-graph-docs.js';

const PARENT = 'http-parent-adapter';
const CHILD = 'http-child-adapter';
const VETO_CHILD = 'http-veto-child';
const ORPHAN_CHILD = 'http-orphan-child';
const GHOST_PARENT = 'http-ghost-parent';

let server: ChildApiServer;

function parentDoc(): string {
  return httpAdapterDoc({
    title: 'Http Parent Adapter',
    extra: { domain: 'python' },
    sections: [{ heading: 'Parent Step', body: 'parent-step-body' }],
    contract: shellContract('echo parent-step')
  });
}

function childDoc(): string {
  return httpAdapterDoc({
    title: 'Http Child Adapter',
    inherits: PARENT,
    override: ['domain'],
    extra: { domain: 'rust' },
    sections: [{ heading: 'Child Step', body: 'child-step-body' }],
    contract: shellContract('echo child-step')
  });
}

beforeAll(async () => {
  server = await ChildApiServer.start('graph-api');
  const parent = await forkTrain(server, parentDoc());
  if (parent.status !== 200) throw new Error(`parent fork train failed: ${JSON.stringify(parent.body)}`);
  expect(parent.slug).toBe(PARENT);
  const child = await forkTrain(server, childDoc());
  if (child.status !== 200) throw new Error(`child fork train failed: ${JSON.stringify(child.body)}`);
  expect(child.slug).toBe(CHILD);
}, 600_000);

afterAll(async () => {
  await server?.dispose();
}, 600_000);

describe('HTTP activation: child identity, full lineage, merged executable contracts', () => {
  test('POST /api/activate returns the child, its chain and both contracts in one payload', async () => {
    const reply = await server.post('/api/activate', { query: 'http child adapter inheritance', space: 'personal', max_choices: 20 });
    expect(reply.status).toBe(200);
    const body = reply.body;

    expect(body['inheritance_resolved']).toBe(true);
    expect(body['inheritance_chain']).toEqual([CHILD, PARENT]);

    const choices = (body['choices'] as Array<Record<string, unknown>>) ?? [];
    const childChoice = choices.find((choice) => choice['slug'] === CHILD);
    expect(childChoice).toBeDefined();
    expect(childChoice?.['uri']).toBe(`squadrules://adapter/${CHILD}`);
    expect(childChoice?.['role']).toBe('match');

    const merged = childChoice?.['merged_adapter_content'] as Record<string, unknown> | undefined;
    expect(merged).toBeDefined();
    expect(merged?.['slug']).toBe(CHILD);
    expect(merged?.['version']).toBe('1.0.0');
    expect(merged?.['resolved']).toBe(true);
    expect(merged?.['inheritance_chain']).toEqual([CHILD, PARENT]);
    // Child body plus the parent body it inherits, in one executable payload.
    expect(String(merged?.['content'])).toContain('child-step-body');
    expect(String(merged?.['content'])).toContain('parent-step-body');

    const contracts = (merged?.['effective_contracts'] as Array<Record<string, unknown>>) ?? [];
    const cmds = contracts.map((entry) => {
      const contract = entry['contract'] as Record<string, unknown> | undefined;
      const shell = contract?.['shell'] as Record<string, unknown> | undefined;
      return shell?.['cmd'];
    });
    expect(cmds).toEqual(expect.arrayContaining(['echo child-step', 'echo parent-step']));
    expect(merged?.['resolved_reason']).toBeUndefined();
  }, 600_000);
});

describe('HTTP activation: ontology context stays inside the adapter scope', () => {
  test('POST /api/activate carries the caller context and reads only the stored space', async () => {
    const reply = await server.post('/api/activate', {
      query: 'http child adapter inheritance',
      space: 'personal',
      context: { task: 'execute_child', domain: 'go' },
      max_choices: 20
    });
    expect(reply.status).toBe(200);

    const ontology = reply.body['ontology_context'] as Record<string, unknown> | undefined;
    expect(ontology).toBeDefined();

    // Scope: the adapter's own stored space, keyed by that space — never a global lookup.
    const scope = ontology?.['scope'] as Record<string, unknown>;
    const spaceId = String(scope['space_id']);
    expect(spaceId.length).toBeGreaterThan(0);
    expect(scope['adapter_key']).toBe(`adapter:${spaceId}:${CHILD}`);
    expect(['stored-record', 'stored-content-policy', 'write-context']).toContain(scope['space_source']);

    // The canonical `context` field crossed the HTTP route into the shared core verbatim.
    const filters = ontology?.['context'] as Record<string, unknown>;
    expect(filters['task']).toBe('execute_child');
    expect(filters['domain']).toBe('go');
    const sources = filters['sources'] as Record<string, string>;
    expect(sources['task']).toBe('caller-declared');
    expect(sources['domain']).toBe('caller-declared');
    // `org` is a permitted group space only; auth-disabled context has none.
    if (filters['org'] !== null) expect(sources['org']).toBe('permitted-space');

    // Relationships are the real inheritance path of this adapter, keyed in its own scope.
    const relationships = (ontology?.['relationships'] as Array<Record<string, unknown>>) ?? [];
    const parentRelationship = relationships.find((row) => row['type'] === 'inherits');
    expect(parentRelationship).toBeDefined();
    expect(parentRelationship?.['target']).toBe(`adapter:${spaceId}:${PARENT}`);
    expect(parentRelationship?.['depth']).toBe(1);

    // Evidence and evolution are read-only projections with real counters.
    const evidence = ontology?.['evidence'] as Record<string, unknown>;
    expect(typeof evidence['open_anomalies']).toBe('number');
    expect(typeof evidence['pending_proposals']).toBe('number');
    expect(Array.isArray(evidence['anomalies'])).toBe(true);
    const evolution = ontology?.['evolution'] as Record<string, unknown>;
    expect(typeof evolution['explanation']).toBe('string');
    expect(Array.isArray(evolution['applied'])).toBe(true);
    expect(ontology?.['degraded']).toBeNull();
  }, 600_000);
});

describe('HTTP write gate: a structural override is vetoed before any write', () => {
  test('override of `inherits` is refused and leaves no adapter and no changed parent', async () => {
    const before = await exportMarkdown(server, `squadrules://adapter/${PARENT}`);
    expect(before.status).toBe(200);

    const vetoed = await forkTrain(server, 
      httpAdapterDoc({
        title: 'Http Veto Child',
        inherits: PARENT,
        override: ['inherits'],
        sections: [{ heading: 'Step', body: 'veto-body' }],
        contract: shellContract('echo veto')
      })
    );
    expect(vetoed.status).toBe(400);
    expect(vetoed.body['error']).toBe('INHERITANCE_STRUCTURE_INVALID');
    expect(String(vetoed.body['message'])).toContain('structural_override_forbidden');

    // Nothing was written: the vetoed adapter is not exportable.
    const after = await exportMarkdown(server, `squadrules://adapter/${VETO_CHILD}`);
    expect(after.status).toBeGreaterThanOrEqual(400);

    // The parent head is byte-identical: the rejected child never touched its lineage.
    const parentAfter = await exportMarkdown(server, `squadrules://adapter/${PARENT}`);
    expect(parentAfter.status).toBe(200);
    expect(parentAfter.body['content']).toBe(before.body['content']);
  }, 600_000);
});

describe('HTTP export history: current head, one snapshot, no head fallback', () => {
  test('the head export, the versioned snapshot and a missing version behave distinctly', async () => {
    const head = await exportMarkdown(server, `squadrules://adapter/${PARENT}`);
    expect(head.status).toBe(200);
    expect(String(head.body['content'])).toContain('parent-step-body');
    // A head export carries no snapshot metadata: it is the current bytes, not history.
    expect(head.body['snapshot_sha256']).toBeUndefined();

    // `version_number` is the monotonic per-entity sequence (1, 2, 3 …); the adapter's
    // own semantic version travels alongside it as `adapter_version`.
    const historical = await exportMarkdown(server, `squadrules://adapter/${PARENT}`, '1');
    expect(historical.status).toBe(200);
    expect(historical.body['history_version']).toBe('1');
    expect(historical.body['adapter_version']).toBe('1.0.0');
    expect(historical.body['history_versions']).toBeGreaterThanOrEqual(1);
    // The snapshot carries the digest of exactly the bytes it returns — recomputed here,
    // not trusted.
    const snapshotContent = String(historical.body['content']);
    expect(historical.body['snapshot_sha256']).toBe(createHash('sha256').update(snapshotContent).digest('hex'));
    expect(snapshotContent).toContain('parent-step-body');
    // History stores the authored bytes; a head export rebuilds the stored layers
    // (adds the resolved slug, normalises the contract). Different artefacts, so the
    // version selector must be the only way to reach the authored snapshot.
    expect(snapshotContent).not.toBe(head.body['content']);

    const missing = await exportMarkdown(server, `squadrules://adapter/${PARENT}`, '9.9.9');
    expect(missing.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(missing.body)).toContain('9.9.9');
    // Never a silent head fallback for a version that does not exist.
    expect(missing.body['content']).toBeUndefined();
  }, 600_000);
});

describe('HTTP activation: an incomplete chain is diagnosed, never reported resolved', () => {
  test('a child whose declared parent is absent reports resolved=false naming the parent', async () => {
    const orphan = await forkTrain(server, 
      httpAdapterDoc({
        title: 'Http Orphan Child',
        inherits: GHOST_PARENT,
        sections: [{ heading: 'Step', body: 'orphan-body' }],
        contract: shellContract('echo orphan')
      })
    );
    // A missing parent is a warning at write time, not a structural veto.
    expect(orphan.status).toBe(200);
    expect(orphan.slug).toBe(ORPHAN_CHILD);

    const reply = await server.post('/api/activate', { query: 'http orphan child adapter', space: 'personal', max_choices: 20 });
    expect(reply.status).toBe(200);
    expect(reply.body['inheritance_resolved']).toBe(false);
    const choices = (reply.body['choices'] as Array<Record<string, unknown>>) ?? [];
    const orphanChoice = choices.find((choice) => choice['slug'] === ORPHAN_CHILD);
    expect(orphanChoice).toBeDefined();
    const merged = orphanChoice?.['merged_adapter_content'] as Record<string, unknown> | undefined;
    expect(merged?.['resolved']).toBe(false);
    const reason = String(merged?.['resolved_reason'] ?? '');
    expect(reason).toContain(GHOST_PARENT);
  }, 600_000);
});

describe('HTTP forward: merged content executes and the checkpoint is cleaned up', () => {
  test('POST /api/forward runs the child contract over the merged body and leaves no checkpoint', async () => {
    const reply = await server.post('/api/forward', { uri: `squadrules://adapter/${CHILD}` });
    expect(reply.status).toBe(200);
    expect(reply.body['current_layer']).toBeDefined();

    // The nearest contract is the executable one…
    const contract = reply.body['contract'] as Record<string, unknown>;
    expect(contract['type']).toBe('shell');
    expect(String((contract['shell'] as Record<string, unknown>)['cmd'])).toBe('echo child-step');
    // …and the body the agent receives is the merged child + parent payload.
    const content = String((reply.body['current_layer'] as Record<string, unknown>)['content']);
    expect(content).toContain('child-step-body');
    expect(content).toContain('parent-step-body');

    // The continuation URI carries the execution id, which is the checkpoint identity.
    const nextCall = reply.body['next_call'] as Record<string, unknown>;
    const args = nextCall['args'] as Record<string, unknown>;
    expect(String(args['uri'])).toMatch(/^squadrules:\/\/layer\/[0-9a-f-]+\?execution_id=[0-9a-f-]+$/i);

    // Terminal cleanup: a finished walk removes its recovery checkpoint (ADR 0043).
    const checkpointDir = join(server.dir, 'checkpoints');
    let leftovers: string[] = [];
    try {
      leftovers = readdirSync(checkpointDir).filter((entry) => entry.startsWith('inheritance-'));
    } catch {
      // No directory at all is the strongest form of "nothing left behind".
      leftovers = [];
    }
    expect(leftovers).toEqual([]);
  }, 600_000);
});
