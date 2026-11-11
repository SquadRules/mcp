/**
 * G10 shared-backend parity — history append when the `VersionOf` target is absent.
 *
 * Same scenario and same assertions as the embedded suite
 * (`graph-db-history-link-fault-embedded.test.ts`); only the backend differs. Selection
 * follows `graph-db-arango-selection.ts`: configured → run and fail on any parity
 * problem, `SQUADRULES_ARANGO_REQUIRED=true` + unconfigured → fail, otherwise skip
 * loudly so shared parity can never read as proven.
 */
import { selectSharedBackend } from './graph-db-arango-selection.js';
import { GraphFixture, loadProductionModules, type ProductionModules } from './graph-db-fixture.js';
import { assertLinklessAppendIsWhole } from './graph-db-history-link-fault.js';

const SELECTION = selectSharedBackend('graph-db-arango-history-link-fault');
const SHARED_SELECTED = SELECTION.selected;
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

if (!SHARED_SELECTED) {
  process.stderr.write(SELECTION.skipBanner);
}

if (SELECTION.required && !SHARED_SELECTED) {
  test('the shared backend is configured because a lane requires it', () => {
    throw new Error(SELECTION.requirementMessage);
  });
}

let modules: ProductionModules;
let fixture: GraphFixture;

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

describeShared('shared-backend history append with no link target (G10)', () => {
  test('the snapshot is whole and the chain continues without an adapter node', async () => {
    const runtime = await fixture.openRuntime('arango-link-fault');
    expect(runtime.graph.constructor.name).toBe('ArangoGraphRepository');
    await assertLinklessAppendIsWhole({
      modules,
      runtime,
      space: `space:it-link-fault-shared-${RUN}`,
      slug: 'linkless-shared'
    });
  });
});
