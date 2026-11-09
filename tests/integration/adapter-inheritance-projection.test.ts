/**
 * Inheritance end-to-end integration tests — delivery contract 1: PROJECTION.
 *
 * Real LadybugDB, real LanceDB, real `train`/`tune` code paths. No mocks, stubs, spies
 * or module fakes; the shared bootstrap and fixture documents live in
 * `adapter-inheritance-fixture.ts`.
 *
 * What this suite pins:
 *
 *   1. Every successful markdown `train` is projected, plain or inheriting, using the
 *      `space_id` of the record that was actually stored.
 *   2. A parent trained while the runtime had no graph attached is projected *before*
 *      the child edge when the child is trained after the graph is attached — no reboot.
 *   3. A `tune` that drops `inherits:` clears the old edge and the stored frontmatter,
 *      and leaves the untouched parent node alone.
 *   4. One slug in two scopes, across two runtimes, is two nodes; no singleton bleed.
 *
 * Sibling suites: `adapter-inheritance-effective-content.test.ts` (contract 2, the
 * additive/selective merge) and `adapter-inheritance-checkpoints.test.ts` (contract 4,
 * checkpoint recovery state). Split from one 857-line file to satisfy the 350-line cap.
 */
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { join } from 'node:path';

import {
  SPACE_A,
  SPACE_B,
  adapterDoc,
  commentContract,
  disposeInheritanceFixture,
  loadInheritanceFixture,
  onSpace,
  openRuntime,
  owner,
  pathSlugs,
  scope,
  storedHead,
  tempDir,
  train,
  tuneExecute
} from './adapter-inheritance-fixture.js';

beforeAll(loadInheritanceFixture);
afterAll(disposeInheritanceFixture);

describe('every successful markdown train is projected (contract 1)', () => {
  test('a plain adapter is projected from the stored head, scoped by its stored space_id', async () => {
    const runtime = await openRuntime('plain');
    const parentDoc = adapterDoc({
      slug: 'plain-parent',
      version: '1.0.0',
      title: 'Plain Parent Adapter',
      sections: [{ heading: 'Step 1', body: 'Plain parent step.' }],
      contract: commentContract('plain parent')
    });

    const head = await train(runtime, SPACE_A, parentDoc);

    // The scope is the record's own space, not a guessed tenant default.
    const stored = await storedHead(runtime, head);
    expect(stored.space_id).toBe(SPACE_A);
    expect(stored.slug).toBe('plain-parent');

    const node = await runtime.graph.getAdapter(scope.adapterGraphKey(SPACE_A, 'plain-parent'));
    expect(node).not.toBeNull();
    expect(node!.slug).toBe('plain-parent');
    expect(node!.space).toBe(SPACE_A);
    expect(node!.frontmatter?.inherits).toBeUndefined();

    // A plain adapter is a node with no parent, and it is not duplicated into a
    // different scope it was never written to.
    expect(await pathSlugs(runtime, SPACE_A, 'plain-parent')).toEqual([]);
    expect(await runtime.graph.getAdapter(scope.adapterGraphKey(SPACE_B, 'plain-parent'))).toBeNull();
  });

  test('a parent trained with no graph attached is projected before the child edge, without a reboot', async () => {
    const runtime = await openRuntime('cold-start', { attach: false });

    const parentDoc = adapterDoc({
      slug: 'cold-parent',
      version: '1.0.0',
      title: 'Cold Parent Adapter',
      sections: [{ heading: 'Step 1', body: 'Cold parent step.' }],
      contract: commentContract('cold parent')
    });
    await train(runtime, SPACE_A, parentDoc);
    // Nothing was projected: the runtime genuinely had no graph at train time.
    expect(await runtime.graph.getAllAdapters()).toEqual([]);

    owner.attachGraphDb(runtime.graph, runtime.memoryStore);

    const childDoc = adapterDoc({
      slug: 'cold-child',
      version: '1.0.0',
      title: 'Cold Child Adapter',
      inherits: 'cold-parent',
      sections: [{ heading: 'Step 1', body: 'Cold child step.' }],
      contract: commentContract('cold child')
    });
    await train(runtime, SPACE_A, childDoc);

    // The child train walked the stored ancestry and wrote the parent node first, so
    // the edge resolved on the same projection pass.
    const parentNode = await runtime.graph.getAdapter(scope.adapterGraphKey(SPACE_A, 'cold-parent'));
    expect(parentNode).not.toBeNull();
    expect(await pathSlugs(runtime, SPACE_A, 'cold-child')).toEqual(['cold-parent']);
  });

  test('a tune that drops inherits: clears the old edge and the stored frontmatter', async () => {
    const runtime = await openRuntime('tune');

    await train(
      runtime,
      SPACE_A,
      adapterDoc({
        slug: 'tune-parent',
        version: '1.0.0',
        title: 'Tune Parent Adapter',
        sections: [{ heading: 'Step 1', body: 'Tune parent step.' }],
        contract: commentContract('tune parent')
      })
    );
    const childHead = await train(
      runtime,
      SPACE_A,
      adapterDoc({
        slug: 'tune-child',
        version: '1.0.0',
        title: 'Tune Child Adapter',
        inherits: 'tune-parent',
        sections: [{ heading: 'Step 1', body: 'Tune child step.' }],
        contract: commentContract('tune child')
      })
    );
    expect(await pathSlugs(runtime, SPACE_A, 'tune-child')).toEqual(['tune-parent']);

    // The tuned document keeps the H1 and the layer count, and drops `inherits:`.
    const tunedDoc = adapterDoc({
      slug: 'tune-child',
      version: '1.0.1',
      title: 'Tune Child Adapter',
      sections: [{ heading: 'Step 1', body: 'Tune child step, revised.' }],
      contract: commentContract('tune child revised')
    });
    const verdictFile = join(tempDir('tune-verdict'), 'verdict.txt');
    const result = await onSpace(SPACE_A, () =>
      tuneExecute.executeTune(
        runtime.qdrantService,
        {
          uris: ['squadrules://adapter/tune-child'],
          content: [tunedDoc],
          review_evidence: { verdict_file: verdictFile, exit_code: 0, stdout: 'PASS' }
        },
        runtime.memoryStore
      )
    );
    expect(result.results.map((row) => row.status)).toEqual(['updated']);
    expect(result.total_updated).toBe(1);
    expect(result.total_failed).toBe(0);

    // Stored record: the topology field is gone, not shadowed by the previous value.
    const stored = await storedHead(runtime, childHead);
    expect(stored.adapter?.frontmatter?.inherits).toBeUndefined();
    expect(stored.adapter?.frontmatter?.version).toBe('1.0.1');

    // Graph: the edge is cleared, and the parent node the tune never touched survives.
    expect(await pathSlugs(runtime, SPACE_A, 'tune-child')).toEqual([]);
    const childNode = await runtime.graph.getAdapter(scope.adapterGraphKey(SPACE_A, 'tune-child'));
    expect(childNode?.frontmatter?.inherits).toBeUndefined();
    expect(await runtime.graph.getAdapter(scope.adapterGraphKey(SPACE_A, 'tune-parent'))).not.toBeNull();
  });

  test('one slug in two scopes across two runtimes is two nodes, with no singleton bleed', async () => {
    const runtimeA = await openRuntime('slug-a');
    const runtimeB = await openRuntime('slug-b');
    expect(runtimeA.graph).not.toBe(runtimeB.graph);
    expect(runtimeA.records).not.toBe(runtimeB.records);

    const spec = (title: string): string =>
      adapterDoc({
        slug: 'shared-slug',
        version: '1.0.0',
        title,
        sections: [{ heading: 'Step 1', body: 'Shared slug step.' }],
        contract: commentContract('shared slug')
      });

    // Two independent stores, each with its own tenant context: neither sees the other.
    await train(runtimeA, SPACE_A, spec('Shared Slug A Adapter'));
    await train(runtimeB, SPACE_B, spec('Shared Slug B Adapter'));

    expect(await runtimeA.graph.getAdapter(scope.adapterGraphKey(SPACE_A, 'shared-slug'))).not.toBeNull();
    expect(await runtimeA.graph.getAdapter(scope.adapterGraphKey(SPACE_B, 'shared-slug'))).toBeNull();
    expect(await runtimeB.graph.getAdapter(scope.adapterGraphKey(SPACE_B, 'shared-slug'))).not.toBeNull();
    expect(await runtimeB.graph.getAdapter(scope.adapterGraphKey(SPACE_A, 'shared-slug'))).toBeNull();

    // Each store resolves only the graph it was explicitly attached to.
    expect(owner.getGraphDb(runtimeA.memoryStore)).toBe(runtimeA.graph);
    expect(owner.getGraphDb(runtimeB.memoryStore)).toBe(runtimeB.graph);
    expect((await runtimeA.graph.getAllAdapters()).map((node) => node.space)).toEqual([SPACE_A]);
    expect((await runtimeB.graph.getAllAdapters()).map((node) => node.space)).toEqual([SPACE_B]);
  });
});
