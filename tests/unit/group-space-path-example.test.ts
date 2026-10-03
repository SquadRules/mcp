import { deriveGroupSpacePathExampleFromAllowlist } from '../../src/config.js';

describe('deriveGroupSpacePathExampleFromAllowlist', () => {
  test('uses first path-prefix entry with suffix', () => {
    expect(deriveGroupSpacePathExampleFromAllowlist(['/shared/', '/other/'], 'pe-team')).toBe(
      '/shared/pe-team'
    );
  });

  test('returns null when no prefix entry', () => {
    expect(deriveGroupSpacePathExampleFromAllowlist(['squadrules-auditor', '/exact-path'], 'x')).toBeNull();
  });

  test('strips trailing slashes on prefix', () => {
    expect(deriveGroupSpacePathExampleFromAllowlist(['/shared///'], 'a')).toBe('/shared/a');
  });
});
