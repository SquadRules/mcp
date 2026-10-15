/**
 * Redirect tombstone filtering in activate/search results (#70).
 *
 * Verifies that redirect tombstones (ADR 0012) are identified correctly
 * and would be excluded from activate/search match choices.
 */
import { isRedirectTombstone, REDIRECT_TOMBSTONE_SLUGS } from '../../src/utils/adapter-alias.js';

describe('redirect tombstone detection', () => {
  it('identifies known tombstone slugs', () => {
    expect(isRedirectTombstone('create-new-protocol')).toBe(true);
    expect(isRedirectTombstone('phase-critic')).toBe(true);
    expect(isRedirectTombstone('phase-critic-guide')).toBe(true);
  });

  it('does not flag real adapter slugs', () => {
    expect(isRedirectTombstone('author-adapter')).toBe(false);
    expect(isRedirectTombstone('critic-loop')).toBe(false);
    expect(isRedirectTombstone('critic-loop-guide')).toBe(false);
    expect(isRedirectTombstone('git-commit-protocol')).toBe(false);
    expect(isRedirectTombstone('refine-search')).toBe(false);
  });

  it('does not flag unknown slugs', () => {
    expect(isRedirectTombstone('my-custom-adapter')).toBe(false);
    expect(isRedirectTombstone('')).toBe(false);
  });

  it('exposes the tombstone set for external iteration', () => {
    expect(REDIRECT_TOMBSTONE_SLUGS.size).toBe(3);
    expect([...REDIRECT_TOMBSTONE_SLUGS]).toEqual(
      expect.arrayContaining(['create-new-protocol', 'phase-critic', 'phase-critic-guide'])
    );
  });
});
