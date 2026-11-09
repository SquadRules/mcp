/**
 * Train MCP response surface for inheritance warnings (Touchpoint 3, Part 2).
 *
 * Honest naming: the memory store and the graph are DOUBLES; what is real here is
 * `executeTrain` plus `trainOutputSchema`. The assertion is a contract assertion — the
 * warning must reach the MCP-facing payload and the payload must still satisfy the
 * `.strict()` output schema, so a new optional field cannot silently break the wire.
 *
 * `train.ts` transitively reaches `build-version.ts` (an ESM-only module) through BOTH
 * `mcp-metrics -> registry` and `dump -> embedding -> registry`, which cannot be
 * `require()`d under this suite's CommonJS transform. We stub those two edges;
 * `executeTrain` uses neither (metrics are only touched by the registered handler,
 * `executeDump` only by fork resolution), so the require graph stays CJS-safe.
 *
 * Split out of `graph-db-train-unit.test.ts` when that file exceeded the 350-line cap.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { graphState, registerMocks, resetTrainDoubles, storedHead, validMarkdown } from './graph-db-train-unit-harness.js';

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
  return validMarkdown({ slug: 'child-adapter', frontmatter: ['inherits: nonexistent-parent', 'override: [tags]'] });
}

function plainMarkdown(): string {
  return validMarkdown({ slug: 'plain-adapter' });
}

function makeMemoryStore(memory: unknown) {
  return {
    storeAdapter: jest.fn<any>().mockResolvedValue([memory]),
    storeArtifact: jest.fn<any>(),
    getMemory: jest.fn<any>().mockImplementation(async (uuid: string) =>
      (memory as { memory_uuid?: string }).memory_uuid === uuid ? memory : null
    ),
    scrollSpace: jest.fn<any>().mockResolvedValue([])
  };
}

const REVIEW_EVIDENCE = { verdict_file: '/tmp/verdict.md', exit_code: 0, stdout: 'PASS' };

describe('train MCP response surfaces inheritance warnings (Part 2)', () => {
  beforeEach(() => {
    resetTrainDoubles();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('parent_missing warning appears in the MCP train output and validates against trainOutputSchema', async () => {
    jest.resetModules();
    registerMocks();
    trainHeavyDepMocks();
    graphState.available = false;

    const { executeTrain } = await import('../../src/tools/train.js');
    const { trainOutputSchema } = await import('../../src/tools/train_schema.js');

    const mockMemoryStore = makeMemoryStore(
      storedHead({ uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', slug: 'child-adapter', name: 'Child Adapter' })
    );

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
    graphState.available = false;

    const { executeTrain } = await import('../../src/tools/train.js');
    const { trainOutputSchema } = await import('../../src/tools/train_schema.js');

    const mockMemoryStore = makeMemoryStore(
      storedHead({ uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', slug: 'plain-adapter', name: 'Plain Adapter' })
    );

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
