/**
 * Regression tests for issue #204: the ts-node source lane must compile.
 *
 * On a fresh checkout (no dist/), the test harnesses spawn the server as
 * `node --loader ts-node/esm src/bootstrap.ts`. ts-node type-checks every
 * imported file with its own resolver, which diverges from plain `tsc`:
 *
 * - `import helmet from 'helmet'` in src/http/http-server-config.ts resolved
 *   to helmet's CJS declarations, where the default import is the module
 *   namespace — TS2349 "This expression is not callable" — killing the server
 *   child at import and failing ~79 stdio suites with
 *   "MCP error -32000: Connection closed".
 * - The ambient `declare module "archiver"` in src/types/archiver-zip.d.ts
 *   was invisible to ts-node (TS7016) until tsconfig.json set
 *   `"ts-node": { "files": true }`.
 *
 * These tests exercise the real loader against the real modules (not a
 * reimplementation), so they fail if either resolution fix regresses.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from '@jest/globals';

const ROOT = process.cwd();

function importViaTsNodeEsm(relativeModulePaths: string[]) {
  const statements = relativeModulePaths
    .map((p) => `await import(${JSON.stringify(pathToFileURL(path.resolve(ROOT, p)).href)});`)
    .join('\n');
  return spawnSync(
    process.execPath,
    ['--loader', 'ts-node/esm', '--input-type=module', '-e', statements],
    { cwd: ROOT, encoding: 'utf8', timeout: 180_000 }
  );
}

function expectCleanImport(result: ReturnType<typeof importViaTsNodeEsm>) {
  const stderr = result.stderr ?? '';
  // Surface the real diagnostics in the failure message before asserting.
  expect(stderr).not.toMatch(/error TS\d+/);
  expect(stderr).not.toContain('[bootstrap] Uncaught exception');
  expect(result.status).toBe(0);
}

describe('ts-node ESM source lane compiles server modules (fresh-checkout harness path)', () => {
  test('src/http/http-server-config.ts imports without TS2349 on the helmet default import', () => {
    expectCleanImport(importViaTsNodeEsm(['src/http/http-server-config.ts']));
  }, 240_000);

  test('ambient declarations are visible to ts-node (src/tools/skill-export/zip-bundle.ts imports archiver)', () => {
    expectCleanImport(importViaTsNodeEsm(['src/tools/skill-export/zip-bundle.ts']));
  }, 240_000);
});
