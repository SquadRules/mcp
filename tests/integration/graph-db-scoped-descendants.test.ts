/**
 * Scoped descendant validation (ADR 0046 §6, gap G9) — real LadybugDB, real LanceDB,
 * real `train` / `tune` / `getChildren`. No mocks, stubs or module fakes.
 *
 * What this suite pins:
 *
 *   1. `getChildren` returns each child's scoped identity, so a child that lives in
 *      another space is addressable at all.
 *   2. An app-space parent validates the children stored in other spaces, reading each
 *      one in ITS own scope — the documented parent fallback makes that an ordinary
 *      topology, not an edge case.
 *   3. A same-slug adapter in the parent's own space is neither substituted for the
 *      real child nor counted in its place.
 *   4. A child the request may not read, or whose record is gone, is REPORTED as
 *      unavailable: never a conflict, never silently dropped, and never a reason to
 *      block the parent write.
 *
 * The cross-scope topology is only producible with an APP-SPACE parent, because
 * `parentScopeCandidates` resolves a child's parent in the child's own space or in the
 * app space, and never elsewhere. An app-space adapter is write-protected, so `tune`
 * refuses with `PROTECTED_SPACE_WRITE_FORBIDDEN` before it reaches descendant
 * validation. The write-path assertion is therefore made against
 * `assertDescendantsValid` — the exact guard `tune` and `train` call before writing
 * (`tune-adapter-markdown.ts`, `train-validation.ts`) — rather than through `tune`
 * itself, which would fail for an unrelated reason and prove nothing about G9.
 */
import {
  GraphFixture,
  adapterDoc,
  commentContract,
  loadProductionModules,
  type ProductionModules,
  type Runtime
} from './graph-db-fixture.js';

const PERSONAL = 'space:it-desc-personal';
const FOREIGN = 'group:it-desc-other';

/** Slug shared by a child in the personal space and its app-space namesake. */
const SHARED_CHILD = 'desc-x-child';
const CHILD_PARENT = 'desc-app-parent';
const LOOSE_PARENT = 'desc-loose-parent';
const GHOST_CHILD = 'desc-ghost-child';
const FOREIGN_CHILD = 'desc-foreign-child';

let modules: ProductionModules;
let fixture: GraphFixture;

/** Parent adapter; `fields` are the domain properties a child may override. */
function parentDoc(slug: string, fields: Record<string, string> = {}): string {
  return adapterDoc({
    slug,
    version: '1.0.0',
    title: `Parent ${slug}`,
    extraFrontmatter: fields,
    sections: [{ heading: 'Step 1', body: 'parent step' }],
    contract: commentContract('parent')
  });
}

/** Child adapter inheriting `parent`, overriding exactly the fields it declares. */
function childDoc(slug: string, parent: string, fields: Record<string, string> = {}): string {
  return adapterDoc({
    slug,
    version: '1.0.0',
    title: `Child ${slug}`,
    inherits: parent,
    override: Object.keys(fields),
    extraFrontmatter: fields,
    sections: [{ heading: 'Step 1', body: 'child step' }],
    contract: commentContract('child')
  });
}

/** Child refs in a stable order, so a backend's traversal order is not asserted. */
function sortedChildren(children: Array<{ key: string; slug: string; space: string }>) {
  return [...children].sort((a, b) => a.key.localeCompare(b.key));
}

/** Real validation call under the real tenant context for `spaceId`. */
async function validateAs(
  runtime: Runtime,
  spaceId: string,
  parentSpaceId: string,
  parentSlug: string,
  markdown: string
) {
  return fixture.onSpace(spaceId, () =>
    modules.descendants.validateDescendantsForParentChange({
      owner: runtime.memoryStore,
      source: runtime.memoryStore,
      parentSlug,
      spaceId: parentSpaceId,
      markdown
    })
  );
}

/**
 * Real write-path guard under the real tenant context for `spaceId`.
 *
 * This is the function `tune` and `train` call before they write anything, so a throw
 * here is the write being refused; the caller's own preconditions (CAS, the protected
 * app-space guard) are simply not re-tested by this suite.
 */
async function assertAs(
  runtime: Runtime,
  spaceId: string,
  parentSpaceId: string,
  parentSlug: string,
  markdown: string
) {
  return fixture.onSpace(spaceId, () =>
    modules.descendants.assertDescendantsValid({
      owner: runtime.memoryStore,
      source: runtime.memoryStore,
      parentSlug,
      spaceId: parentSpaceId,
      markdown
    })
  );
}

beforeAll(async () => {
  modules = await loadProductionModules();
  fixture = new GraphFixture(modules);
});

afterAll(async () => {
  await fixture.dispose();
});

describe('an app-space parent reaches its children in other spaces (G9 §1–3)', () => {
  let runtime: Runtime;

  beforeAll(async () => {
    runtime = await fixture.openRuntime('scoped-descendants');
    // The parent lives in the app space: every space may inherit it (ADR 0042).
    await fixture.train(runtime, modules.appSpaceId, parentDoc(CHILD_PARENT, { has_fur: 'true' }));
    // The real child overrides `has_fur`, so dropping the field invalidates it.
    await fixture.train(
      runtime,
      PERSONAL,
      childDoc(SHARED_CHILD, CHILD_PARENT, { has_fur: 'false' })
    );
    // Same slug, parent's own space, no override: a trap for a slug-only lookup.
    await fixture.train(runtime, modules.appSpaceId, childDoc(SHARED_CHILD, CHILD_PARENT));
  });

  test('getChildren reports each child with the scope its node is stored in', async () => {
    const children = await runtime.graph.getChildren(modules.appSpaceId, CHILD_PARENT);

    // Sorted by scoped key, so a backend's traversal order is not asserted.
    expect(sortedChildren(children)).toEqual([
      {
        key: modules.scope.adapterGraphKey(PERSONAL, SHARED_CHILD),
        slug: SHARED_CHILD,
        space: PERSONAL
      },
      {
        key: modules.scope.adapterGraphKey(modules.appSpaceId, SHARED_CHILD),
        slug: SHARED_CHILD,
        space: modules.appSpaceId
      }
    ]);
  });

  test('the same-slug child in another space is validated, not its namesake', async () => {
    const report = await validateAs(
      runtime,
      PERSONAL,
      modules.appSpaceId,
      CHILD_PARENT,
      // The prospective parent no longer declares `has_fur`.
      parentDoc(CHILD_PARENT)
    );

    // Both children declare this parent and were read in their own scope.
    expect(report.checked).toBe(2);
    expect(report.unavailable).toEqual([]);
    // Only the personal child overrides the dropped field. A parent-scope read would
    // have found the app-space namesake and reported no conflict at all.
    expect(report.conflicts).toEqual([
      {
        child_slug: SHARED_CHILD,
        space: PERSONAL,
        code: 'override_unknown_field',
        message: expect.stringContaining('has_fur')
      }
    ]);
  });

  test('the write-path guard refuses the parent change', async () => {
    const parentKey = modules.scope.adapterGraphKey(modules.appSpaceId, CHILD_PARENT);
    expect(await runtime.graph.listVersions(parentKey)).toHaveLength(1);

    const rejected = assertAs(
      runtime,
      PERSONAL,
      modules.appSpaceId,
      CHILD_PARENT,
      // The prospective parent no longer declares `has_fur`.
      parentDoc(CHILD_PARENT)
    );

    await expect(rejected).rejects.toMatchObject({
      code: 'DESCENDANT_VALIDATION_FAILED',
      report: {
        checked: 2,
        conflicts: [
          {
            child_slug: SHARED_CHILD,
            space: PERSONAL,
            code: 'override_unknown_field'
          }
        ]
      }
    });
    // The guard is a precondition, not a write: the parent keeps its single snapshot.
    expect(await runtime.graph.listVersions(parentKey)).toHaveLength(1);
  });
});

describe('unreadable children are reported, never turned into conflicts (G9 §4)', () => {
  let runtime: Runtime;

  beforeAll(async () => {
    runtime = await fixture.openRuntime('scoped-unavailable');
    await fixture.train(runtime, modules.appSpaceId, parentDoc(LOOSE_PARENT, { has_fur: 'true' }));

    // A child node whose stored record does not exist in its own space: the topology
    // was projected, the record is gone. Readable space, unreadable child.
    const ghostKey = await runtime.graph.upsertAdapterFromFrontmatter(
      GHOST_CHILD,
      '1.0.0',
      { inherits: LOOSE_PARENT },
      { spaceId: PERSONAL, title: GHOST_CHILD, layerCount: 1 }
    );
    expect(ghostKey).toBe(modules.scope.adapterGraphKey(PERSONAL, GHOST_CHILD));
    await runtime.graph.writeInheritanceEdges(
      ghostKey,
      { inherits: LOOSE_PARENT },
      { parentSpaceId: modules.appSpaceId }
    );

    // A real child in a space this request may not read: another tenant's group.
    await fixture.train(
      runtime,
      FOREIGN,
      childDoc(FOREIGN_CHILD, LOOSE_PARENT, { has_fur: 'false' })
    );
  });

  test('both gaps are named in `unavailable`, and neither is a conflict', async () => {
    const report = await validateAs(
      runtime,
      PERSONAL,
      modules.appSpaceId,
      LOOSE_PARENT,
      parentDoc(LOOSE_PARENT)
    );

    // Nothing was validated: the ghost has no record, the foreign child is out of scope.
    expect(report.checked).toBe(0);
    expect(report.conflicts).toEqual([]);
    // Sorted by scoped key: `adapter:group:…` precedes `adapter:space:…`.
    expect([...report.unavailable].sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      {
        key: modules.scope.adapterGraphKey(FOREIGN, FOREIGN_CHILD),
        child_slug: FOREIGN_CHILD,
        space: FOREIGN
      },
      {
        key: modules.scope.adapterGraphKey(PERSONAL, GHOST_CHILD),
        child_slug: GHOST_CHILD,
        space: PERSONAL
      }
    ]);
  });

  test('the write-path guard passes: a read failure is not evidence', async () => {
    const report = await assertAs(
      runtime,
      PERSONAL,
      modules.appSpaceId,
      LOOSE_PARENT,
      parentDoc(LOOSE_PARENT)
    );

    // No conflict, so no throw: an unreadable child is a reported gap, never a reason
    // to block the parent change.
    expect(report.conflicts).toEqual([]);
    expect(report.checked).toBe(0);
    expect(report.unavailable).toHaveLength(2);
  });
});
