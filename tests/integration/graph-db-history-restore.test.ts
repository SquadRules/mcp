/**
 * Graph-native history, export-version and restore (ADR 0045) — real LadybugDB,
 * real LanceDB, real `train` / `tune` / `export` code paths. No mocks.
 *
 * What this suite pins:
 *
 *   1. Every successful `train`/`tune` appends one immutable snapshot with a
 *      monotonic `version_number`, its `parent_version`, the byte digest of the
 *      exact durable document, the runtime-derived actor, and the stored space.
 *   2. The snapshot carries the full document, which is the only reason a restore
 *      can go back through the normal validators instead of a graph-only rollback.
 *      It is the *stored* document, not the submitted bytes: the writer adds
 *      `required: true` to a gate, so the snapshot must describe what a restore
 *      would actually activate.
 *   3. `export` with `version` returns that snapshot digest-verified, and refuses
 *      an unknown version instead of returning the current head.
 *   4. A restore is an ordinary `train` whose bytes equal an earlier snapshot: it
 *      appends a new `restored` row naming the source snapshot and leaves the old
 *      row byte-identical.
 *   5. A stale `expected_version` fails closed with `VERSION_CONFLICT` and appends
 *      nothing.
 *   6. History survives closing and reopening the database directory.
 *   7. One slug in two spaces is two independent histories.
 */
import { createHash } from 'node:crypto';

import {
  GraphFixture,
  adapterDoc,
  commentContract,
  loadProductionModules,
  type ProductionModules,
  type Runtime
} from './graph-db-fixture.js';

const SPACE_A = 'space:it-history-a';
const SPACE_B = 'group:it-history-b';
const SLUG = 'history-adapter';
const URI = `squadrules://adapter/${SLUG}`;

let modules: ProductionModules;
let fixture: GraphFixture;

function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** One-layer adapter document; `body` is the only varying part. */
function doc(version: string, body: string, slug = SLUG): string {
  return adapterDoc({
    slug,
    version,
    title: slug === SLUG ? 'History Adapter' : 'History Adapter B',
    sections: [{ heading: 'Step 1', body }],
    contract: commentContract(body)
  });
}

beforeAll(async () => {
  modules = await loadProductionModules();
  fixture = new GraphFixture(modules);
});

afterAll(async () => {
  await fixture.dispose();
});

describe('monotonic snapshots for train and tune (ADR 0045)', () => {
  let runtime: Runtime;
  let key: string;
  const first = doc('1.0.0', 'first body');
  const second = doc('1.1.0', 'second body');
  /** Snapshot bytes as the graph recorded them; later tests read history from these. */
  let snapshotOne = '';
  let snapshotTwo = '';

  beforeAll(async () => {
    runtime = await fixture.openRuntime('history');
    key = modules.scope.adapterGraphKey(SPACE_A, SLUG);
  });

  test('a successful train appends snapshot 1 with content, digest, actor and space', async () => {
    const { headUuid } = await fixture.train(runtime, SPACE_A, first);
    const stored = await fixture.storedHead(runtime, headUuid);
    expect(stored.space_id).toBe(SPACE_A);

    const snapshot = await runtime.graph.getLatestVersion(key);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.version_number).toBe('1');
    expect(snapshot!.parent_version).toBeNull();
    expect(snapshot!.change_type).toBe('created');
    // The full document is stored, not only a digest: that is what makes restore possible.
    // These are the durable bytes, not the submitted ones (G3) — the stored gate carries
    // `required: true`, which the authored document did not spell out.
    expect(snapshot!.content).not.toBe(first);
    expect(snapshot!.content).toContain('first body');
    expect(snapshot!.content).toContain('"required":true');
    expect(snapshot!.content).toContain('## Reward Signal');
    expect(snapshot!.content_digest).toBe(sha(snapshot!.content));
    expect(snapshot!.space).toBe(SPACE_A);
    // Identity comes from the tenant context, never from the document.
    expect(snapshot!.changed_by).toBe('user-it');
    expect(snapshot!.actor_source).toBe('auth-subject');
    snapshotOne = snapshot!.content;
  });

  test('a successful tune appends snapshot 2 linked to snapshot 1', async () => {
    const tuned = await fixture.tune(runtime, SPACE_A, URI, second);
    expect(tuned.results[0]!.status).toBe('updated');

    const latest = await runtime.graph.getLatestVersion(key);
    expect(latest!.version_number).toBe('2');
    expect(latest!.parent_version).toBe('1');
    expect(latest!.change_type).toBe('updated');
    expect(latest!.content).toContain('second body');
    // `tune` preserves the stored gate on a prose edit. The recorded body must carry the
    // preserved contract; snapshotting the submitted document would have recorded the
    // re-authored gate the adapter never activated (G3).
    expect(latest!.content).toContain('"text":"first body"');
    expect(latest!.content).not.toContain('"text":"second body"');
    expect(latest!.content).not.toBe(snapshotOne);
    expect(latest!.content_digest).toBe(sha(latest!.content));
    snapshotTwo = latest!.content;

    const history = await runtime.graph.listVersions(key);
    expect(history.map((row) => row.version_number).sort()).toEqual(['1', '2']);
  });

  test('export with a version selector returns snapshot 1 digest-verified', async () => {
    const exported = await fixture.onSpace(SPACE_A, () =>
      modules.exportHistory.executeExportVersion(runtime.memoryStore, runtime.qdrantService, {
        uri: URI,
        version: '1',
        format: 'markdown',
        include_reward: false
      })
    );

    expect(exported.format).toBe('markdown');
    expect(exported.content).toBe(snapshotOne);
    expect(exported.history_version).toBe('1');
    expect(exported.history_versions).toBe(2);
    expect(exported.snapshot_sha256).toBe(sha(snapshotOne));
    expect(exported.space_id).toBe(SPACE_A);
    // The current head is snapshot 2, so this is genuinely the historical row.
    expect(exported.content).not.toBe(snapshotTwo);
  });

  test('export refuses an unknown version instead of returning the head', async () => {
    await expect(
      fixture.onSpace(SPACE_A, () =>
        modules.exportHistory.executeExportVersion(runtime.memoryStore, runtime.qdrantService, {
          uri: URI,
          version: '99',
          format: 'markdown',
          include_reward: false
        })
      )
    ).rejects.toThrow(/has no version 99/);
  });

  test('restore is a normal train: new restored row, old snapshot byte-identical', async () => {
    // A restore re-submits the bytes `export` handed back.
    const restored = await fixture.train(runtime, SPACE_A, snapshotOne, { expectedVersion: '1.1.0' });
    expect(restored.output.status).toBe('stored');

    const latest = await runtime.graph.getLatestVersion(key);
    expect(latest!.version_number).toBe('3');
    expect(latest!.parent_version).toBe('2');
    expect(latest!.change_type).toBe('restored');
    expect(latest!.reason).toContain('restored from snapshot 1');
    // Restoring recovered exactly the recorded state: the rebuilt body is idempotent, so
    // re-storing snapshot 1's bytes yields snapshot 1's bytes again (G3).
    expect(latest!.content).toBe(snapshotOne);

    // The earlier snapshot is never rewritten by a restore.
    const original = await runtime.graph.getVersion(key, '1');
    expect(original!.version_number).toBe('1');
    expect(original!.parent_version).toBeNull();
    expect(original!.content).toBe(snapshotOne);
    expect(original!.content_digest).toBe(sha(snapshotOne));
    expect(original!.change_type).toBe('created');
  });

  test('a stale expected_version fails closed and appends no snapshot', async () => {
    const before = await runtime.graph.listVersions(key);
    const conflicted = await fixture.tune(runtime, SPACE_A, URI, doc('1.2.0', 'stale base'), {
      expectedVersion: '0.0.1'
    });

    expect(conflicted.results[0]!.status).toBe('error');
    expect(conflicted.results[0]!.message).toContain('VERSION_CONFLICT');
    expect(conflicted.total_updated).toBe(0);

    const after = await runtime.graph.listVersions(key);
    expect(after.map((row) => row.version_number).sort()).toEqual(before.map((row) => row.version_number).sort());
    // The stored head is still the restored bytes, not the rejected content.
    expect((await runtime.graph.getLatestVersion(key))!.content).toBe(snapshotOne);
  });

  test('history survives closing and reopening the database directory', async () => {
    await runtime.graph.close();
    const reopened = await fixture.openGraphAt(runtime.dirs.graph);

    const history = await reopened.listVersions(key);
    expect(history.map((row) => row.version_number).sort()).toEqual(['1', '2', '3']);
    const snapshot = await reopened.getVersion(key, '2');
    expect(snapshot!.content).toBe(snapshotTwo);
    expect(snapshot!.content_digest).toBe(sha(snapshotTwo));
  });
});

describe('scope isolation (ADR 0042)', () => {
  test('one slug in two spaces is two identities with independent histories', async () => {
    const runtimeA = await fixture.openRuntime('scope-a');
    const runtimeB = await fixture.openRuntime('scope-b');
    const docA = doc('3.0.0', 'space a body');
    const docB = doc('4.0.0', 'space b body');

    await fixture.train(runtimeA, SPACE_A, docA);
    await fixture.train(runtimeB, SPACE_B, docB);

    const keyA = modules.scope.adapterGraphKey(SPACE_A, SLUG);
    const keyB = modules.scope.adapterGraphKey(SPACE_B, SLUG);
    expect(keyA).not.toBe(keyB);

    const historyA = await runtimeA.graph.listVersions(keyA);
    const historyB = await runtimeB.graph.listVersions(keyB);
    expect(historyA).toHaveLength(1);
    expect(historyB).toHaveLength(1);
    // Each space recorded its own durable body — no cross-space bleed.
    expect(historyA[0]!.content).toContain('space a body');
    expect(historyA[0]!.content).not.toContain('space b body');
    expect(historyB[0]!.content).toContain('space b body');
    expect(historyB[0]!.content).not.toContain('space a body');
    expect(historyA[0]!.content_digest).toBe(sha(historyA[0]!.content));
    expect(historyB[0]!.content_digest).toBe(sha(historyB[0]!.content));
    expect(historyA[0]!.space).toBe(SPACE_A);
    expect(historyB[0]!.space).toBe(SPACE_B);

    // Neither graph can read the other space's identity.
    expect(await runtimeA.graph.getLatestVersion(keyB)).toBeNull();
    expect(await runtimeB.graph.getLatestVersion(keyA)).toBeNull();
  });
});
