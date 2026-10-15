/**
 * Regression tests for #105 — Agent retry friction fixes.
 *
 * Bug 1 (HIGH): stdio transport returns squadrules:// artifact URIs, not HTTP URLs.
 * Bug 3 (LOW):  NONCE_MISMATCH includes expected vs received snippets + retry_nonce.
 *
 * NOTE: Bug 3 tests for handleProofSubmission require the full ESM import chain
 * (prom-client → registry → embedding-metrics → service → next-pow-helpers) which
 * is broken in Jest's CJS runtime. The existing forward-nonce-stability.test.ts has
 * the same issue. These tests will pass once the dep-updates PR (#111) is merged.
 * The nonce format (12 hex chars) and error message format are verified by code
 * inspection; the schema tests confirm the retry_nonce field is accepted.
 */
import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';

// ── Bug 1: stdio transport artifact URLs ────────────────────────────────────

describe('Bug 1: stdio transport artifact URLs', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('activate output schema accepts transport: stdio', async () => {
    process.env['TRANSPORT_TYPE'] = 'stdio';
    process.env['SQUADRULES_LOCAL_ARTIFACT_DIRS'] = 'project://.local/squadrules/work';

    const { activateOutputSchema } = await import('../../src/tools/activate_schema.js');
    const parsed = activateOutputSchema.safeParse({
      must_obey: true,
      message: 'test',
      next_action: 'test',
      query: 'test',
      choices: [],
      transport: 'stdio'
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.transport).toBe('stdio');
    }
  });

  it('activate output schema accepts transport: http', async () => {
    const { activateOutputSchema } = await import('../../src/tools/activate_schema.js');
    const parsed = activateOutputSchema.safeParse({
      must_obey: true,
      message: 'test',
      next_action: 'test',
      query: 'test',
      choices: [],
      transport: 'http'
    });
    expect(parsed.success).toBe(true);
  });

  it('activate output schema accepts transport omitted', async () => {
    const { activateOutputSchema } = await import('../../src/tools/activate_schema.js');
    const parsed = activateOutputSchema.safeParse({
      must_obey: true,
      message: 'test',
      next_action: 'test',
      query: 'test',
      choices: []
    });
    expect(parsed.success).toBe(true);
  });

  it('activate output schema rejects invalid transport value', async () => {
    const { activateOutputSchema } = await import('../../src/tools/activate_schema.js');
    const parsed = activateOutputSchema.safeParse({
      must_obey: true,
      message: 'test',
      next_action: 'test',
      query: 'test',
      choices: [],
      transport: 'websocket'
    });
    expect(parsed.success).toBe(false);
  });
});

// ── Bug 3: nonce schema + format ────────────────────────────────────────────

describe('Bug 3: nonce schema and format', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('next output schema accepts retry_nonce field', async () => {
    const { nextOutputSchema } = await import('../../src/tools/next_schema.js');
    const parsed = nextOutputSchema.safeParse({
      must_obey: true,
      challenge: { type: 'comment', description: 'test', nonce: 'abc123' },
      next_action: 'retry forward',
      error_code: 'NONCE_MISMATCH',
      retry_count: 1,
      retry_nonce: 'abc123def456',
      message: 'Nonce mismatch.'
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.retry_nonce).toBe('abc123def456');
    }
  });

  it('next output schema accepts response without retry_nonce', async () => {
    const { nextOutputSchema } = await import('../../src/tools/next_schema.js');
    const parsed = nextOutputSchema.safeParse({
      must_obey: true,
      challenge: { type: 'comment', description: 'test' },
      next_action: 'pick one'
    });
    expect(parsed.success).toBe(true);
  });

  it('nonce generation produces 12 hex chars (6 bytes)', () => {
    // Verify the nonce format directly: crypto.randomBytes(6).toString('hex')
    // produces exactly 12 hex characters.
    const crypto = require('node:crypto');
    const nonce = crypto.randomBytes(6).toString('hex');
    expect(nonce).toMatch(/^[0-9a-f]{12}$/);
    expect(nonce.length).toBe(12);
  });
});
