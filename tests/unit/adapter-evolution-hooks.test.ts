/**
 * UNIT — `recordAdapterEvolution` never throws and discloses a bounded classification.
 *
 * Two contracts are pinned here because both are easy to regress silently:
 *
 *  1. **Exception safety (G2).** The caller's write is already durable when this pass
 *     runs, so *every* failure — a throwing history read, a throwing append — has to come
 *     back as a reported degradation. A throw here would surface as a failed `train`
 *     for a write that actually succeeded.
 *  2. **Honest restore classification (G16).** The history port pages newest-first, so a
 *     digest search is bounded. When the window fills without a match, the reason must
 *     say the classification covered only that window — an older restore must not be
 *     presented as a plain `updated`.
 *
 * The graph is a hand-written double (no Ladybug/Arango, no mocks library): the point is
 * the hook's control flow, and the real backends already have integration coverage.
 */
import { attachGraphDb, detachGraphDb } from '../../src/services/graph-db/graph-owner.js';
import { recordAdapterEvolution } from '../../src/services/graph-db/adapter-evolution-hooks.js';
import type { GraphRepository } from '../../src/services/graph-db/graph-repository.js';
import type { VersionAppendInput, VersionNode } from '../../src/services/graph-db/graph-types.js';
import type { Memory } from '../../src/types/memory.js';
import { sha256Hex } from '../../src/utils/sha256.js';

const SPACE = 'space:unit-evolution-hooks';
const SLUG = 'unit-hook-adapter';
const KEY = `adapter:${SPACE}:${SLUG}`;
const WINDOW = 1000;

function version(overrides: Partial<VersionNode> & Pick<VersionNode, 'version_number'>): VersionNode {
  return {
    key: `version:${KEY}:${overrides.version_number}`,
    type: 'version',
    entity_key: KEY,
    entity_uri: `adapter://${SLUG}`,
    adapter_version: '1.0.0',
    change_type: 'updated',
    changed_at: '2026-01-01T00:00:00.000Z',
    changed_by: 'runtime-local',
    actor_source: 'runtime-local',
    space: SPACE,
    parent_version: null,
    reason: 'fixture',
    content_digest: sha256Hex('earlier bytes'),
    content: 'earlier bytes',
    metadata_snapshot: {},
    ...overrides
  };
}

interface DoubleOptions {
  head?: VersionNode | 'throw' | null;
  versions?: VersionNode[];
  append?: 'ok' | 'throw';
}

interface DoubleState {
  appended: VersionAppendInput[];
}

function double(options: DoubleOptions): { repo: GraphRepository; state: DoubleState } {
  const state: DoubleState = { appended: [] };
  const repo = {
    isInitialized: () => true,
    getLatestVersion: async () => {
      if (options.head === 'throw') throw new Error('head read exploded');
      return options.head ?? null;
    },
    listVersions: async () => (options.versions ?? []).slice(0, WINDOW),
    appendVersion: async (input: VersionAppendInput) => {
      if (options.append === 'throw') throw new Error('append exploded');
      state.appended.push(input);
      return version({ version_number: String(state.appended.length) });
    }
  };
  return { repo: repo as unknown as GraphRepository, state };
}

function headMemory(): Memory {
  return {
    slug: SLUG,
    space_id: SPACE,
    text: 'stored body',
    adapter: {
      name: 'Unit Hook Adapter',
      protocol_version: '1.1.0',
      layer_index: 1,
      frontmatter: { version: '1.1.0' }
    }
  } as Memory;
}

function params(owner: object, markdown: string) {
  return {
    owner,
    head: headMemory(),
    markdown,
    changeType: 'updated' as const,
    reason: 'unit: write',
    // No record source: parent resolution short-circuits, so this suite covers the
    // version/restore legs only. Contradiction coverage lives in the integration suite.
    source: null
  };
}

describe('recordAdapterEvolution — never throws', () => {
  test('a throwing history head read degrades instead of failing the write', async () => {
    const owner = {};
    const { repo, state } = double({ head: 'throw' });
    attachGraphDb(repo, owner);
    try {
      const report = await recordAdapterEvolution(params(owner, 'durable bytes one'));

      expect(report.degraded.some((entry) => entry.startsWith('history head unreadable'))).toBe(true);
      // The snapshot is still recorded; an unreadable head means "cannot classify",
      // not "nothing happened".
      expect(report.version).toBe('1');
      expect(report.change_type).toBe('created');
      expect(state.appended).toHaveLength(1);
      expect(state.appended[0]!.metadataSnapshot['head_read_failed']).toBe(true);
    } finally {
      detachGraphDb(owner);
    }
  });

  test('a throwing append is reported and the pass resolves', async () => {
    const owner = {};
    const { repo } = double({ head: null, append: 'throw' });
    attachGraphDb(repo, owner);
    try {
      const report = await recordAdapterEvolution(params(owner, 'durable bytes two'));

      expect(report.version).toBeNull();
      expect(report.change_type).toBeNull();
      expect(report.skipped).toBe('history append did not produce a snapshot');
      expect(report.degraded).toEqual([]);
    } finally {
      detachGraphDb(owner);
    }
  });

  test('no graph for this store is a skip, not a degradation', async () => {
    const report = await recordAdapterEvolution(params({}, 'durable bytes three'));

    expect(report.skipped).toBe('no graph repository for this store');
    expect(report.degraded).toEqual([]);
    expect(report.version).toBeNull();
  });
});

describe('recordAdapterEvolution — durable-state versioning', () => {
  test('identical durable bytes append nothing and are not a degradation', async () => {
    const owner = {};
    const markdown = 'identical durable bytes';
    const { repo, state } = double({
      head: version({ version_number: '7', content_digest: sha256Hex(markdown), content: markdown })
    });
    attachGraphDb(repo, owner);
    try {
      const report = await recordAdapterEvolution(params(owner, markdown));

      expect(report.no_change).toBe(true);
      expect(report.skipped).toContain('snapshot 7');
      expect(report.degraded).toEqual([]);
      expect(state.appended).toEqual([]);
    } finally {
      detachGraphDb(owner);
    }
  });

  test('a restore to earlier durable bytes is labelled with its source snapshot', async () => {
    const owner = {};
    const markdown = 'restored durable bytes';
    const digest = sha256Hex(markdown);
    const { repo, state } = double({
      head: version({ version_number: '3', content_digest: sha256Hex('newer bytes'), content: 'newer bytes' }),
      versions: [
        version({ version_number: '3', content_digest: sha256Hex('newer bytes'), content: 'newer bytes' }),
        version({ version_number: '2', change_type: 'created', content_digest: digest, content: markdown }),
        version({ version_number: '1', change_type: 'created' })
      ]
    });
    attachGraphDb(repo, owner);
    try {
      const report = await recordAdapterEvolution(params(owner, markdown));

      expect(report.change_type).toBe('restored');
      expect(state.appended).toHaveLength(1);
      expect(state.appended[0]!.changeType).toBe('restored');
      expect(state.appended[0]!.reason).toContain('restored from snapshot 2');
      // The CAS token is the head this pass observed.
      expect(state.appended[0]!.expectedParentVersion).toBe('3');
    } finally {
      detachGraphDb(owner);
    }
  });
});

describe('recordAdapterEvolution — bounded classification window (G16)', () => {
  test('a filled window without a match discloses the window in the reason', async () => {
    const owner = {};
    const markdown = 'bytes older than the window';
    const filler = (index: number) =>
      version({
        version_number: String(index),
        content_digest: sha256Hex(`filler ${index}`),
        content: `filler ${index}`
      });
    const versions = Array.from({ length: WINDOW }, (_unused, index) => filler(index + 1));
    const { repo, state } = double({ head: versions[0]!, versions });
    attachGraphDb(repo, owner);
    try {
      const report = await recordAdapterEvolution(params(owner, markdown));

      // Not proven to be a plain update — the classification covered only the window.
      expect(report.change_type).toBe('updated');
      expect(state.appended).toHaveLength(1);
      expect(state.appended[0]!.reason).toContain(
        `restore classification covered the newest ${WINDOW} snapshots`
      );
      expect(state.appended[0]!.reason).toContain('would be labelled updated');
    } finally {
      detachGraphDb(owner);
    }
  });

  test('a short history without a match is an ordinary update with no disclaimer', async () => {
    const owner = {};
    const markdown = 'novel durable bytes';
    const { repo, state } = double({
      head: version({ version_number: '1' }),
      versions: [version({ version_number: '1' })]
    });
    attachGraphDb(repo, owner);
    try {
      const report = await recordAdapterEvolution(params(owner, markdown));

      expect(report.change_type).toBe('updated');
      expect(state.appended[0]!.reason).not.toContain('restore classification covered');
    } finally {
      detachGraphDb(owner);
    }
  });
});
