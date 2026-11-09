/**
 * Inheritance end-to-end integration tests — delivery contract 4: CHECKPOINTS ARE
 * RECOVERY STATE, NEVER PROOFS.
 *
 * Real LadybugDB, real LanceDB, real checkpoint files on disk. No mocks, stubs, spies or
 * module fakes; the shared bootstrap and fixture documents live in
 * `adapter-inheritance-fixture.ts`.
 *
 * What this suite pins:
 *
 *   1. A checkpoint resumes matching state; changed content, a version bump and a foreign
 *      scope each invalidate it with an explicit reason and delete the file; a finished
 *      walk cleans up.
 *   2. An expired checkpoint is discarded with a reason and swept, and a seeded checkpoint
 *      can never turn a genuinely missing parent into a successful resolution.
 *
 * Sibling suites: `adapter-inheritance-projection.test.ts` (contract 1) and
 * `adapter-inheritance-effective-content.test.ts` (contract 2). Split from one 857-line
 * file to satisfy the 350-line cap.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  SPACE_A,
  SPACE_B,
  adapterDoc,
  checkpoints,
  commentContract,
  disposeInheritanceFixture,
  effective,
  loadInheritanceFixture,
  openRuntime,
  storedHead,
  tempDir,
  train
} from './adapter-inheritance-fixture.js';

beforeAll(loadInheritanceFixture);
afterAll(disposeInheritanceFixture);

describe('inheritance checkpoints are recovery state, never proofs (contract 4)', () => {
  test('changed content and a foreign scope are invalidated with a reason, and a finished walk cleans up', async () => {
    const dir = join(tempDir('cp-invalidate'), 'state');
    const service = checkpoints.createInheritanceCheckpointService({ directory: dir });
    const identity = { execution_id: randomUUID(), scope_id: SPACE_A, adapter_slug: 'checkpoint-target' };
    const stage = { slug: 'checkpoint-target', version: '1.0.0', space_id: SPACE_A, layer_index: 1 };

    // Atomic per-stage write, then resume the exact state.
    await service.recordStage(identity, { ...stage, content: 'first body' });
    const resumed = await service.load(identity);
    expect(resumed.status).toBe('resumed');

    // Same identity, changed body digest → stale, with the changed slug named.
    const changed = await service.reconcile(identity, [{ ...stage, content: 'second body' }]);
    expect(changed.status).toBe('stale');
    if (changed.status === 'stale') {
      expect(changed.reason).toContain('checkpoint-target');
      expect(changed.reason).toContain('changed');
    }
    expect(existsSync(join(dir, `inheritance-${identity.execution_id}.json`))).toBe(false);

    // A version bump alone is enough to invalidate too.
    await service.recordStage(identity, { ...stage, content: 'stable body' });
    const versionChanged = await service.reconcile(identity, [
      { ...stage, version: '2.0.0', content: 'stable body' }
    ]);
    expect(versionChanged.status).toBe('stale');

    // A checkpoint recorded for one scope is never resumed for another.
    await service.recordStage(identity, { ...stage, content: 'stable body' });
    const foreignScope = await service.load({ ...identity, scope_id: SPACE_B });
    expect(foreignScope.status).toBe('stale');
    if (foreignScope.status === 'stale') {
      expect(foreignScope.reason).toContain('scope');
    }
    expect(readdirSync(dir).filter((entry) => entry.startsWith('inheritance-'))).toEqual([]);

    // Terminal cleanup leaves nothing behind.
    await service.recordStage(identity, { ...stage, content: 'stable body' });
    await service.finish(identity);
    expect(readdirSync(dir).filter((entry) => entry.startsWith('inheritance-'))).toEqual([]);
  });

  test('an expired checkpoint is discarded explicitly and swept, and a stored one never resolves a missing parent', async () => {
    const dir = join(tempDir('cp-ttl'), 'state');
    const ttlMs = 24 * 60 * 60 * 1000;
    // A real timestamp from the past: the fixture moves the clock, nothing is mocked.
    const stale = checkpoints.createInheritanceCheckpointService({
      directory: dir,
      ttlMs,
      now: () => Date.now() - 48 * 60 * 60 * 1000
    });
    const expiredIdentity = { execution_id: randomUUID(), scope_id: SPACE_A, adapter_slug: 'expired-target' };
    await stale.recordStage(expiredIdentity, {
      slug: 'expired-target',
      version: '1.0.0',
      space_id: SPACE_A,
      layer_index: 1,
      content: 'expired body'
    });
    const abandonedIdentity = { execution_id: randomUUID(), scope_id: SPACE_A, adapter_slug: 'swept-target' };
    await stale.recordStage(abandonedIdentity, {
      slug: 'swept-target',
      version: '1.0.0',
      space_id: SPACE_A,
      layer_index: 1,
      content: 'swept body'
    });

    const current = checkpoints.createInheritanceCheckpointService({ directory: dir, ttlMs });
    const loaded = await current.load(expiredIdentity);
    expect(loaded.status).toBe('stale');
    if (loaded.status === 'stale') {
      expect(loaded.reason).toContain('older than');
    }
    // The sweep removes what is left over from abandoned executions.
    expect(await current.sweepExpired()).toBeGreaterThanOrEqual(1);
    expect(readdirSync(dir).filter((entry) => entry.startsWith('inheritance-'))).toEqual([]);

    // A checkpoint carries recovery state only. Seeded for an adapter whose parent is
    // genuinely absent, it must not turn an incomplete resolution into a success.
    const runtime = await openRuntime('checkpoint-proof');
    const orphanHead = await train(
      runtime,
      SPACE_A,
      adapterDoc({
        slug: 'proofless-child',
        version: '1.0.0',
        title: 'Proofless Child Adapter',
        inherits: 'proofless-parent',
        sections: [{ heading: 'Step 1', body: 'Proofless step.' }],
        contract: commentContract('proofless')
      })
    );
    const executionId = randomUUID();
    const seeded = checkpoints.createInheritanceCheckpointService({
      directory: join(tempDir('cp-proof'), 'state')
    });
    await seeded.recordStage(
      { execution_id: executionId, scope_id: SPACE_A, adapter_slug: 'proofless-child' },
      {
        slug: 'proofless-child',
        version: '1.0.0',
        space_id: SPACE_A,
        layer_index: 1,
        content: 'proofless step'
      }
    );

    const resolved = await effective.resolveEffectiveLayerContent(
      runtime.memoryStore,
      runtime.qdrantService,
      await storedHead(runtime, orphanHead),
      'activate',
      { executionId, checkpoints: seeded }
    );
    expect(resolved.resolved).toBe(false);
    expect(resolved.resolved_reason).toContain('parent_missing');
  });
});
