/**
 * Inheritance end-to-end integration tests — delivery contract 2: ADDITIVE AND
 * SELECTIVE EFFECTIVE CONTENT.
 *
 * Real LadybugDB, real LanceDB, real `train`/effective-content code paths. No mocks,
 * stubs, spies or module fakes; the shared bootstrap and fixture documents live in
 * `adapter-inheritance-fixture.ts`.
 *
 * What this suite pins:
 *
 *   1. Additive + selective inheritance: child additions survive, the nearest level wins
 *      a keyed section and the override is recorded, a farther ancestor's body is
 *      dropped where overridden, and `effective_contracts[0]` is the child's contract —
 *      exactly what `applyEffectiveContent` puts on the memory `forward` runs.
 *   2. An arbitrary author property survives the stored record and can be overridden; a
 *      structural field (`verdict`) is vetoed before anything is written.
 *   3. A missing stored parent fails closed with `resolved: false` and an explicit
 *      reason, while the child's own body still surfaces.
 *   4. A stored cycle fails closed, leaves resumable recovery state, and that state is
 *      never a proof.
 *
 * Sibling suites: `adapter-inheritance-projection.test.ts` (contract 1) and
 * `adapter-inheritance-checkpoints.test.ts` (contract 4). Split from one 857-line file
 * to satisfy the 350-line cap.
 */
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  SPACE_A,
  adapterDoc,
  checkpoints,
  commentContract,
  disposeInheritanceFixture,
  effective,
  loadInheritanceFixture,
  onSpace,
  openRuntime,
  pathSlugs,
  scope,
  storedHead,
  tempDir,
  train
} from './adapter-inheritance-fixture.js';

beforeAll(loadInheritanceFixture);
afterAll(disposeInheritanceFixture);

describe('additive and selective inheritance (contract 2)', () => {
  test('three levels merge additively: additions survive, the nearest claim wins, contracts are exact', async () => {
    const runtime = await openRuntime('merge');

    // Section headings are the merge keys, so each level names its sections: a level
    // can only override what it can address by heading.
    const grandparentContract = commentContract('grandparent contract');
    const middleContract = commentContract('middle contract');
    const childContract = commentContract('child contract');
    // The writer defaults an unfilled `required` to true on the stored contract, so the
    // executable contract is the author's object plus that one default — not a copy made
    // up by the merge.
    const storedChildContract = { ...childContract, required: true };

    await train(
      runtime,
      SPACE_A,
      adapterDoc({
        slug: 'chain-grandparent',
        version: '3.0.0',
        title: 'Chain Grandparent Adapter',
        sections: [
          { heading: 'Policy', body: 'Older policy: manual review required for every change.' },
          { heading: 'Rules', body: 'Grandparent rules: older manual gate.' }
        ],
        contract: grandparentContract
      })
    );
    await train(
      runtime,
      SPACE_A,
      adapterDoc({
        slug: 'chain-middle',
        version: '1.4.0',
        title: 'Chain Middle Adapter',
        inherits: 'chain-grandparent',
        sections: [
          { heading: 'Policy', body: 'Team policy: manual review only for schema changes.' },
          { heading: 'Rules', body: 'Middle rules: team gate.' }
        ],
        contract: middleContract
      })
    );
    const childHead = await train(
      runtime,
      SPACE_A,
      adapterDoc({
        slug: 'chain-child',
        version: '0.9.0',
        title: 'Chain Child Adapter',
        inherits: 'chain-middle',
        sections: [
          { heading: 'Rules', body: 'Leaf rules: review the diff first.' },
          { heading: 'Additions', body: 'Child-only addition: summarise the diff.' }
        ],
        contract: childContract
      })
    );

    // Topology is a full ancestor path, not just the immediate parent.
    expect(await pathSlugs(runtime, SPACE_A, 'chain-child')).toEqual(['chain-grandparent', 'chain-middle']);
    expect(await pathSlugs(runtime, SPACE_A, 'chain-middle')).toEqual(['chain-grandparent']);

    const childMemory = await storedHead(runtime, childHead);
    const resolved = await effective.resolveEffectiveLayerContent(
      runtime.memoryStore,
      runtime.qdrantService,
      childMemory,
      'activate'
    );

    expect(resolved.resolved).toBe(true);
    expect(resolved.resolved_reason).toBeUndefined();
    expect(resolved.substitute).toBe(true);
    expect(resolved.inheritance_chain).toEqual(['chain-child', 'chain-middle', 'chain-grandparent']);
    expect(resolved.effective).toBeDefined();

    const merged = resolved.effective!;
    // Root-first lineage, child last — the recorded tree, independent of display depth.
    expect(merged.lineage).toEqual(['chain-grandparent', 'chain-middle', 'chain-child']);
    // The nearest claimer of `Policy` is the middle level; the grandparent body is gone.
    expect(merged.overrides['policy']).toBe('chain-middle');
    expect(merged.overrides['rules']).toBe('chain-child');
    expect(merged.text).toContain('Team policy: manual review only for schema changes.');
    expect(merged.text).not.toContain('Older policy');
    expect(merged.text).toContain('Leaf rules: review the diff first.');
    expect(merged.text).not.toContain('Middle rules: team gate.');
    expect(merged.text).not.toContain('Grandparent rules: older manual gate.');
    // A child-only section is an addition and is never dropped.
    expect(merged.text).toContain('Child-only addition: summarise the diff.');

    // One carried contract per contributing level, nearest first, executable one first.
    expect(merged.effective_contracts.map((entry) => entry.source)).toEqual([
      'chain-child',
      'chain-middle',
      'chain-grandparent'
    ]);
    expect(merged.effective_contracts[0]!.contract).toEqual(storedChildContract);

    // What `activate` surfaces and what `forward` executes must be the same contract,
    // and identity must stay the child's.
    const surfaced = effective.buildMergedAdapterContent(childMemory, resolved);
    const executable = effective.applyEffectiveContent(childMemory, resolved);
    expect(surfaced.slug).toBe('chain-child');
    expect(surfaced.version).toBe('0.9.0');
    expect(surfaced.resolved).toBe(true);
    expect(surfaced.lineage_truncated).toBe(false);
    expect(surfaced.effective_contracts[0]!.contract).toEqual(storedChildContract);
    expect(executable.inference_contract).toEqual(surfaced.effective_contracts[0]!.contract);
    expect(executable.memory_uuid).toBe(childMemory.memory_uuid);
    expect(executable.slug).toBe('chain-child');
    expect(executable.space_id).toBe(SPACE_A);
    expect(executable.adapter?.id).toBe(childMemory.adapter?.id);
    expect(executable.text).toBe(merged.text);
  });

  test('an arbitrary domain property persists on the record and is overridable; a structural field is vetoed', async () => {
    const runtime = await openRuntime('frontmatter');

    const parentHead = await train(
      runtime,
      SPACE_A,
      adapterDoc({
        slug: 'domain-parent',
        version: '1.0.0',
        title: 'Domain Parent Adapter',
        extraFrontmatter: { risk_level: 'high' },
        sections: [{ heading: 'Step 1', body: 'Domain parent step.' }],
        contract: commentContract('domain parent')
      })
    );

    // The author property survives the write and reaches the graph/frontmatter readers,
    // which is what stops `override: [risk_level]` from being a false unknown field.
    const parentStored = await storedHead(runtime, parentHead);
    expect(parentStored.adapter?.frontmatter?.['risk_level']).toBe('high');
    const parentNode = await runtime.graph.getAdapter(scope.adapterGraphKey(SPACE_A, 'domain-parent'));
    expect(parentNode?.frontmatter?.['risk_level']).toBe('high');

    const childDoc = adapterDoc({
      slug: 'domain-child',
      version: '1.0.0',
      title: 'Domain Child Adapter',
      inherits: 'domain-parent',
      override: ['risk_level'],
      extraFrontmatter: { risk_level: 'medium' },
      sections: [{ heading: 'Step 1', body: 'Domain child step.' }],
      contract: commentContract('domain child')
    });
    await train(runtime, SPACE_A, childDoc);
    expect(await pathSlugs(runtime, SPACE_A, 'domain-child')).toEqual(['domain-parent']);

    // A structural field may never be overridden: rejected before anything is written.
    const vetoDoc = adapterDoc({
      slug: 'domain-veto',
      version: '1.0.0',
      title: 'Domain Veto Adapter',
      inherits: 'domain-parent',
      override: ['verdict'],
      sections: [{ heading: 'Step 1', body: 'Veto step.' }],
      contract: commentContract('veto')
    });
    await expect(train(runtime, SPACE_A, vetoDoc)).rejects.toThrow(/structural_override_forbidden/);
    // Nothing was written: no node, and no stored layer carrying that slug.
    expect(await runtime.graph.getAdapter(scope.adapterGraphKey(SPACE_A, 'domain-veto'))).toBeNull();
    const storedSlugs = await onSpace(SPACE_A, () => runtime.records.scrollSpace(SPACE_A, { paginate: true }));
    expect(storedSlugs.map((record) => record.payload?.slug)).not.toContain('domain-veto');
  });

  test('a missing stored parent fails closed with resolved: false and an explicit reason', async () => {
    const runtime = await openRuntime('orphan');

    const orphanHead = await train(
      runtime,
      SPACE_A,
      adapterDoc({
        slug: 'orphan-child',
        version: '1.0.0',
        title: 'Orphan Child Adapter',
        inherits: 'never-stored-parent',
        sections: [{ heading: 'Step 1', body: 'Orphan step.' }],
        contract: commentContract('orphan')
      })
    );

    const orphanMemory = await storedHead(runtime, orphanHead);
    const resolved = await effective.resolveEffectiveLayerContent(
      runtime.memoryStore,
      runtime.qdrantService,
      orphanMemory,
      'forward'
    );

    // `parent_missing` is a warning at train time; it is never a successful resolution.
    expect(resolved.resolved).toBe(false);
    expect(resolved.resolved_reason).toContain('parent_missing');
    expect(resolved.substitute).toBe(false);
    expect(resolved.effective).toBeUndefined();

    const surfaced = effective.buildMergedAdapterContent(orphanMemory, resolved);
    expect(surfaced.resolved).toBe(false);
    expect(surfaced.resolved_reason).toContain('parent_missing');
    // The child's own body is still surfaced — incomplete inheritance is not amnesia.
    expect(surfaced.content).toContain('Orphan step.');
  });

  test('a stored cycle fails closed and leaves resumable recovery state that is not a proof', async () => {
    const runtime = await openRuntime('cycle');

    // `cycle-b` is trained first, so its parent is genuinely absent at train time and
    // the write is allowed with a warning. Training `cycle-a` completes the stored cycle.
    await train(
      runtime,
      SPACE_A,
      adapterDoc({
        slug: 'cycle-b',
        version: '1.0.0',
        title: 'Cycle B Adapter',
        inherits: 'cycle-a',
        sections: [{ heading: 'Step 1', body: 'Cycle B step.' }],
        contract: commentContract('cycle b')
      })
    );
    const cycleAHead = await train(
      runtime,
      SPACE_A,
      adapterDoc({
        slug: 'cycle-a',
        version: '1.0.0',
        title: 'Cycle A Adapter',
        inherits: 'cycle-b',
        sections: [{ heading: 'Step 1', body: 'Cycle A step.' }],
        contract: commentContract('cycle a')
      })
    );

    const dir = join(tempDir('cp-cycle'), 'state');
    const executionId = randomUUID();
    const service = checkpoints.createInheritanceCheckpointService({ directory: dir });
    const cycleMemory = await storedHead(runtime, cycleAHead);

    const resolved = await effective.resolveEffectiveLayerContent(
      runtime.memoryStore,
      runtime.qdrantService,
      cycleMemory,
      'activate',
      { executionId, checkpoints: service }
    );

    expect(resolved.resolved).toBe(false);
    expect(resolved.resolved_reason).toContain('inheritance_cycle');
    // The resolved portion is still executable; only the verdict is fail-closed.
    expect(resolved.substitute).toBe(true);
    // Nothing in the tool-facing result leaks a server filesystem path.
    expect(JSON.stringify(resolved)).not.toContain(dir);

    // The crashed walk left a real checkpoint file: the child stage was written before
    // the cycle was detected, which is what makes a retry resumable.
    const files = readdirSync(dir).filter((entry) => entry.startsWith('inheritance-'));
    expect(files).toEqual([`inheritance-${executionId}.json`]);

    // A fresh service over the same owner directory resumes the matching state.
    const restarted = checkpoints.createInheritanceCheckpointService({ directory: dir });
    const identity = { execution_id: executionId, scope_id: SPACE_A, adapter_slug: 'cycle-a' };
    const loaded = await restarted.load(identity);
    expect(loaded.status).toBe('resumed');
    if (loaded.status === 'resumed') {
      expect(loaded.token).toMatch(/^[0-9a-f]{64}$/);
      expect(loaded.token).not.toContain(dir);
      // Every stage the walk resolved before it detected the cycle is on disk.
      expect(loaded.checkpoint.stages.map((stage) => stage.slug).sort()).toEqual(['cycle-a', 'cycle-b']);
      expect(JSON.stringify(loaded)).not.toContain(dir);
    }

    // A stage that is no longer in the resolved ancestry invalidates the checkpoint
    // with an explicit reason, and the file is deleted rather than reused.
    const invalidated = await restarted.reconcile(identity, []);
    expect(invalidated.status).toBe('stale');
    if (invalidated.status === 'stale') {
      expect(invalidated.reason).toContain('no longer in the resolved ancestry');
    }
    expect(readdirSync(dir).filter((entry) => entry.startsWith('inheritance-'))).toEqual([]);
  });
});
