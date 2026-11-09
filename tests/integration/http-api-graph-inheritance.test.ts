/**
 * HTTP API — in-process graph suites (ADR 0009/0042–0047).
 *
 * These cases need to read the graph directly (`GraphRepository.findPathToRoot`,
 * `getAdapter`) next to the HTTP responses, so they run the production Express app
 * inside the Jest realm against a real embedded LadybugDB + LanceDB. Vector-dependent
 * behaviour (activate/search) lives in `http-api-graph-api.test.ts`, which drives the
 * shipped server in a child process because real ONNX must not run in a Jest vm realm
 * (ADR 0004) and a fake embedder is not allowed.
 *
 * Covers:
 *   1. a plain parent write followed by a child write declaring `inherits:` projects
 *      the inheritance edge into the graph immediately;
 *   2. a structural `override` is vetoed before any write, leaving no node, no
 *      exportable adapter and an untouched parent head;
 *   3. two independent runtimes in one process: closing one listener + graph leaves the
 *      other serving and its data intact.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HttpGraphFixture, loadHttpModules, type HttpModules, type HttpRuntime } from './http-api-graph-fixture.js';
import { httpAdapterDoc, shellContract } from './http-api-graph-docs.js';

jest.setTimeout(180_000);

const PARENT = 'http-parent-adapter';
const CHILD = 'http-child-adapter';
const VETO_CHILD = 'http-veto-child';

let modules: HttpModules;
let fixture: HttpGraphFixture;
let runtime: HttpRuntime;

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
  const root = mkdtempSync(join(tmpdir(), 'squadrules-http-inh-'));
  modules = await loadHttpModules(root);
  fixture = new HttpGraphFixture(modules);
  runtime = await fixture.openRuntime('inheritance');
  const parent = await fixture.forkTrain(runtime, parentDoc());
  if (parent.reply.status !== 200) throw new Error(`parent fork: ${JSON.stringify(parent.reply)}`);
  expect(parent.slug).toBe(PARENT);
  const child = await fixture.forkTrain(runtime, childDoc());
  if (child.reply.status !== 200) throw new Error(`child fork: ${JSON.stringify(child.reply)}`);
  expect(child.slug).toBe(CHILD);
});

afterAll(async () => {
  await fixture?.dispose();
});

describe('HTTP inheritance write: the edge is projected at write time', () => {
  test('the child write creates a real inheritance edge to the parent', async () => {
    const personal = modules.tenant.defaultSpaceContext().defaultWriteSpaceId;
    const childKey = modules.scope.adapterGraphKey(personal, CHILD);
    const path = await runtime.graph.findPathToRoot(childKey, 'root-first');
    const slugs = path.map((row) => ('slug' in row.ancestor ? row.ancestor.slug : row.ancestor.name));
    expect(slugs).toEqual([PARENT]);
  });

  test('the parent node exists in the graph and carries no parent of its own', async () => {
    const personal = modules.tenant.defaultSpaceContext().defaultWriteSpaceId;
    const parentKey = modules.scope.adapterGraphKey(personal, PARENT);
    expect(await runtime.graph.getAdapter(parentKey)).not.toBeNull();
    expect(await runtime.graph.findPathToRoot(parentKey, 'root-first')).toEqual([]);
  });
});

describe('HTTP write gate: a structural override is vetoed before any write', () => {
  test('override of `inherits` is refused and leaves no store or graph trace', async () => {
    const before = await fixture.exportMarkdown(runtime, `squadrules://adapter/${PARENT}`);
    expect(before.status).toBe(200);

    const vetoed = await fixture.forkTrain(
      runtime,
      httpAdapterDoc({
        title: 'Http Veto Child',
        inherits: PARENT,
        override: ['inherits'],
        sections: [{ heading: 'Step', body: 'veto-body' }],
        contract: shellContract('echo veto')
      })
    );
    expect(vetoed.reply.status).toBe(400);
    expect(vetoed.reply.body['error']).toBe('INHERITANCE_STRUCTURE_INVALID');
    expect(String(vetoed.reply.body['message'])).toContain('structural_override_forbidden');

    // No write happened: the vetoed adapter is neither stored nor in the graph.
    const after = await fixture.exportMarkdown(runtime, `squadrules://adapter/${VETO_CHILD}`);
    expect(after.status).toBeGreaterThanOrEqual(400);
    const personal = modules.tenant.defaultSpaceContext().defaultWriteSpaceId;
    const node = await runtime.graph.getAdapter(modules.scope.adapterGraphKey(personal, VETO_CHILD));
    expect(node).toBeNull();

    // The parent head is byte-identical: the rejected child did not touch its lineage.
    const parentAfter = await fixture.exportMarkdown(runtime, `squadrules://adapter/${PARENT}`);
    expect(parentAfter.status).toBe(200);
    expect(parentAfter.body['content']).toBe(before.body['content']);
    expect(String(parentAfter.body['content'])).toContain('parent-step-body');
  });
});

describe('Two independent runtimes in one process', () => {
  test('closing runtime A leaves runtime B serving its own store and graph', async () => {
    const other = await fixture.openRuntime('second');
    const otherParent = await fixture.forkTrain(other, parentDoc());
    if (otherParent.reply.status !== 200) throw new Error(`second parent fork: ${JSON.stringify(otherParent.reply)}`);
    const otherChild = await fixture.forkTrain(
      other,
      httpAdapterDoc({
        title: 'Http Child Adapter',
        inherits: PARENT,
        override: ['domain'],
        extra: { domain: 'go' },
        sections: [{ heading: 'Child Step', body: 'second-child-body' }],
        contract: shellContract('echo second-child')
      })
    );
    if (otherChild.reply.status !== 200) throw new Error(`second child fork: ${JSON.stringify(otherChild.reply)}`);
    expect(otherChild.slug).toBe(CHILD);
    expect(other.baseUrl).not.toBe(runtime.baseUrl);

    // Close A completely: listener, graph, and record store.
    await runtime.closeServer();
    await runtime.graph.close();

    // B still answers over HTTP with its own child content.
    const exported = await fixture.exportMarkdown(other, `squadrules://adapter/${CHILD}`);
    expect(exported.status).toBe(200);
    // B serves its own write, not the bytes of the runtime that was closed.
    expect(String(exported.body['content'])).toContain('second-child-body');
    expect(String(exported.body['content'])).toContain('slug: http-child-adapter');

    // B's graph still resolves its own lineage (A's graph handle is closed, B's is not).
    const personal = modules.tenant.defaultSpaceContext().defaultWriteSpaceId;
    const childKey = modules.scope.adapterGraphKey(personal, CHILD);
    const path = await other.graph.findPathToRoot(childKey, 'root-first');
    const slugs = path.map((row) => ('slug' in row.ancestor ? row.ancestor.slug : row.ancestor.name));
    expect(slugs).toEqual([PARENT]);
  });
});
