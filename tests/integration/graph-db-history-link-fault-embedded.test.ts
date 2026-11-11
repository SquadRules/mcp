/**
 * G10 — embedded history append when the `VersionOf` target is absent.
 *
 * The scenario itself lives in `graph-db-history-link-fault.ts` so the shared-backend
 * suite asserts exactly the same observable result. This file only supplies the real
 * embedded LadybugDB + LanceDB runtime.
 */
import { GraphFixture, loadProductionModules, type ProductionModules } from './graph-db-fixture.js';
import { assertLinklessAppendIsWhole } from './graph-db-history-link-fault.js';

const SPACE = 'space:it-link-fault-embedded';

let modules: ProductionModules;
let fixture: GraphFixture;

beforeAll(async () => {
  modules = await loadProductionModules();
  fixture = new GraphFixture(modules);
});

afterAll(async () => {
  await fixture.dispose();
});

describe('embedded history append with no link target (G10)', () => {
  test('the snapshot is whole and the chain continues without an adapter node', async () => {
    const runtime = await fixture.openRuntime('link-fault');
    await assertLinklessAppendIsWhole({
      modules,
      runtime,
      space: SPACE,
      slug: 'linkless-embedded'
    });
  });
});
