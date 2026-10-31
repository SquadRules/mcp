/**
 * Regression guard for issue #199: in local mode nothing serves the skill_zip
 * download_ref URL, so LocalBackend.export must default an unspecified delivery
 * to `inline_base64` (bytes in the response) while preserving an explicit
 * delivery. The execute* cores and the runtime boot are mocked — this asserts
 * only the input LocalBackend hands to executeExport, and is ONNX-safe inside a
 * Jest worker. Uses jest.unstable_mockModule + dynamic imports because the
 * suite runs as native ESM, where jest.mock cannot intercept static imports.
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

const executeExportMock = executeExport as jest.MockedFunction<typeof executeExport>;

function lastExportInput(): ExportInputT {
  const calls = executeExportMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![2] as ExportInputT;
}

describe('LocalBackend.export skill_zip delivery default (issue #199)', () => {
  beforeEach(() => {
    executeExportMock.mockClear();
  });

  it('defaults skill_zip to inline_base64 when the caller passed no delivery', async () => {
    const backend = await LocalBackend.create();
    await backend.export({ uri: 'squadrules://adapter/sample-adapter-a', format: 'skill_zip' });
    const input = lastExportInput();
    expect(input.format).toBe('skill_zip');
    expect(input.delivery).toBe('inline_base64');
  });

  it('defaults delivery for a multi-adapter selection too', async () => {
    const backend = await LocalBackend.create();
    await backend.export({
      all_adapters: true,
      space_name: 'personal',
      format: 'skill_zip'
    });
    expect(lastExportInput().delivery).toBe('inline_base64');
  });

  it('preserves an explicit delivery', async () => {
    const backend = await LocalBackend.create();
    await backend.export({
      uri: 'squadrules://adapter/sample-adapter-a',
      format: 'skill_zip',
      delivery: 'download_ref'
    });
    expect(lastExportInput().delivery).toBe('download_ref');

    await backend.export({
      uri: 'squadrules://adapter/sample-adapter-a',
      format: 'skill_zip',
      delivery: 'inline_base64'
    });
    expect(lastExportInput().delivery).toBe('inline_base64');
  });

  it('does not add a delivery for non-skill_zip formats', async () => {
    const backend = await LocalBackend.create();
    await backend.export({ uri: 'squadrules://adapter/sample-adapter-a', format: 'skill_tree' });
    expect(lastExportInput().delivery).toBeUndefined();
  });
});
