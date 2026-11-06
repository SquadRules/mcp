/**
 * Unit tests for Touchpoint 3: graph DB integration with train/tune.
 *
 * Covers:
 *   - single_parent rejects arrays
 *   - override_unknown_field rejects unknown fields
 *   - structural_override_forbidden rejects contract/type/steps/chain_root/inherits/override
 *   - parent_missing emits warning (not error)
 *   - happy-path write creates Adapter + Inherits + SpecializedBy
 *   - graph-db-unavailable still allows memory write to succeed
 *
 * Mocking strategy: `jest.resetModules()` + both `jest.doMock()` and
 * `jest.unstable_mockModule()` per the test-fix pattern (commit 11293c62).
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  validateInheritanceFrontmatter,
  parseOverrideList,
  isInheritsArray,
  STRUCTURAL_OVERRIDE_FORBIDDEN_FIELDS,
  type InheritanceFrontmatter
} from '../../src/services/graph-db/adapter-inheritance.js';

// ---------------------------------------------------------------------------
// Pure validator tests (no mocks needed)
// ---------------------------------------------------------------------------

describe('adapter-inheritance validators (Touchpoint 3)', () => {
  describe('parseOverrideList', () => {
    test('parses bracket-delimited list', () => {
      expect(parseOverrideList('[tags, metadata]')).toEqual(['tags', 'metadata']);
    });

    test('parses comma-separated list without brackets', () => {
      expect(parseOverrideList('tags, metadata')).toEqual(['tags', 'metadata']);
    });

    test('returns empty array for undefined/null/empty', () => {
      expect(parseOverrideList(undefined)).toEqual([]);
      expect(parseOverrideList(null)).toEqual([]);
      expect(parseOverrideList('')).toEqual([]);
      expect(parseOverrideList('[]')).toEqual([]);
    });

    test('strips quotes from values', () => {
      expect(parseOverrideList("['tags', \"metadata\"]")).toEqual(['tags', 'metadata']);
    });
  });

  describe('isInheritsArray', () => {
    test('detects bracket-delimited array', () => {
      expect(isInheritsArray('[parent-a, parent-b]')).toBe(true);
    });

    test('detects comma-separated values', () => {
      expect(isInheritsArray('parent-a, parent-b')).toBe(true);
    });

    test('returns false for single slug', () => {
      expect(isInheritsArray('critic-loop')).toBe(false);
    });

    test('returns false for undefined/null', () => {
      expect(isInheritsArray(undefined)).toBe(false);
      expect(isInheritsArray(null)).toBe(false);
    });
  });

  describe('validateInheritanceFrontmatter', () => {
    test('returns no errors/warnings when inherits is absent', () => {
      const result = validateInheritanceFrontmatter({ slug: 'test' }, null);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    test('single_parent rejects array-style inherits', () => {
      const fm: InheritanceFrontmatter = {
        inherits: '[parent-a, parent-b]'
      };
      const result = validateInheritanceFrontmatter(fm, null);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.code).toBe('single_parent');
      expect(result.errors[0]!.message).toContain('not an array');
    });

    test('single_parent rejects comma-separated inherits', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'parent-a, parent-b'
      };
      const result = validateInheritanceFrontmatter(fm, null);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.code).toBe('single_parent');
    });

    test('structural_override_forbidden rejects contract field', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'critic-loop',
        override: ['contract']
      };
      const result = validateInheritanceFrontmatter(fm, { slug: 'critic-loop', version: '1.0.0' });
      expect(result.errors.some((e) => e.code === 'structural_override_forbidden' && e.field === 'contract')).toBe(true);
    });

    test('structural_override_forbidden rejects type field', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'critic-loop',
        override: ['type']
      };
      const result = validateInheritanceFrontmatter(fm, { slug: 'critic-loop', version: '1.0.0' });
      expect(result.errors.some((e) => e.code === 'structural_override_forbidden' && e.field === 'type')).toBe(true);
    });

    test('structural_override_forbidden rejects steps field', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'critic-loop',
        override: ['steps']
      };
      const result = validateInheritanceFrontmatter(fm, { slug: 'critic-loop', version: '1.0.0' });
      expect(result.errors.some((e) => e.code === 'structural_override_forbidden' && e.field === 'steps')).toBe(true);
    });

    test('structural_override_forbidden rejects chain_root field', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'critic-loop',
        override: ['chain_root']
      };
      const result = validateInheritanceFrontmatter(fm, { slug: 'critic-loop', version: '1.0.0' });
      expect(result.errors.some((e) => e.code === 'structural_override_forbidden' && e.field === 'chain_root')).toBe(true);
    });

    test('structural_override_forbidden rejects inherits field', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'critic-loop',
        override: ['inherits']
      };
      const result = validateInheritanceFrontmatter(fm, { slug: 'critic-loop', version: '1.0.0' });
      expect(result.errors.some((e) => e.code === 'structural_override_forbidden' && e.field === 'inherits')).toBe(true);
    });

    test('structural_override_forbidden rejects override field', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'critic-loop',
        override: ['override']
      };
      const result = validateInheritanceFrontmatter(fm, { slug: 'critic-loop', version: '1.0.0' });
      expect(result.errors.some((e) => e.code === 'structural_override_forbidden' && e.field === 'override')).toBe(true);
    });

    test('override_unknown_field rejects field not in parent frontmatter', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'critic-loop',
        override: ['nonexistent_field']
      };
      const parentFm: InheritanceFrontmatter = {
        slug: 'critic-loop',
        version: '2.1.0'
      };
      const result = validateInheritanceFrontmatter(fm, parentFm);
      expect(result.errors.some((e) => e.code === 'override_unknown_field' && e.field === 'nonexistent_field')).toBe(true);
    });

    test('override_unknown_field allows field present in parent frontmatter', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'critic-loop',
        override: ['version']
      };
      const parentFm: InheritanceFrontmatter = {
        slug: 'critic-loop',
        version: '2.1.0'
      };
      const result = validateInheritanceFrontmatter(fm, parentFm);
      expect(result.errors.filter((e) => e.code === 'override_unknown_field')).toHaveLength(0);
    });

    test('override_unknown_field allows known overridable fields (tags, metadata)', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'critic-loop',
        override: ['tags', 'metadata']
      };
      const parentFm: InheritanceFrontmatter = {
        slug: 'critic-loop',
        version: '2.1.0'
      };
      const result = validateInheritanceFrontmatter(fm, parentFm);
      expect(result.errors.filter((e) => e.code === 'override_unknown_field')).toHaveLength(0);
    });

    test('parent_missing emits warning when parent frontmatter is null', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'unknown-parent',
        override: ['tags']
      };
      const result = validateInheritanceFrontmatter(fm, null);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]!.code).toBe('parent_missing');
      expect(result.warnings[0]!.message).toContain('unknown-parent');
    });

    test('parent_missing does NOT emit error (graceful degradation)', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'unknown-parent'
      };
      const result = validateInheritanceFrontmatter(fm, null);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
    });

    test('happy path: valid inheritance with known override fields', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'critic-loop',
        override: ['tags', 'metadata'],
        slug: 'specialized-reviewer',
        version: '1.0.0'
      };
      const parentFm: InheritanceFrontmatter = {
        slug: 'critic-loop',
        version: '2.1.0',
        tags: ['review'],
        metadata: {}
      };
      const result = validateInheritanceFrontmatter(fm, parentFm);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    test('multiple errors are accumulated', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'critic-loop',
        override: ['contract', 'type', 'nonexistent']
      };
      const parentFm: InheritanceFrontmatter = {
        slug: 'critic-loop',
        version: '1.0.0'
      };
      const result = validateInheritanceFrontmatter(fm, parentFm);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
      expect(result.errors.filter((e) => e.code === 'structural_override_forbidden')).toHaveLength(2);
      expect(result.errors.filter((e) => e.code === 'override_unknown_field')).toHaveLength(1);
    });
  });

  describe('STRUCTURAL_OVERRIDE_FORBIDDEN_FIELDS', () => {
    test('contains all expected fields', () => {
      expect(STRUCTURAL_OVERRIDE_FORBIDDEN_FIELDS.has('contract')).toBe(true);
      expect(STRUCTURAL_OVERRIDE_FORBIDDEN_FIELDS.has('type')).toBe(true);
      expect(STRUCTURAL_OVERRIDE_FORBIDDEN_FIELDS.has('steps')).toBe(true);
      expect(STRUCTURAL_OVERRIDE_FORBIDDEN_FIELDS.has('chain_root')).toBe(true);
      expect(STRUCTURAL_OVERRIDE_FORBIDDEN_FIELDS.has('inherits')).toBe(true);
      expect(STRUCTURAL_OVERRIDE_FORBIDDEN_FIELDS.has('override')).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration: graph-db-unavailable graceful degradation in train-store
// ---------------------------------------------------------------------------

const mockWarn = jest.fn();
const mockDebug = jest.fn();
const mockInfo = jest.fn();
const mockError = jest.fn();

/** Track whether graph singleton returns null (unavailable). */
let graphDbAvailable = false;
const mockWriteAdapterFromFrontmatter = jest.fn<any>();

function graphDbSingletonFactory() {
  return {
    getGraphDbService: () => {
      if (!graphDbAvailable) return null;
      return {
        isInitialized: () => true,
        writeAdapterFromFrontmatter: mockWriteAdapterFromFrontmatter
      };
    },
    initGraphDb: jest.fn<any>(),
    closeGraphDb: jest.fn<any>()
  };
}

function loggerFactory() {
  const loggerDouble = {
    debug: mockDebug,
    info: mockInfo,
    warn: mockWarn,
    error: mockError
  };
  return {
    structuredLogger: loggerDouble,
    // `logger` is consumed by key-value-store-factory (pulled in via train.ts ->
    // dump.ts -> proof-of-work-store). Export it so the mock module is complete.
    logger: loggerDouble,
    writeAuditLine: jest.fn<any>()
  };
}

function registerMocks(): void {
  jest.unstable_mockModule('../../src/services/graph-db/graph-db-singleton.js', graphDbSingletonFactory);
  jest.unstable_mockModule('../../src/utils/structured-logger.js', loggerFactory);
  jest.doMock('../../src/services/graph-db/graph-db-singleton.js', graphDbSingletonFactory);
  jest.doMock('../../src/utils/structured-logger.js', loggerFactory);
}

describe('train-store graph integration (Touchpoint 3)', () => {
  beforeEach(() => {
    graphDbAvailable = false;
    mockWriteAdapterFromFrontmatter.mockReset();
    mockWarn.mockClear();
    mockDebug.mockClear();
    mockInfo.mockClear();
    mockError.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('graph-db unavailable: memory write still succeeds (graceful degradation)', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = false;

    // Import the train-store module fresh (uses mocked singleton)
    const { executeTrainStore, TrainError } = await import('../../src/tools/train-store.js');

    const validMarkdown = [
      '---',
      'slug: test-adapter',
      'version: 1.0.0',
      '---',
      '',
      '# Test Adapter',
      '',
      '## Activation Patterns',
      '',
      '- test',
      '',
      '## Step 1',
      '',
      'Do something.',
      '',
      '```json',
      '{"contract": {"type": "shell", "shell": {"cmd": "echo hi", "interpreter": "bash"}}}',
      '```',
      '',
      '## Reward Signal',
      '',
      'Done.'
    ].join('\n');

    const mockMemory = {
      memory_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      label: 'Test Adapter',
      tags: ['test'],
      adapter: { id: 'adapter-id', name: 'Test Adapter' }
    };

    const mockMemoryStore = {
      storeAdapter: jest.fn<any>().mockResolvedValue([mockMemory]),
      storeArtifact: jest.fn<any>()
    };

    // Should succeed even without graph DB
    const result = await executeTrainStore(
      mockMemoryStore as any,
      { content: validMarkdown, llm_model_id: 'test-model' } as any,
      async (fn: any) => fn()
    );

    expect(result.status).toBe('stored');
    expect(result.items).toHaveLength(1);
    expect(mockWriteAdapterFromFrontmatter).not.toHaveBeenCalled();
  });

  test('graph-db available: writeAdapterFromFrontmatter called after successful store', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = true;
    mockWriteAdapterFromFrontmatter.mockResolvedValue(undefined);

    const { executeTrainStore } = await import('../../src/tools/train-store.js');

    const validMarkdown = [
      '---',
      'slug: test-adapter',
      'version: 1.0.0',
      'inherits: parent-adapter',
      '---',
      '',
      '# Test Adapter',
      '',
      '## Activation Patterns',
      '',
      '- test',
      '',
      '## Step 1',
      '',
      'Do something.',
      '',
      '```json',
      '{"contract": {"type": "shell", "shell": {"cmd": "echo hi", "interpreter": "bash"}}}',
      '```',
      '',
      '## Reward Signal',
      '',
      'Done.'
    ].join('\n');

    const mockMemory = {
      memory_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      label: 'Test Adapter',
      tags: ['test'],
      adapter: { id: 'adapter-id', name: 'Test Adapter' }
    };

    const mockMemoryStore = {
      storeAdapter: jest.fn<any>().mockResolvedValue([mockMemory]),
      storeArtifact: jest.fn<any>()
    };

    const result = await executeTrainStore(
      mockMemoryStore as any,
      { content: validMarkdown, llm_model_id: 'test-model' } as any,
      async (fn: any) => fn()
    );

    expect(result.status).toBe('stored');
    expect(mockWriteAdapterFromFrontmatter).toHaveBeenCalledWith(
      'test-adapter',
      '1.0.0',
      expect.objectContaining({ inherits: 'parent-adapter', slug: 'test-adapter' }),
      expect.objectContaining({ title: 'test-adapter' })
    );
  });

  test('graph-db write failure does not propagate (logged and continues)', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = true;
    mockWriteAdapterFromFrontmatter.mockRejectedValue(new Error('LadybugDB: disk full'));

    const { executeTrainStore } = await import('../../src/tools/train-store.js');

    const validMarkdown = [
      '---',
      'slug: test-adapter',
      'version: 1.0.0',
      '---',
      '',
      '# Test Adapter',
      '',
      '## Activation Patterns',
      '',
      '- test',
      '',
      '## Step 1',
      '',
      'Do something.',
      '',
      '```json',
      '{"contract": {"type": "shell", "shell": {"cmd": "echo hi", "interpreter": "bash"}}}',
      '```',
      '',
      '## Reward Signal',
      '',
      'Done.'
    ].join('\n');

    const mockMemory = {
      memory_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      label: 'Test Adapter',
      tags: ['test'],
      adapter: { id: 'adapter-id', name: 'Test Adapter' }
    };

    const mockMemoryStore = {
      storeAdapter: jest.fn<any>().mockResolvedValue([mockMemory]),
      storeArtifact: jest.fn<any>()
    };

    // Should still succeed despite graph write failure
    const result = await executeTrainStore(
      mockMemoryStore as any,
      { content: validMarkdown, llm_model_id: 'test-model' } as any,
      async (fn: any) => fn()
    );

    expect(result.status).toBe('stored');
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('writeAdapterFromFrontmatter failed'));
  });

  test('structural_override_forbidden fails the tool call BEFORE memory write', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = false;

    const { executeTrainStore, TrainError } = await import('../../src/tools/train-store.js');

    const invalidMarkdown = [
      '---',
      'slug: bad-adapter',
      'version: 1.0.0',
      'inherits: critic-loop',
      'override: [contract, tags]',
      '---',
      '',
      '# Bad Adapter',
      '',
      '## Activation Patterns',
      '',
      '- test',
      '',
      '## Step 1',
      '',
      'Do something.',
      '',
      '```json',
      '{"contract": {"type": "shell", "shell": {"cmd": "echo hi", "interpreter": "bash"}}}',
      '```',
      '',
      '## Reward Signal',
      '',
      'Done.'
    ].join('\n');

    const mockMemoryStore = {
      storeAdapter: jest.fn<any>().mockResolvedValue([]),
      storeArtifact: jest.fn<any>()
    };

    await expect(
      executeTrainStore(
        mockMemoryStore as any,
        { content: invalidMarkdown, llm_model_id: 'test-model' } as any,
        async (fn: any) => fn()
      )
    ).rejects.toThrow(/structural_override_forbidden/);

    // Memory write must NOT have been called
    expect(mockMemoryStore.storeAdapter).not.toHaveBeenCalled();
  });

  test('single_parent array inherits fails BEFORE memory write', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = false;

    const { executeTrainStore } = await import('../../src/tools/train-store.js');

    const invalidMarkdown = [
      '---',
      'slug: bad-adapter',
      'version: 1.0.0',
      'inherits: [parent-a, parent-b]',
      '---',
      '',
      '# Bad Adapter',
      '',
      '## Activation Patterns',
      '',
      '- test',
      '',
      '## Step 1',
      '',
      'Do something.',
      '',
      '```json',
      '{"contract": {"type": "shell", "shell": {"cmd": "echo hi", "interpreter": "bash"}}}',
      '```',
      '',
      '## Reward Signal',
      '',
      'Done.'
    ].join('\n');

    const mockMemoryStore = {
      storeAdapter: jest.fn<any>().mockResolvedValue([]),
      storeArtifact: jest.fn<any>()
    };

    await expect(
      executeTrainStore(
        mockMemoryStore as any,
        { content: invalidMarkdown, llm_model_id: 'test-model' } as any,
        async (fn: any) => fn()
      )
    ).rejects.toThrow(/single_parent/);

    expect(mockMemoryStore.storeAdapter).not.toHaveBeenCalled();
  });

  test('parent_missing produces warning in output, not error', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = false;

    const { executeTrainStore } = await import('../../src/tools/train-store.js');

    const markdownWithMissingParent = [
      '---',
      'slug: child-adapter',
      'version: 1.0.0',
      'inherits: nonexistent-parent',
      'override: [tags]',
      '---',
      '',
      '# Child Adapter',
      '',
      '## Activation Patterns',
      '',
      '- test',
      '',
      '## Step 1',
      '',
      'Do something.',
      '',
      '```json',
      '{"contract": {"type": "shell", "shell": {"cmd": "echo hi", "interpreter": "bash"}}}',
      '```',
      '',
      '## Reward Signal',
      '',
      'Done.'
    ].join('\n');

    const mockMemory = {
      memory_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      label: 'Child Adapter',
      tags: ['test'],
      adapter: { id: 'adapter-id', name: 'Child Adapter' }
    };

    const mockMemoryStore = {
      storeAdapter: jest.fn<any>().mockResolvedValue([mockMemory]),
      storeArtifact: jest.fn<any>()
    };

    const result = await executeTrainStore(
      mockMemoryStore as any,
      { content: markdownWithMissingParent, llm_model_id: 'test-model' } as any,
      async (fn: any) => fn()
    );

    // Should succeed (parent_missing is a warning, not an error)
    expect(result.status).toBe('stored');
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings![0]!.code).toBe('parent_missing');
  });
});

// ---------------------------------------------------------------------------
// Part 2: inheritance warnings bubble up to the MCP-facing train response
// ---------------------------------------------------------------------------
//
// This suite is transpiled to CommonJS, so `await import()` becomes require().
// train.ts transitively reaches build-version.ts (an ESM-only module) through
// BOTH mcp-metrics -> registry and dump -> embedding -> registry, which cannot be
// require()d. We stub those two edges (executeTrain uses neither: metrics are
// only touched by the registered handler, executeDump only by fork resolution)
// so the require graph stays CJS-safe.
function trainHeavyDepMocks(): void {
  const dumpFactory = () => ({ executeDump: jest.fn<any>() });
  const metricsFactory = () => ({
    squadrulesTrainSimilarAdapterFound: { inc: jest.fn<any>() },
    mcpToolCalls: { inc: jest.fn<any>() },
    mcpToolDuration: { startTimer: jest.fn<any>(() => jest.fn<any>()) },
    mcpToolErrors: { inc: jest.fn<any>() },
    mcpToolInputSize: { observe: jest.fn<any>() },
    mcpToolOutputSize: { observe: jest.fn<any>() }
  });
  jest.unstable_mockModule('../../src/tools/dump.js', dumpFactory);
  jest.doMock('../../src/tools/dump.js', dumpFactory);
  jest.unstable_mockModule('../../src/services/metrics/mcp-metrics.js', metricsFactory);
  jest.doMock('../../src/services/metrics/mcp-metrics.js', metricsFactory);
}

function childMarkdownWithMissingParent(): string {
  return [
    '---',
    'slug: child-adapter',
    'version: 1.0.0',
    'inherits: nonexistent-parent',
    'override: [tags]',
    '---',
    '',
    '# Child Adapter',
    '',
    '## Activation Patterns',
    '',
    '- test',
    '',
    '## Step 1',
    '',
    'Do something.',
    '',
    '```json',
    '{"contract": {"type": "shell", "shell": {"cmd": "echo hi", "interpreter": "bash"}}}',
    '```',
    '',
    '## Reward Signal',
    '',
    'Done.'
  ].join('\n');
}

function plainMarkdown(): string {
  return [
    '---',
    'slug: plain-adapter',
    'version: 1.0.0',
    '---',
    '',
    '# Plain Adapter',
    '',
    '## Activation Patterns',
    '',
    '- test',
    '',
    '## Step 1',
    '',
    'Do something.',
    '',
    '```json',
    '{"contract": {"type": "shell", "shell": {"cmd": "echo hi", "interpreter": "bash"}}}',
    '```',
    '',
    '## Reward Signal',
    '',
    'Done.'
  ].join('\n');
}

function makeMemoryStore(memory: unknown) {
  return {
    storeAdapter: jest.fn<any>().mockResolvedValue([memory]),
    storeArtifact: jest.fn<any>(),
    getMemory: jest.fn<any>().mockResolvedValue(null)
  };
}

const REVIEW_EVIDENCE = { verdict_file: '/tmp/verdict.md', exit_code: 0, stdout: 'PASS' };

describe('train MCP response surfaces inheritance warnings (Part 2)', () => {
  beforeEach(() => {
    graphDbAvailable = false;
    mockWriteAdapterFromFrontmatter.mockReset();
    mockWarn.mockClear();
    mockDebug.mockClear();
    mockInfo.mockClear();
    mockError.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('parent_missing warning appears in the MCP train output and validates against trainOutputSchema', async () => {
    jest.resetModules();
    registerMocks();
    trainHeavyDepMocks();
    graphDbAvailable = false;

    const { executeTrain } = await import('../../src/tools/train.js');
    const { trainOutputSchema } = await import('../../src/tools/train_schema.js');

    const mockMemoryStore = makeMemoryStore({
      memory_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      label: 'Child Adapter',
      tags: ['test'],
      adapter: { id: 'adapter-id', name: 'Child Adapter' }
    });

    const output = await executeTrain(
      mockMemoryStore as any,
      {
        content: childMarkdownWithMissingParent(),
        llm_model_id: 'test-model',
        review_evidence: REVIEW_EVIDENCE
      } as any,
      async (fn: any) => fn(),
      undefined
    );

    expect(output.status).toBe('stored');
    expect(output.warnings).toBeDefined();
    expect(Array.isArray(output.warnings)).toBe(true);
    expect(output.warnings!.some((w) => w.includes('parent_missing'))).toBe(true);

    // The MCP-facing schema stays .strict()-compatible with the new optional field.
    expect(trainOutputSchema.safeParse(output).success).toBe(true);
  });

  test('no warnings field when the adapter has no inheritance', async () => {
    jest.resetModules();
    registerMocks();
    trainHeavyDepMocks();
    graphDbAvailable = false;

    const { executeTrain } = await import('../../src/tools/train.js');
    const { trainOutputSchema } = await import('../../src/tools/train_schema.js');

    const mockMemoryStore = makeMemoryStore({
      memory_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      label: 'Plain Adapter',
      tags: ['test'],
      adapter: { id: 'adapter-id', name: 'Plain Adapter' }
    });

    const output = await executeTrain(
      mockMemoryStore as any,
      {
        content: plainMarkdown(),
        llm_model_id: 'test-model',
        review_evidence: REVIEW_EVIDENCE
      } as any,
      async (fn: any) => fn(),
      undefined
    );

    expect(output.status).toBe('stored');
    expect(output.warnings).toBeUndefined();
    expect(trainOutputSchema.safeParse(output).success).toBe(true);
  });
});
