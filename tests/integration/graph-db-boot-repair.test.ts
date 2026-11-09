/**
 * Warm-boot graph repair — real `bootLocalRuntime()`, real LanceDB, real LadybugDB.
 * NO MOCKS: nothing in this suite replaces the boot sequence or the stores.
 *
 * What this suite pins (delivery contract):
 *
 *   1. A warm boot that finds its graph gone — a fresh graph directory, the same
 *      persisted records — rebuilds adapter nodes and inheritance edges from the
 *      store, and rewrites neither stored bytes nor graph history.
 *   2. When the store holds an adapter newer than the shipped bundled copy, the graph
 *      carries the stored version/title/frontmatter, never the bundled ones, and the
 *      stored record is not retrained or re-embedded by the boot.
 *   3. A graph that cannot be opened degrades to `null`: the boot still returns a
 *      usable runtime, and reconciliation reports itself skipped instead of a phantom
 *      success.
 *   4. The warm-seed decision is asked of the store the runtime was handed, never of the
 *      process-default directory: a warm store kept elsewhere is not reseeded, and an
 *      empty store is not called seeded because a different store is warm.
 *
 * Honest verification: every assertion is on observable state produced by the boot
 * (`graphDb !== null`, node/edge content, stored-payload digests), never merely on
 * "the call did not throw". A boot that silently skips reconciliation fails here.
 *
 * Setup (writing adapter records before the boot) is the only direct store use, it is
 * labelled at each call site, and it runs through the production write path. Graph
 * topology assertions always traverse a real `bootLocalRuntime()`.
 */
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { BootFixture, adapterMarkdown, loadBootModules, type BootModules } from './graph-db-boot-fixture.js';

let modules: BootModules;
let fixture: BootFixture;

/** Ancestor slugs of a `findPathToRoot` result, root first. */
function ancestorSlugs(path: Array<{ ancestor: { slug?: string; name?: string } }>): string[] {
  return path.map((row) => ('slug' in row.ancestor ? (row.ancestor.slug ?? '') : (row.ancestor.name ?? '')));
}

beforeAll(async () => {
  modules = await loadBootModules();
  fixture = new BootFixture(modules);
});

afterAll(async () => {
  await fixture.dispose();
});

describe('warm boot reconciliation (end-to-end through bootLocalRuntime)', () => {
  test('a fresh graph path rebuilds nodes and edges from stored records without rewriting them', async () => {
    const { home, recordsDir } = fixture.freshHome('warm-repair');
    const appSpaceId = modules.appSpaceId;

    // SETUP: what a previous process left in the store. The child is written before
    // its parent on purpose — the node pass must still let the edge resolve.
    const setupStore = await fixture.openStore(recordsDir);
    await fixture.seed(setupStore, [
      adapterMarkdown({
        slug: 'boot-child',
        version: '1.3.0',
        title: 'Boot Child Adapter',
        inherits: 'boot-parent',
        contractText: 'Child step.'
      }),
      adapterMarkdown({
        slug: 'boot-parent',
        version: '1.2.0',
        title: 'Boot Parent Adapter',
        contractText: 'Parent step.'
      })
    ]);
    const before = await fixture.fingerprint(setupStore, appSpaceId);
    // One head layer per seeded adapter; the exact count is not the contract, the
    // digest equality below is.
    expect(before.count).toBeGreaterThanOrEqual(2);

    const childKey = modules.scope.adapterGraphKey(appSpaceId, 'boot-child');
    const parentKey = modules.scope.adapterGraphKey(appSpaceId, 'boot-parent');

    // First real boot: the graph for the warm store is built.
    const warm = await fixture.boot(join(home, 'graph-warm'), setupStore);
    expect(warm.runtime.graphDb).not.toBeNull();
    const warmGraph = warm.runtime.graphDb!;
    expect(warmGraph.isInitialized()).toBe(true);

    expect(await warmGraph.getAdapter(parentKey)).not.toBeNull();
    expect((await warmGraph.getAdapter(childKey))?.version).toBe('1.3.0');
    expect(ancestorSlugs(await warmGraph.findPathToRoot(childKey))).toEqual(['boot-parent']);
    // Boot projects topology only: it appends no version history.
    expect(await warmGraph.listVersions(childKey)).toEqual([]);

    // End the first runtime the way a process shutdown does. Stored bytes and the
    // old graph directory both survive; the next boot simply opens somewhere new.
    await fixture.closeBootedGraphs();

    // Graph loss: an empty directory and the same persisted records behind a fresh
    // store handle (what a restarted process gets). Nothing is deleted anywhere.
    const repairGraphDir = join(home, 'graph-repair');
    expect(existsSync(repairGraphDir)).toBe(false);
    const repairStore = await fixture.openStore(recordsDir);
    const repaired = await fixture.boot(repairGraphDir, repairStore);

    // The repair produced a real graph, not just a runtime that did not throw: the
    // boot created a database at the fresh path.
    expect(existsSync(join(repairGraphDir, 'squadrules-graph.lbug'))).toBe(true);
    expect(repaired.runtime.graphDb).not.toBeNull();
    const repairedGraph = repaired.runtime.graphDb!;
    expect(repairedGraph.isInitialized()).toBe(true);

    expect(await repairedGraph.getAdapter(parentKey)).not.toBeNull();
    expect((await repairedGraph.getAdapter(childKey))?.version).toBe('1.3.0');
    expect(ancestorSlugs(await repairedGraph.findPathToRoot(childKey))).toEqual(['boot-parent']);
    // Rebuilding topology is not history: nothing was appended to the new graph either.
    expect(await repairedGraph.listVersions(childKey)).toEqual([]);

    // Recovery is a pure projection: not one stored payload changed, so no adapter was
    // rewritten or re-embedded to make the graph come back.
    expect(await fixture.fingerprint(repairStore, appSpaceId)).toEqual(before);
  });

  test('a stored adapter newer than the bundled copy is what the graph carries', async () => {
    const { home, recordsDir } = fixture.freshHome('stored-newer');
    const appSpaceId = modules.appSpaceId;

    const bundled = fixture.bundledAdapter('refine-search');
    expect(bundled.version).not.toBe('');
    // The premise must hold at run time, not just when this test was written.
    expect(modules.versionCompare.compareSemver(bundled.version, '9.0.0')).toBe(-1);

    // SETUP: a store that already holds `refine-search` ahead of the shipped version,
    // with a distinct title and a field the bundle does not declare.
    const store = await fixture.openStore(recordsDir);
    await fixture.seed(store, [
      adapterMarkdown({
        slug: 'refine-search',
        version: '9.0.0',
        title: 'Stored Refine Search (newer)',
        extraFrontmatter: { x_stored_only: 'kept' },
        contractText: 'Stored copy step.'
      })
    ]);
    const before = await fixture.fingerprint(store, appSpaceId);
    expect(before.count).toBeGreaterThanOrEqual(1);

    const booted = await fixture.boot(join(home, 'graph-stored-newer'), store);
    expect(booted.runtime.graphDb).not.toBeNull();
    const graph = booted.runtime.graphDb!;
    const node = await graph.getAdapter(modules.scope.adapterGraphKey(appSpaceId, 'refine-search'));

    expect(node).not.toBeNull();
    // Stored metadata wins over the bundled copy on every observable field.
    expect(node?.version).toBe('9.0.0');
    expect(node?.title).toBe('Stored Refine Search (newer)');
    expect(node?.frontmatter?.x_stored_only).toBe('kept');

    // A newer stored copy must not be retrained, replaced or re-embedded by the boot.
    expect(await fixture.fingerprint(store, appSpaceId)).toEqual(before);
  });

  test('a graph that cannot be opened degrades to null and leaves a usable runtime', async () => {
    const { home, recordsDir } = fixture.freshHome('degraded');
    const appSpaceId = modules.appSpaceId;

    // SETUP: a warm store, so the degraded boot still has data to serve.
    const store = await fixture.openStore(recordsDir);
    await fixture.seed(store, [
      adapterMarkdown({
        slug: 'degraded-kept',
        version: '1.0.0',
        title: 'Degraded Kept Adapter',
        contractText: 'Kept step.'
      })
    ]);
    const before = await fixture.fingerprint(store, appSpaceId);
    expect(before.count).toBeGreaterThanOrEqual(1);

    // A regular file where the graph directory belongs: opening the embedded database
    // below it fails, which is the real failure the boot must survive.
    const brokenGraphPath = join(home, 'graph-path-is-a-file');
    writeFileSync(brokenGraphPath, 'not a directory\n', 'utf8');

    const booted = await fixture.boot(brokenGraphPath, store);

    // Truthful signal: `null`, not a half-open graph and not a thrown boot.
    expect(booted.runtime.graphDb).toBeNull();
    expect(modules.owner.getGraphDb(booted.runtime.memoryStore)).toBeNull();

    // The runtime is still usable: stored data is still served without a graph, and the
    // degraded boot rewrote nothing while failing to open it.
    expect(await booted.runtime.memoryStore.getStoredAdapterVersion('degraded-kept')).toBe('1.0.0');
    expect(await fixture.fingerprint(store, appSpaceId)).toEqual(before);

    // Reconciliation reports "skipped" instead of claiming a successful projection.
    const report = await modules.sync.reconcileAdapterGraphFromStore(
      booted.runtime.graphDb,
      booted.runtime.memoryStore,
      [appSpaceId]
    );
    expect(report.skipped).toBe(true);
    expect(report.nodes).toBe(0);
    expect(report.edges).toBe(0);
  });

  test('a warm store outside the process default repairs the graph without seeding', async () => {
    // The store this runtime owns lives where the process default does not: `<home>/lancedb`
    // stays absent for the whole scenario. A seeded decision that read that lane would
    // answer "cold" and re-run boot injection, which with this suite's unreachable
    // provider throws — so this scenario fails loudly on that regression.
    const { home } = fixture.freshHome('foreign-records');
    const appSpaceId = modules.appSpaceId;
    const defaultRecordsDir = join(home, 'lancedb');
    expect(existsSync(defaultRecordsDir)).toBe(false);

    const instanceRecordsDir = join(home, 'instance-records');
    // SETUP: a warm store at a path of its own.
    const store = await fixture.openStore(instanceRecordsDir);
    await fixture.seed(store, [
      adapterMarkdown({
        slug: 'outside-parent',
        version: '2.1.0',
        title: 'Outside Parent Adapter',
        contractText: 'Outside parent step.'
      }),
      adapterMarkdown({
        slug: 'outside-child',
        version: '2.2.0',
        title: 'Outside Child Adapter',
        inherits: 'outside-parent',
        contractText: 'Outside child step.'
      })
    ]);
    const before = await fixture.fingerprint(store, appSpaceId);
    expect(before.count).toBeGreaterThanOrEqual(2);

    // The decision the boot makes, asked of the same store through the production check.
    expect(await modules.boot.isEmbeddedStoreSeeded(store)).toBe(true);

    const booted = await fixture.boot(join(home, 'graph-outside-default'), store);
    expect(booted.runtime.graphDb).not.toBeNull();
    const graph = booted.runtime.graphDb!;
    expect(graph.isInitialized()).toBe(true);

    const parentKey = modules.scope.adapterGraphKey(appSpaceId, 'outside-parent');
    const childKey = modules.scope.adapterGraphKey(appSpaceId, 'outside-child');
    expect(await graph.getAdapter(parentKey)).not.toBeNull();
    expect((await graph.getAdapter(childKey))?.version).toBe('2.2.0');
    expect(ancestorSlugs(await graph.findPathToRoot(childKey))).toEqual(['outside-parent']);

    // A warm store is not reseeded: same records, same payload digests, and no bundled
    // adapter was injected alongside them.
    expect(await fixture.fingerprint(store, appSpaceId)).toEqual(before);

    // Nothing was created in the lane the process default names, so its absence never
    // entered the boot's decision about this store.
    expect(existsSync(defaultRecordsDir)).toBe(false);
  });

  test('two stores in one process answer the seeded question for themselves', async () => {
    const { home } = fixture.freshHome('two-instance-decision');
    const appSpaceId = modules.appSpaceId;

    // The process-default lane, warm: the store `resolveLanceDbDir()` names.
    const defaultStore = await fixture.openStore(join(home, 'lancedb'));
    // SETUP: one adapter, so the default lane is unambiguously seeded.
    await fixture.seed(defaultStore, [
      adapterMarkdown({
        slug: 'default-lane-only',
        version: '1.0.0',
        title: 'Default Lane Only Adapter',
        contractText: 'Default lane step.'
      })
    ]);

    // A second, independent store in the same process, empty.
    const instanceStore = await fixture.openStore(join(home, 'instance-records'));

    // A warm default must not make an empty store look seeded: that answer is what
    // decides whether bundled adapters are injected into THIS store.
    expect(await modules.boot.isEmbeddedStoreSeeded(instanceStore)).toBe(false);
    // The warm store answers for itself.
    expect(await modules.boot.isEmbeddedStoreSeeded(defaultStore)).toBe(true);

    // Each answer came from its own records, not from a shared default lane.
    expect((await instanceStore.scrollSpace(appSpaceId, { paginate: true })).length).toBe(0);
    expect((await defaultStore.scrollSpace(appSpaceId, { paginate: true })).length).toBeGreaterThanOrEqual(1);
  });
});
