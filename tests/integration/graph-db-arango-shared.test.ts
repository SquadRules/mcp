/**
 * Shared-backend parity: real ArangoDB <= 3.11 over its HTTP/AQL API (ADR 0044).
 *
 * Selection is explicit and never silent:
 *
 *   - `SQUADRULES_ARANGO_URL` **and** `SQUADRULES_ARANGO_DATABASE` set → this suite
 *     RUNS against the real deployment. If the server is unreachable, reports an
 *     unsupported series, cannot run a stream transaction, or the environment is
 *     incomplete, the suite FAILS. It never skips and never falls back to embedded.
 *   - Neither set → it prints the exact command and skips loudly. Shared parity is
 *     then UNPROVEN and must be reported that way, never as "equivalent".
 *   - `SQUADRULES_ARANGO_REQUIRED=true` (the CI lane) → an unconfigured run FAILS with
 *     the missing variable names. A required lane must never be satisfied by a skip.
 *
 * The scenarios mirror `graph-db-history-restore.test.ts` one for one, so a failure
 * here is a port-parity failure, not a different test.
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
import { selectSharedBackend } from './graph-db-arango-selection.js';

const SELECTION = selectSharedBackend('graph-db-arango-shared');
const ARANGO_URL = SELECTION.url;
const ARANGO_DATABASE = SELECTION.database;
const SHARED_SELECTED = SELECTION.selected;

/** Per-run suffix: rows are appended under a unique scope, never replaced or deleted. */
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

if (!SHARED_SELECTED) {
  // Jest swallows console output for a fully skipped suite, which would make this
  // skip silent. Raw stderr is not intercepted, so the banner always reaches the
  // operator and the report can never read as "shared parity proven".
  process.stderr.write(SELECTION.skipBanner);
}

if (SELECTION.required && !SHARED_SELECTED) {
  // Registered outside the shared describe blocks, which are skipped here: a lane that
  // demanded shared evidence reports a failure naming what is missing, never a green
  // file with zero executed assertions.
  test('the shared backend is configured because a lane requires it', () => {
    throw new Error(SELECTION.requirementMessage);
  });
}

let modules: ProductionModules;
let fixture: GraphFixture;

function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function space(label: string): string {
  return `space:it-arango-${RUN}-${label}`;
}

function doc(slug: string, version: string, body: string, extra: Record<string, string> = {}): string {
  return adapterDoc({
    slug,
    version,
    title: `Shared ${slug}`,
    extraFrontmatter: extra,
    sections: [{ heading: 'Step 1', body }],
    contract: commentContract(body)
  });
}

const describeShared = SHARED_SELECTED ? describe : describe.skip;

beforeAll(async () => {
  if (!SHARED_SELECTED) return;
  modules = await loadProductionModules({
    SQUADRULES_GRAPH_BACKEND: 'arango',
    SQUADRULES_GRAPH_BACKEND_STRICT: 'true'
  });
  fixture = new GraphFixture(modules);
});

afterAll(async () => {
  if (fixture) await fixture.dispose();
});

describeShared('deployment proof (ADR 0044 §2)', () => {
  test('the environment is complete when shared mode was selected', () => {
    expect(ARANGO_URL).not.toBe('');
    expect(ARANGO_DATABASE).not.toBe('');
  });

  test('the server is a supported series and really runs stream transactions', async () => {
    const arango = await import('../../src/services/graph-db/arango/arango-graph-repository.js');
    const backend = await import('../../src/config/graph-backend.js');

    const repository = new arango.ArangoGraphRepository();
    await repository.initialize();
    try {
      const capabilities = repository.getCapabilities();
      expect(capabilities).not.toBeNull();
      // Throws with the reported version when the series is outside 3.10–3.11.
      expect(() => backend.assertSupportedArangoVersion(capabilities!.version)).not.toThrow();
      // "verified" means a real begin/abort round-trip succeeded, not a claim.
      expect(capabilities!.streamTransactions).toBe('verified');
      expect(capabilities!.collections).toEqual(
        expect.arrayContaining(['Adapter', 'Version', 'Anomaly', 'Proposal', 'Confirmation', 'Inherits'])
      );
    } finally {
      await repository.close();
    }
  });

  test('the configured backend is the one opened: never an embedded substitution', async () => {
    const runtime = await fixture.openRuntime('arango-open');
    expect(runtime.graph.isInitialized()).toBe(true);
    expect(runtime.graph.constructor.name).toBe('ArangoGraphRepository');
  });
});

describeShared('graph-native history parity (ADR 0045)', () => {
  const SLUG = 'shared-history';
  let runtime: Runtime;
  let key: string;
  const first = doc(SLUG, '1.0.0', 'shared first body');
  const second = doc(SLUG, '1.1.0', 'shared second body');

  beforeAll(async () => {
    runtime = await fixture.openRuntime('arango-history');
    key = modules.scope.adapterGraphKey(space('history'), SLUG);
  });

  test('train appends snapshot 1 with content, digest, actor and space', async () => {
    await fixture.train(runtime, space('history'), first);
    const snapshot = await runtime.graph.getLatestVersion(key);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.version_number).toBe('1');
    expect(snapshot!.parent_version).toBeNull();
    expect(snapshot!.change_type).toBe('created');
    expect(snapshot!.content).toBe(first);
    expect(snapshot!.content_digest).toBe(sha(first));
    expect(snapshot!.space).toBe(space('history'));
    expect(snapshot!.changed_by).toBe('user-it');
    expect(snapshot!.actor_source).toBe('auth-subject');
  });

  test('tune appends snapshot 2 linked to snapshot 1', async () => {
    const tuned = await fixture.tune(runtime, space('history'), `squadrules://adapter/${SLUG}`, second);
    expect(tuned.results[0]!.status).toBe('updated');

    const latest = await runtime.graph.getLatestVersion(key);
    expect(latest!.version_number).toBe('2');
    expect(latest!.parent_version).toBe('1');
    expect(latest!.content_digest).toBe(sha(second));
    expect((await runtime.graph.listVersions(key)).map((row) => row.version_number).sort()).toEqual([
      '1',
      '2'
    ]);
  });

  test('export with a version selector returns snapshot 1 digest-verified', async () => {
    const exported = await fixture.onSpace(space('history'), () =>
      modules.exportHistory.executeExportVersion(runtime.memoryStore, runtime.qdrantService, {
        uri: `squadrules://adapter/${SLUG}`,
        version: '1',
        format: 'markdown',
        include_reward: false
      })
    );
    expect(exported.content).toBe(first);
    expect(exported.snapshot_sha256).toBe(sha(first));
    expect(exported.history_version).toBe('1');
    expect(exported.history_versions).toBe(2);
    expect(exported.space_id).toBe(space('history'));

    await expect(
      fixture.onSpace(space('history'), () =>
        modules.exportHistory.executeExportVersion(runtime.memoryStore, runtime.qdrantService, {
          uri: `squadrules://adapter/${SLUG}`,
          version: '99',
          format: 'markdown',
          include_reward: false
        })
      )
    ).rejects.toThrow(/has no version 99/);
  });

  test('a stale expected_version fails closed and appends no snapshot', async () => {
    const before = await runtime.graph.listVersions(key);
    const conflicted = await fixture.tune(
      runtime,
      space('history'),
      `squadrules://adapter/${SLUG}`,
      doc(SLUG, '1.2.0', 'stale shared base'),
      { expectedVersion: '0.0.1' }
    );
    expect(conflicted.results[0]!.status).toBe('error');
    expect(conflicted.results[0]!.message).toContain('VERSION_CONFLICT');
    expect(conflicted.total_updated).toBe(0);

    const after = await runtime.graph.listVersions(key);
    expect(after.map((row) => row.version_number).sort()).toEqual(
      before.map((row) => row.version_number).sort()
    );
    expect((await runtime.graph.getLatestVersion(key))!.content).toBe(second);
  });

  test('a second connection reads the same persisted history', async () => {
    const reopened = await fixture.openRuntime('arango-reopen');
    const history = await reopened.graph.listVersions(key);
    expect(history.map((row) => row.version_number).sort()).toEqual(['1', '2']);
    expect((await reopened.graph.getVersion(key, '1'))!.content).toBe(first);
  });
});

describeShared('topology and scope parity (ADR 0042)', () => {
  test('a three-level chain resolves from a real AQL traversal', async () => {
    const runtime = await fixture.openRuntime('arango-chain');
    const s = space('chain');
    await fixture.train(runtime, s, doc('shared-grand', '1.0.0', 'grand body'));
    await fixture.train(
      runtime,
      s,
      adapterDoc({
        slug: 'shared-middle',
        version: '1.0.0',
        title: 'Shared Middle',
        inherits: 'shared-grand',
        sections: [{ heading: 'Step 1', body: 'middle body' }],
        contract: commentContract('middle')
      })
    );
    await fixture.train(
      runtime,
      s,
      adapterDoc({
        slug: 'shared-child',
        version: '1.0.0',
        title: 'Shared Child',
        inherits: 'shared-middle',
        sections: [{ heading: 'Step 1', body: 'child body' }],
        contract: commentContract('child')
      })
    );

    expect(await fixture.pathSlugs(runtime, s, 'shared-child')).toEqual(['shared-grand', 'shared-middle']);
    expect(await runtime.graph.getChildren(s, 'shared-middle')).toEqual(['shared-child']);
  });

  test('one slug in two spaces is two identities with independent histories', async () => {
    const runtime = await fixture.openRuntime('arango-scope');
    const a = space('scope-a');
    const b = `group:it-arango-${RUN}-scope-b`;
    const bodyA = doc('shared-same', '3.0.0', 'arango space a body');
    const bodyB = doc('shared-same', '4.0.0', 'arango space b body');

    await fixture.train(runtime, a, bodyA);
    await fixture.train(runtime, b, bodyB);

    const keyA = modules.scope.adapterGraphKey(a, 'shared-same');
    const keyB = modules.scope.adapterGraphKey(b, 'shared-same');
    expect(keyA).not.toBe(keyB);

    const historyA = await runtime.graph.listVersions(keyA);
    const historyB = await runtime.graph.listVersions(keyB);
    expect(historyA).toHaveLength(1);
    expect(historyB).toHaveLength(1);
    expect(historyA[0]!.content).toBe(bodyA);
    expect(historyB[0]!.content).toBe(bodyB);
    expect(historyA[0]!.space).toBe(a);
    expect(historyB[0]!.space).toBe(b);
    expect(await runtime.graph.getLatestVersion(keyB)).not.toBeNull();
  });
});

describeShared('descendant gate parity (ADR 0046 §6)', () => {
  test('a parent change that would invalidate a child writes nothing', async () => {
    const runtime = await fixture.openRuntime('arango-descendants');
    const s = space('descendants');
    const parent = doc('shared-desc-parent', '1.0.0', 'parent body', { has_fur: 'true' });
    await fixture.train(runtime, s, parent);
    await fixture.train(
      runtime,
      s,
      adapterDoc({
        slug: 'shared-desc-child',
        version: '1.0.0',
        title: 'Shared Desc Child',
        inherits: 'shared-desc-parent',
        override: ['has_fur'],
        extraFrontmatter: { has_fur: 'false' },
        sections: [{ heading: 'Step 1', body: 'child body' }],
        contract: commentContract('desc child')
      })
    );

    const key = modules.scope.adapterGraphKey(s, 'shared-desc-parent');
    const before = await runtime.graph.listVersions(key);
    const rejected = await fixture.tune(
      runtime,
      s,
      'squadrules://adapter/shared-desc-parent',
      doc('shared-desc-parent', '1.0.0', 'parent body'),
      { expectedVersion: '1.0.0' }
    );

    expect(rejected.results[0]!.status).toBe('error');
    expect(rejected.results[0]!.message).toContain('DESCENDANT_VALIDATION_FAILED');
    expect(rejected.results[0]!.message).toContain('shared-desc-child');
    const after = await runtime.graph.listVersions(key);
    expect(after.map((row) => row.version_number)).toEqual(before.map((row) => row.version_number));
  });
});
