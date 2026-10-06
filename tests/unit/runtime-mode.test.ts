import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import {
  assertStdioConfigConsistency,
  describeRuntimeMode,
  getStdioConfigViolations,
  resolveAuthEnabled,
  resolveTransportType
} from '../../src/config/runtime-mode.js';

/**
 * Runtime-mode rules for the two supported postures: `simple` (stdio transport,
 * embedded LanceDB, no HTTP listener) and `cluster` (http transport, auth on).
 *
 * These are pinned here rather than through `src/config.ts` because the module-level
 * constants there are evaluated once per process from the ambient `.env`; the
 * resolution logic is pure and must be tested against arbitrary env shapes.
 */

describe('resolveTransportType', () => {
  it('defaults to http for a bare process (compose, container CMD, node dist/index.js)', () => {
    expect(resolveTransportType({})).toBe('http');
  });

  it('selects stdio when launched through the local MCP server bin', () => {
    expect(resolveTransportType({ SQUADRULES_MCP_STDIO: '1' })).toBe('stdio');
  });

  it('selects stdio for `squadrules serve`', () => {
    expect(resolveTransportType({ SQUADRULES_CLI_SERVE: '1' })).toBe('stdio');
  });

  it('ignores a serve marker that is not exactly "1"', () => {
    // Mirrors the previous behaviour: `SQUADRULES_CLI_SERVE=true` was not a trigger.
    expect(resolveTransportType({ SQUADRULES_CLI_SERVE: 'true' })).toBe('http');
  });

  it('lets an explicit TRANSPORT_TYPE win over both markers', () => {
    const env = { SQUADRULES_MCP_STDIO: '1', SQUADRULES_CLI_SERVE: '1', TRANSPORT_TYPE: 'http' };
    expect(resolveTransportType(env)).toBe('http');
  });

  it('treats an empty TRANSPORT_TYPE as unset', () => {
    expect(resolveTransportType({ TRANSPORT_TYPE: '  ', SQUADRULES_MCP_STDIO: '1' })).toBe('stdio');
  });

  it('maps any non-http value to stdio, as before', () => {
    expect(resolveTransportType({ TRANSPORT_TYPE: 'STDIO' })).toBe('stdio');
    expect(resolveTransportType({ TRANSPORT_TYPE: 'nonsense' })).toBe('stdio');
  });
});

describe('resolveAuthEnabled', () => {
  it('is on for the clustered posture', () => {
    expect(resolveAuthEnabled({})).toBe(true);
    expect(resolveAuthEnabled({ TRANSPORT_TYPE: 'http' })).toBe(true);
  });

  it('is off for local stdio, which has no OIDC callback surface', () => {
    expect(resolveAuthEnabled({ SQUADRULES_MCP_STDIO: '1' })).toBe(false);
  });

  it('honours an explicit value in either direction', () => {
    expect(resolveAuthEnabled({ AUTH_ENABLED: 'true', SQUADRULES_MCP_STDIO: '1' })).toBe(true);
    expect(resolveAuthEnabled({ AUTH_ENABLED: 'false' })).toBe(false);
    expect(resolveAuthEnabled({ AUTH_ENABLED: '0' })).toBe(false);
    expect(resolveAuthEnabled({ AUTH_ENABLED: 'no' })).toBe(false);
  });

  it('falls back to the mode default for an unparseable value', () => {
    expect(resolveAuthEnabled({ AUTH_ENABLED: 'maybe', SQUADRULES_MCP_STDIO: '1' })).toBe(false);
    expect(resolveAuthEnabled({ AUTH_ENABLED: 'maybe' })).toBe(true);
  });
});

describe('describeRuntimeMode', () => {
  it('names stdio simple and http cluster', () => {
    expect(describeRuntimeMode('stdio')).toBe('simple');
    expect(describeRuntimeMode('http')).toBe('cluster');
  });
});

describe('getStdioConfigViolations', () => {
  it('never complains in the clustered posture', () => {
    const env = { TRANSPORT_TYPE: 'http', AUTH_ENABLED: 'true', QDRANT_URL: 'http://qdrant:6333' };
    expect(getStdioConfigViolations(env, 'http', true)).toEqual([]);
  });

  it('rejects auth on under stdio instead of failing silently at request time', () => {
    const violations = getStdioConfigViolations({ AUTH_ENABLED: 'true' }, 'stdio', true);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('cannot enable authentication');
    expect(violations[0]).toContain('AUTH_ENABLED=false');
  });

  it('rejects an external Qdrant under stdio', () => {
    const env = { QDRANT_URL: 'http://qdrant:6333' };
    const violations = getStdioConfigViolations(env, 'stdio', false);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('embedded LanceDB');
    expect(violations[0]).toContain('QDRANT_URL');
  });

  it('reports both problems at once', () => {
    const env = { AUTH_ENABLED: 'true', QDRANT_URL: 'http://qdrant:6333' };
    expect(getStdioConfigViolations(env, 'stdio', true)).toHaveLength(2);
  });

  it('accepts an explicitly empty QDRANT_URL (embedded backend)', () => {
    expect(getStdioConfigViolations({ QDRANT_URL: '  ' }, 'stdio', false)).toEqual([]);
  });

  it('passes the clean local configuration an MCP host sends', () => {
    expect(getStdioConfigViolations({ SQUADRULES_MCP_STDIO: '1' }, 'stdio', false)).toEqual([]);
  });
});

describe('assertStdioConfigConsistency', () => {
  // The message a contradictory local profile actually sees at startup, asserted here
  // rather than through a spawned server so it stays independent of the ambient .env.
  const keys = ['QDRANT_URL', 'AUTH_ENABLED'] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of keys) saved[key] = process.env[key];
    process.env['QDRANT_URL'] = '';
  });

  afterEach(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('throws the mode error for stdio with auth enabled', () => {
    expect(() => assertStdioConfigConsistency('stdio', true)).toThrow(/cannot enable authentication/);
  });

  it('throws for stdio with an external Qdrant', () => {
    process.env['QDRANT_URL'] = 'http://qdrant:6333';
    expect(() => assertStdioConfigConsistency('stdio', false)).toThrow(/embedded LanceDB/);
  });

  it('says nothing for the clustered posture', () => {
    process.env['QDRANT_URL'] = 'http://qdrant:6333';
    expect(() => assertStdioConfigConsistency('http', true)).not.toThrow();
  });
});

describe('src/config.ts wiring', () => {
  it('derives TRANSPORT_TYPE and AUTH_ENABLED from these same rules', async () => {
    let config: typeof import('../../src/config.js');
    try {
      config = await import('../../src/config.js');
    } catch (error) {
      // A contradictory ambient .env is a finding, not a test bug: only the stdio
      // guards are allowed to stop the module from loading.
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('TRANSPORT_TYPE=stdio');
      return;
    }
    expect(config.TRANSPORT_TYPE).toBe(resolveTransportType(process.env));
    expect(config.AUTH_ENABLED).toBe(resolveAuthEnabled(process.env, config.TRANSPORT_TYPE));
    expect(
      getStdioConfigViolations(process.env, config.TRANSPORT_TYPE, config.AUTH_ENABLED)
    ).toEqual([]);
  });
});
