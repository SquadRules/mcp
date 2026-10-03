/**
 * Regression for the undiagnosable "fetch failed" bug (issue #638).
 *
 * undici surfaces network failures as `TypeError: fetch failed` and stores the real reason on
 * `err.cause`. Previously ApiClient logged and threw only `err.message` ("fetch failed"), so the
 * user got zero actionable detail. These tests assert the retry log and the final thrown error
 * now include the underlying cause (e.g. ECONNREFUSED) plus a reachability hint — message-only,
 * with retry behavior unchanged.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../src/cli/config-file.js', () => ({
  readConfig: async () => ({}),
  getDefaultApiUrlFromFile: () => undefined,
  writeConfig: async () => {},
}));

jest.unstable_mockModule('../../src/cli/commands/login.js', () => ({
  loginWithBrowser: async () => false,
}));

const { ApiClient } = await import('../../src/cli/api-client.js');

const BASE_URL = 'http://127.0.0.1:9';

function fetchFailed(): TypeError {
  const err = new TypeError('fetch failed');
  (err as { cause?: unknown }).cause = Object.assign(
    new Error('connect ECONNREFUSED 127.0.0.1:9'),
    { code: 'ECONNREFUSED' },
  );
  return err;
}

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('ApiClient fetch-error diagnostics', () => {
  it('final thrown error includes err.cause detail and a reachability hint', async () => {
    globalThis.fetch = jest.fn(async () => { throw fetchFailed(); }) as never;
    const client = new ApiClient({ baseUrl: BASE_URL, openInBrowser: false, maxRetries: 0 });

    const err = await client.activate('q').catch((e) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/ECONNREFUSED/);
    expect(err.message).toMatch(/Verify the server is reachable/);
  });

  it('retry log includes the underlying cause, not just "fetch failed"', async () => {
    jest.useFakeTimers();
    const writes: string[] = [];
    jest.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as never);
    const fetchMock = jest.fn(async () => { throw fetchFailed(); });
    globalThis.fetch = fetchMock as never;

    const client = new ApiClient({ baseUrl: BASE_URL, openInBrowser: false, maxRetries: 1 });
    const pending = client.activate('q').catch((e) => e as Error);
    await jest.runAllTimersAsync();
    const err = await pending;

    // Retry behavior unchanged: 1 initial + 1 retry = 2 fetch attempts.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(writes.join('')).toMatch(/\[squadrules\] retry 1\/1:.*fetch failed \(ECONNREFUSED/);
    expect(err.message).toMatch(/ECONNREFUSED/);
  });
});
