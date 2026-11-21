/**
 * Qdrant boot-injection dedupe regression.
 *
 * Execute real ONNX inference in a plain Node child, never in the Jest VM
 * (ADR 0004: Float32Array constructors differ across realms).
 * The child asserts the initial insert, duplicate-slug corruption and recovery.
 */
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { isHttpTransport } from '../utils/auth-headers.js';
import { testQdrantBackend } from '../utils/vector-backend.js';

const execFileAsync = promisify(execFile);
const _d = isHttpTransport() ? describe : describe.skip;

_d('Mem resources boot injection dedupe regression', () => {
  testQdrantBackend('boot injection recovers when app-space already contains duplicate slug entries', async () => {
    const child = join(process.cwd(), 'tests/scripts/mem-boot-dedupe-child.mjs');
    const { stdout } = await execFileAsync(process.execPath, [child], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SQUADRULES_LOG_STDERR: '1',
        LOG_LEVEL: 'error',
      },
      timeout: 300000,
      maxBuffer: 32 * 1024 * 1024,
    });
    expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ ok: true }));
  }, 360000);
});
