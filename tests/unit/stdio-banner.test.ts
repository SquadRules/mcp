import { describe, expect, it } from '@jest/globals';
import { composeStdioModeBanner } from '../../src/stdio/stdio-banner.js';

/**
 * The stderr banner a local stdio launch prints before the first (slow) boot.
 *
 * Only the mode-independent lines are asserted: the ambient `.env` decides the
 * embedding and store lines, and this suite must not depend on it.
 */

describe('composeStdioModeBanner', () => {
  const banner = composeStdioModeBanner('/tmp/example/squadrules/lancedb');

  it('names the mode and the transport on the first line', () => {
    expect(banner.split('\n')[0]).toContain('simple local mode (stdio transport)');
  });

  it('states that no HTTP surface exists', () => {
    expect(banner).toContain('no listener (/api, /ui, metrics');
  });

  it('states that in-memory state does not survive a restart', () => {
    expect(banner).toContain('lost on restart');
  });

  it('ends with a newline so stderr stays readable when the host writes after it', () => {
    expect(banner.endsWith('\n')).toBe(true);
  });

  it('carries no ANSI escapes or carriage returns (host logs are machine-parsed)', () => {
    expect(banner).not.toMatch(/\u001B\[[0-9;]*m/);
    expect(banner).not.toContain('\r');
  });

  it('names the store backend the process will actually use', () => {
    // Which of the two depends on the ambient QDRANT_URL; the banner must never be
    // silent about it, and the stdio guards in runtime-mode.ts reject the Qdrant case.
    expect(banner).toMatch(/embedded LanceDB at \/tmp\/example\/squadrules\/lancedb|external Qdrant/);
  });
});
