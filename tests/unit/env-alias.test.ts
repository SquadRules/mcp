/**
 * Env-var alias infrastructure tests (KAIROS → SquadRules rebrand compat layer).
 *
 * Covers:
 *  - SQUADRULES_* takes precedence over KAIROS_* when BOTH are defined
 *  - Empty string SQUADRULES_X='' counts as "defined" and shadows KAIROS_X
 *  - Int 0 and bool false are NOT treated as falsy — they win over the prior value
 *  - When only KAIROS_* is set, it's used (backward compat)
 *  - Deprecation logged to stderr when only prior names are set
 *  - getEnvAliased, getEnvIntAliased, getEnvFloatAliased, getEnvBooleanAliased
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  resolveAliasedRaw,
  getEnvAliased,
  getEnvIntAliased,
  getEnvFloatAliased,
  getEnvBooleanAliased,
  logDeprecations,
  __resetEnvAliasStateForTests,
} from '../../src/config/env-alias.js';

const NEW_KEY = 'SQUADRULES_TEST_VAR';
const OLD_KEY = 'KAIROS_TEST_VAR';

let stderrSpy: jest.SpiedFunction<typeof process.stderr.write>;

beforeEach(() => {
  __resetEnvAliasStateForTests();
  delete process.env[NEW_KEY];
  delete process.env[OLD_KEY];
  stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stderrSpy.mockRestore();
  delete process.env[NEW_KEY];
  delete process.env[OLD_KEY];
  __resetEnvAliasStateForTests();
});

// ---------------------------------------------------------------------------
// resolveAliasedRaw
// ---------------------------------------------------------------------------

describe('resolveAliasedRaw', () => {
  it('returns undefined when neither key is set', () => {
    expect(resolveAliasedRaw(NEW_KEY, OLD_KEY)).toBeUndefined();
  });

  it('returns the new key value when only SQUADRULES_* is set', () => {
    process.env[NEW_KEY] = 'new-value';
    expect(resolveAliasedRaw(NEW_KEY, OLD_KEY)).toBe('new-value');
  });

  it('returns the prior key value when only KAIROS_* is set (backward compat)', () => {
    process.env[OLD_KEY] = 'prior-value';
    expect(resolveAliasedRaw(NEW_KEY, OLD_KEY)).toBe('prior-value');
  });

  it('SQUADRULES_* takes precedence when BOTH are defined', () => {
    process.env[NEW_KEY] = 'new-wins';
    process.env[OLD_KEY] = 'prior-loses';
    expect(resolveAliasedRaw(NEW_KEY, OLD_KEY)).toBe('new-wins');
  });

  it('empty string SQUADRULES_X="" counts as defined and shadows KAIROS_X', () => {
    process.env[NEW_KEY] = '';
    process.env[OLD_KEY] = 'prior-value';
    expect(resolveAliasedRaw(NEW_KEY, OLD_KEY)).toBe('');
  });

  it('records prior key usage for deprecation when only KAIROS_* supplies the value', () => {
    process.env[OLD_KEY] = 'prior-value';
    resolveAliasedRaw(NEW_KEY, OLD_KEY);
    logDeprecations();
    expect(stderrSpy).toHaveBeenCalled();
    const output = String(stderrSpy.mock.calls[0]?.[0]);
    expect(output).toContain(OLD_KEY);
    expect(output).toContain('DEPRECATION');
  });

  it('does NOT record the prior key when SQUADRULES_* shadows it', () => {
    process.env[NEW_KEY] = 'new-value';
    process.env[OLD_KEY] = 'prior-value';
    resolveAliasedRaw(NEW_KEY, OLD_KEY);
    logDeprecations();
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getEnvAliased (string variant)
// ---------------------------------------------------------------------------

describe('getEnvAliased', () => {
  it('returns default when neither key is set', () => {
    expect(getEnvAliased(NEW_KEY, OLD_KEY, 'fallback')).toBe('fallback');
  });

  it('returns SQUADRULES_* value when set', () => {
    process.env[NEW_KEY] = 'from-new';
    expect(getEnvAliased(NEW_KEY, OLD_KEY, 'fallback')).toBe('from-new');
  });

  it('returns KAIROS_* value when only the prior key is set', () => {
    process.env[OLD_KEY] = 'from-prior';
    expect(getEnvAliased(NEW_KEY, OLD_KEY, 'fallback')).toBe('from-prior');
  });

  it('SQUADRULES_* wins over KAIROS_* when both set', () => {
    process.env[NEW_KEY] = 'new';
    process.env[OLD_KEY] = 'old';
    expect(getEnvAliased(NEW_KEY, OLD_KEY, 'fallback')).toBe('new');
  });

  it('empty SQUADRULES_* falls through to default (string || semantics)', () => {
    process.env[NEW_KEY] = '';
    process.env[OLD_KEY] = 'prior';
    // Empty string shadows the prior value, but || default kicks in
    expect(getEnvAliased(NEW_KEY, OLD_KEY, 'fallback')).toBe('fallback');
  });
});

// ---------------------------------------------------------------------------
// getEnvIntAliased
// ---------------------------------------------------------------------------

describe('getEnvIntAliased', () => {
  it('returns default when neither key is set', () => {
    expect(getEnvIntAliased(NEW_KEY, OLD_KEY, 42)).toBe(42);
  });

  it('parses SQUADRULES_* int value', () => {
    process.env[NEW_KEY] = '100';
    expect(getEnvIntAliased(NEW_KEY, OLD_KEY, 42)).toBe(100);
  });

  it('parses KAIROS_* int value when only the prior key is set', () => {
    process.env[OLD_KEY] = '200';
    expect(getEnvIntAliased(NEW_KEY, OLD_KEY, 42)).toBe(200);
  });

  it('int 0 from SQUADRULES_* is NOT falsy — wins over the prior value', () => {
    process.env[NEW_KEY] = '0';
    process.env[OLD_KEY] = '999';
    expect(getEnvIntAliased(NEW_KEY, OLD_KEY, 42)).toBe(0);
  });

  it('int 0 from KAIROS_* is used when SQUADRULES_* is unset', () => {
    process.env[OLD_KEY] = '0';
    expect(getEnvIntAliased(NEW_KEY, OLD_KEY, 42)).toBe(0);
  });

  it('returns default for NaN parse', () => {
    process.env[NEW_KEY] = 'not-a-number';
    expect(getEnvIntAliased(NEW_KEY, OLD_KEY, 42)).toBe(42);
  });

  it('SQUADRULES_* wins over KAIROS_* when both set', () => {
    process.env[NEW_KEY] = '7';
    process.env[OLD_KEY] = '8';
    expect(getEnvIntAliased(NEW_KEY, OLD_KEY, 42)).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// getEnvFloatAliased
// ---------------------------------------------------------------------------

describe('getEnvFloatAliased', () => {
  it('returns default when neither key is set', () => {
    expect(getEnvFloatAliased(NEW_KEY, OLD_KEY, 1.5)).toBe(1.5);
  });

  it('parses SQUADRULES_* float value', () => {
    process.env[NEW_KEY] = '3.14';
    expect(getEnvFloatAliased(NEW_KEY, OLD_KEY, 1.5)).toBeCloseTo(3.14);
  });

  it('parses KAIROS_* float value when only the prior key is set', () => {
    process.env[OLD_KEY] = '2.71';
    expect(getEnvFloatAliased(NEW_KEY, OLD_KEY, 1.5)).toBeCloseTo(2.71);
  });

  it('float 0.0 from SQUADRULES_* is NOT falsy — wins over the prior value', () => {
    process.env[NEW_KEY] = '0.0';
    process.env[OLD_KEY] = '9.9';
    expect(getEnvFloatAliased(NEW_KEY, OLD_KEY, 1.5)).toBe(0);
  });

  it('returns default for NaN parse', () => {
    process.env[NEW_KEY] = 'abc';
    expect(getEnvFloatAliased(NEW_KEY, OLD_KEY, 1.5)).toBe(1.5);
  });

  it('SQUADRULES_* wins over KAIROS_* when both set', () => {
    process.env[NEW_KEY] = '1.1';
    process.env[OLD_KEY] = '2.2';
    expect(getEnvFloatAliased(NEW_KEY, OLD_KEY, 0)).toBeCloseTo(1.1);
  });
});

// ---------------------------------------------------------------------------
// getEnvBooleanAliased
// ---------------------------------------------------------------------------

describe('getEnvBooleanAliased', () => {
  it('returns default when neither key is set', () => {
    expect(getEnvBooleanAliased(NEW_KEY, OLD_KEY, true)).toBe(true);
    expect(getEnvBooleanAliased(NEW_KEY, OLD_KEY, false)).toBe(false);
  });

  it('parses truthy tokens from SQUADRULES_*', () => {
    for (const val of ['true', '1', 'yes', 'y', 'TRUE', 'Yes']) {
      process.env[NEW_KEY] = val;
      expect(getEnvBooleanAliased(NEW_KEY, OLD_KEY, false)).toBe(true);
    }
  });

  it('parses falsy tokens from SQUADRULES_*', () => {
    for (const val of ['false', '0', 'no', 'n', 'FALSE', 'No']) {
      process.env[NEW_KEY] = val;
      expect(getEnvBooleanAliased(NEW_KEY, OLD_KEY, true)).toBe(false);
    }
  });

  it('bool false from SQUADRULES_* is NOT falsy — wins over prior true', () => {
    process.env[NEW_KEY] = 'false';
    process.env[OLD_KEY] = 'true';
    expect(getEnvBooleanAliased(NEW_KEY, OLD_KEY, true)).toBe(false);
  });

  it('bool "0" from SQUADRULES_* wins over prior "1"', () => {
    process.env[NEW_KEY] = '0';
    process.env[OLD_KEY] = '1';
    expect(getEnvBooleanAliased(NEW_KEY, OLD_KEY, true)).toBe(false);
  });

  it('parses KAIROS_* boolean when only the prior key is set', () => {
    process.env[OLD_KEY] = 'true';
    expect(getEnvBooleanAliased(NEW_KEY, OLD_KEY, false)).toBe(true);
  });

  it('returns default for unrecognized token', () => {
    process.env[NEW_KEY] = 'maybe';
    expect(getEnvBooleanAliased(NEW_KEY, OLD_KEY, true)).toBe(true);
  });

  it('SQUADRULES_* wins over KAIROS_* when both set', () => {
    process.env[NEW_KEY] = 'no';
    process.env[OLD_KEY] = 'yes';
    expect(getEnvBooleanAliased(NEW_KEY, OLD_KEY, true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// logDeprecations
// ---------------------------------------------------------------------------

describe('logDeprecations', () => {
  it('emits nothing when no prior keys were used', () => {
    process.env[NEW_KEY] = 'new';
    getEnvAliased(NEW_KEY, OLD_KEY, 'default');
    logDeprecations();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('emits a single consolidated notice listing all prior keys used', () => {
    process.env['KAIROS_ALPHA'] = 'a';
    process.env['KAIROS_BETA'] = 'b';
    getEnvAliased('SQUADRULES_ALPHA', 'KAIROS_ALPHA', '');
    getEnvAliased('SQUADRULES_BETA', 'KAIROS_BETA', '');
    logDeprecations();
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const output = String(stderrSpy.mock.calls[0]?.[0]);
    expect(output).toContain('KAIROS_ALPHA');
    expect(output).toContain('KAIROS_BETA');
    expect(output).toContain('SQUADRULES_ALPHA');
    expect(output).toContain('SQUADRULES_BETA');
    expect(output).toContain('DEPRECATION');
    // cleanup
    delete process.env['KAIROS_ALPHA'];
    delete process.env['KAIROS_BETA'];
  });

  it('is idempotent — second call emits nothing', () => {
    process.env[OLD_KEY] = 'prior';
    getEnvAliased(NEW_KEY, OLD_KEY, '');
    logDeprecations();
    logDeprecations();
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it('writes to stderr, never stdout', () => {
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    process.env[OLD_KEY] = 'prior';
    getEnvAliased(NEW_KEY, OLD_KEY, '');
    logDeprecations();
    expect(stderrSpy).toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
    stdoutSpy.mockRestore();
  });
});
