/**
 * Log-sink routing unit tests. stdout is a data channel for the stdio MCP transport and
 * for the CLI process; logs must go to stderr in both cases so payloads stay parseable.
 * Pure — no server, no embedded store, no ONNX.
 */
import { describe, expect, it } from '@jest/globals';
import { shouldLogToStderr } from '../../src/utils/log-core.js';

describe('shouldLogToStderr', () => {
  it('routes stdio transport to stderr even without the CLI flag', () => {
    expect(shouldLogToStderr('stdio', false)).toBe(true);
    expect(shouldLogToStderr('stdio', true)).toBe(true);
  });

  it('routes the CLI (forced) to stderr under http transport', () => {
    // The bug: a local-mode data command resolves to http transport, so without the
    // forced flag its boot logs would land on stdout and corrupt `activate ... | jq`.
    expect(shouldLogToStderr('http', true)).toBe(true);
  });

  it('keeps http server logs on stdout when not forced', () => {
    expect(shouldLogToStderr('http', false)).toBe(false);
  });
});
