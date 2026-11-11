/**
 * G10 parity scenario: appending history when the `VersionOf` link target is absent.
 *
 * WHY THIS SCENARIO
 * History can legitimately be appended before the adapter is projected — `train` writes
 * records first and the graph is a derived projection, so a snapshot whose target node
 * does not exist yet is a normal state, not an error. The embedded backend used to create
 * the snapshot row and the edge in two statements, so this state could instead surface as
 * a half-append: a version `getLatestVersion` returns but no traversal reaches, or a
 * failed append that already wrote its row.
 *
 * The fault is injected by *not* projecting the adapter: the link target genuinely does
 * not exist. Nothing is mocked. The embedded and shared backends must then produce the
 * same observable result:
 *
 *   - the append succeeds and the snapshot is complete (bytes, digest, actor, space),
 *   - the snapshot is readable exactly once,
 *   - the chain continues from it and the earlier row is never rewritten,
 *   - the graph still reports no adapter node, because history does not invent one.
 *
 * This module holds no `describe`/`test`: each backend suite calls it so the assertions
 * are byte-for-byte the same on both.
 */
import { createHash } from 'node:crypto';

import type { ProductionModules, Runtime } from './graph-db-fixture.js';

function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface LinkFaultScenario {
  modules: ProductionModules;
  runtime: Runtime;
  space: string;
  slug: string;
}

/** One adapter-ish document; `appendVersion` stores bytes verbatim. */
function snapshotDoc(slug: string, version: string, body: string): string {
  return [
    '---',
    `slug: ${slug}`,
    `version: ${version}`,
    '---',
    '',
    `# ${slug}`,
    '',
    '## Step 1',
    '',
    body,
    '',
    '```json',
    '{"contract":{"required":true,"type":"comment"}}',
    '```',
    ''
  ].join('\n');
}

export async function assertLinklessAppendIsWhole(scenario: LinkFaultScenario): Promise<void> {
  const { modules, runtime, space, slug } = scenario;
  const key = modules.scope.adapterGraphKey(space, slug);
  const content = snapshotDoc(slug, '2.0.0', 'recorded body');

  // The injected link failure: nothing projected this adapter, so there is no edge target.
  expect(await runtime.graph.getAdapter(key)).toBeNull();

  const first = await runtime.graph.appendVersion({
    adapterKey: key,
    slug,
    adapterVersion: '2.0.0',
    space,
    changeType: 'created',
    reason: 'link target absent',
    content,
    metadataSnapshot: { fault: 'version-of-target-absent' },
    actor: { actor: 'user-it', actor_source: 'runtime-local' }
  });

  expect(first.version_number).toBe('1');
  expect(first.parent_version).toBeNull();
  expect(first.content_digest).toBe(sha(content));

  // Whole, not half-appended: the row is readable with its own bytes and identity.
  const rows = await runtime.graph.listVersions(key);
  expect(rows).toHaveLength(1);
  const stored = await runtime.graph.getLatestVersion(key);
  expect(stored!.version_number).toBe('1');
  expect(stored!.content).toBe(content);
  expect(stored!.content_digest).toBe(sha(content));
  expect(stored!.change_type).toBe('created');
  expect(stored!.space).toBe(space);
  expect(stored!.changed_by).toBe('user-it');

  // The chain continues from an unlinked snapshot, and the earlier row is immutable.
  const second = await runtime.graph.appendVersion({
    adapterKey: key,
    slug,
    adapterVersion: '2.1.0',
    space,
    changeType: 'updated',
    reason: 'still no link target',
    content: snapshotDoc(slug, '2.1.0', 'second recorded body'),
    metadataSnapshot: { fault: 'version-of-target-absent' },
    actor: { actor: 'user-it', actor_source: 'runtime-local' },
    expectedParentVersion: '1'
  });
  expect(second.version_number).toBe('2');
  expect(second.parent_version).toBe('1');

  expect((await runtime.graph.listVersions(key)).map((row) => row.version_number).sort()).toEqual(['1', '2']);
  expect((await runtime.graph.getVersion(key, '1'))!.content).toBe(content);

  // History wrote no graph node: the adapter is still absent, so nothing was invented.
  expect(await runtime.graph.getAdapter(key)).toBeNull();
}
