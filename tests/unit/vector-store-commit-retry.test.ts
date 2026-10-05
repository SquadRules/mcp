/**
 * Unit tests for the embedded vector-store commit-retry helper.
 * Pure logic: no LanceDB, no network, no infrastructure.
 */
import { isCommitConflictError, withCommitRetry } from '../../src/services/vector-store/commit-retry.js';

describe('isCommitConflictError', () => {
  it('detects conflict-shaped messages (retryable)', () => {
    expect(isCommitConflictError(new Error('Commit conflict: version 42 already committed'))).toBe(true);
    expect(isCommitConflictError(new Error('version conflict during transaction commit'))).toBe(true);
    expect(isCommitConflictError('compare-and-swap failed')).toBe(true);
    expect(isCommitConflictError('stale CAS lease')).toBe(true);
  });

  it('does not treat ordinary errors as conflicts', () => {
    expect(isCommitConflictError(new Error('invalid argument: bad column type'))).toBe(false);
    expect(isCommitConflictError(new Error('ENOENT: no such file or directory'))).toBe(false);
    expect(isCommitConflictError(new Error(''))).toBe(false);
  });
});

describe('withCommitRetry', () => {
  const fast = { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 2 };

  it('returns the result on first success', async () => {
    const write = jest.fn().mockResolvedValue('ok');
    await expect(withCommitRetry(write, 'op', fast)).resolves.toBe('ok');
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('retries only conflict errors, then succeeds', async () => {
    const write = jest
      .fn()
      .mockRejectedValueOnce(new Error('commit conflict'))
      .mockRejectedValueOnce(new Error('version conflict'))
      .mockResolvedValue('done');
    await expect(withCommitRetry(write, 'op', fast)).resolves.toBe('done');
    expect(write).toHaveBeenCalledTimes(3);
  });

  it('throws immediately on a non-conflict error', async () => {
    const write = jest.fn().mockRejectedValue(new Error('schema mismatch'));
    await expect(withCommitRetry(write, 'op', fast)).rejects.toThrow('schema mismatch');
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('gives up and rethrows the last conflict after exhausting attempts', async () => {
    const write = jest.fn().mockRejectedValue(new Error('commit conflict'));
    await expect(withCommitRetry(write, 'op', fast)).rejects.toThrow('commit conflict');
    expect(write).toHaveBeenCalledTimes(fast.maxAttempts);
  });
});
