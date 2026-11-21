import { describe, expect, test } from '@jest/globals';
import {
  isTransientModelDownloadError,
  withModelDownloadRetries,
} from '../../src/services/embedding/transformers-retry.js';

describe('Transformers model-download retries', () => {
  test('recognizes nested connection failures and recoverable HTTP statuses', () => {
    expect(isTransientModelDownloadError(new Error('fetch failed', { cause: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }) }))).toBe(true);
    expect(isTransientModelDownloadError({ errors: [{ code: 'ENETUNREACH' }] })).toBe(true);
    expect(isTransientModelDownloadError({ status: 429 })).toBe(true);
    expect(isTransientModelDownloadError({ status: 503 })).toBe(true);
  });

  test('does not classify wrong model, revision, auth, or local failures as transient', () => {
    for (const error of [{ status: 404 }, { status: 401 }, { status: 403 },
      new Error('Unknown model revision'), new TypeError('A float32 tensor must be Float32Array')]) {
      expect(isTransientModelDownloadError(error)).toBe(false);
    }
  });

  test('retries temporary failures with bounded exponential backoff', async () => {
    let attempts = 0;
    const delays: number[] = [];
    const result = await withModelDownloadRetries(async () => {
      attempts++;
      if (attempts < 3) throw Object.assign(new Error('temporarily unavailable'), { code: 'ETIMEDOUT' });
      return 'ready';
    }, { offline: false, sleep: async (ms) => { delays.push(ms); } });
    expect(result).toBe('ready');
    expect(attempts).toBe(3);
    expect(delays).toEqual([1000, 2000]);
  });

  test('offline fails immediately even for transient errors', async () => {
    let attempts = 0;
    await expect(withModelDownloadRetries(async () => {
      attempts++;
      throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    }, { offline: true, sleep: async () => {} })).rejects.toThrow('timeout');
    expect(attempts).toBe(1);
  });

  test('non-network failures do not retry', async () => {
    let attempts = 0;
    await expect(withModelDownloadRetries(async () => {
      attempts++;
      throw new Error('HTTP 404 missing model');
    }, { offline: false, sleep: async () => {} })).rejects.toThrow('HTTP 404');
    expect(attempts).toBe(1);
  });
});
