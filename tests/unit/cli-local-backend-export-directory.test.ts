/**
 * Issue #201 gap 2 (backend wiring): LocalBackend.export must hand `directory` to
 * executeExport unchanged and mark the call as SIMPLE-mode equivalent, so the
 * directory transport gate lifts for the in-process CLI runtime. Mirrors the
 * cli-local-backend-export-delivery.test.ts harness: execute* cores and the runtime
 * boot are mocked; this asserts only what LocalBackend passes to executeExport.
 * Uses jest.unstable_mockModule + dynamic imports because the suite runs as native
 * ESM, where jest.mock cannot intercept static imports.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../src/runtime/boot-local-runtime.js', () => ({
  bootLocalRuntime: jest.fn(async () => ({ memoryStore: {}, qdrantService: {} }))
}));
jest.unstable_mockModule('../../src/services/embedding/lazy-probe.js', () => ({
  ensureEmbeddingDimension: jest.fn(async () => {})
}));
jest.unstable_mockModule('../../src/tools/activate.js', () => ({ executeActivate: jest.fn() }));
jest.unstable_mockModule('../../src/tools/forward.js', () => ({ executeForward: jest.fn() }));
jest.unstable_mockModule('../../src/tools/train.js', () => ({ executeTrain: jest.fn() }));
jest.unstable_mockModule('../../src/tools/tune.js', () => ({ executeTune: jest.fn() }));
jest.unstable_mockModule('../../src/tools/delete.js', () => ({ executeDelete: jest.fn() }));
jest.unstable_mockModule('../../src/tools/reward.js', () => ({ executeReward: jest.fn() }));
jest.unstable_mockModule('../../src/tools/spaces.js', () => ({ executeSpaces: jest.fn() }));
jest.unstable_mockModule('../../src/tools/export.js', () => ({
  // Echo the parsed input back so the test can inspect what LocalBackend passed.
  executeExport: jest.fn(
    async (_memoryStore: unknown, _qdrantService: unknown, input: unknown) => input
  )
}));

const { LocalBackend } = await import('../../src/cli/backend/local-backend.js');
const { executeExport } = await import('../../src/tools/export.js');
type ExportInputT = import('../../src/tools/export_schema.js').ExportInput;
type ExecuteExportOptionsT = import('../../src/tools/export.js').ExecuteExportOptions;

const executeExportMock = executeExport as jest.MockedFunction<typeof executeExport>;

function lastExportCall(): { input: ExportInputT; options: ExecuteExportOptionsT } {
  const calls = executeExportMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const last = calls[calls.length - 1]!;
  return { input: last[2] as ExportInputT, options: last[3] as ExecuteExportOptionsT };
}

describe('LocalBackend.export directory pass-through (issue #201 gap 2)', () => {
  beforeEach(() => {
    executeExportMock.mockClear();
  });

  it('passes directory through for a multi-adapter markdown export and lifts the transport gate', async () => {
    const backend = await LocalBackend.create();
    await backend.export({
      all_adapters: true,
      space_name: 'personal',
      format: 'markdown',
      include_reward: true,
      directory: '/tmp/squadrules-backup'
    });
    const { input, options } = lastExportCall();
    expect(input.directory).toBe('/tmp/squadrules-backup');
    expect(input.format).toBe('markdown');
    expect(options.simpleModeDirectoryAccess).toBe(true);
  });

  it('passes directory through for a single-uri markdown export', async () => {
    const backend = await LocalBackend.create();
    await backend.export({
      uri: 'squadrules://adapter/sample-adapter-a',
      format: 'markdown',
      include_reward: true,
      directory: '/tmp/squadrules-backup'
    });
    expect(lastExportCall().input.directory).toBe('/tmp/squadrules-backup');
  });

  it('does not add a delivery when directory markdown is requested', async () => {
    const backend = await LocalBackend.create();
    await backend.export({
      uri: 'squadrules://adapter/sample-adapter-a',
      format: 'markdown',
      include_reward: true,
      directory: '/tmp/squadrules-backup'
    });
    expect(lastExportCall().input.delivery).toBeUndefined();
  });
});
