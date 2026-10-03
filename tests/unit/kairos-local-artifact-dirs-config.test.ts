// squadrules-compat-surface: references the existing on-disk config-dir path segment "kairos" (fallback location for stored work/artifacts)
import { describe, expect, it } from '@jest/globals';
import { parseLocalArtifactDirHints } from '../../src/config.js';

describe('parseLocalArtifactDirHints', () => {
  it('parses the canonical default to the ordered hint pair', () => {
    expect(parseLocalArtifactDirHints('project://.local/kairos/work,user://.config/kairos/work')).toEqual([
      'project://.local/kairos/work',
      'user://.config/kairos/work'
    ]);
  });

  it('preserves order (preferred first)', () => {
    expect(parseLocalArtifactDirHints('user://.config/kairos/work,project://.local/kairos/work')).toEqual([
      'user://.config/kairos/work',
      'project://.local/kairos/work'
    ]);
  });

  it('trims whitespace and ignores empty segments', () => {
    expect(parseLocalArtifactDirHints('  project://.local/kairos/work , , user://x ')).toEqual([
      'project://.local/kairos/work',
      'user://x'
    ]);
  });

  it('accepts a single hint', () => {
    expect(parseLocalArtifactDirHints('project://.local/kairos/work')).toEqual([
      'project://.local/kairos/work'
    ]);
  });

  it('rejects an empty list', () => {
    expect(() => parseLocalArtifactDirHints('')).toThrow(/at least one hint/);
    expect(() => parseLocalArtifactDirHints('  ,  , ')).toThrow(/at least one hint/);
  });

  it('rejects unknown URI schemes', () => {
    expect(() => parseLocalArtifactDirHints('repo://.local/kairos/work')).toThrow(/Invalid scheme/);
    expect(() => parseLocalArtifactDirHints('/abs/path')).toThrow(/Invalid scheme/);
    expect(() => parseLocalArtifactDirHints('project:/missing-slash')).toThrow(/Invalid scheme/);
  });

  it('rejects absolute relpaths inside a scheme', () => {
    expect(() => parseLocalArtifactDirHints('project:///etc/passwd')).toThrow(/safe relative path/);
    expect(() => parseLocalArtifactDirHints('user:///root')).toThrow(/safe relative path/);
  });

  it('rejects ".." traversal segments', () => {
    expect(() => parseLocalArtifactDirHints('project://../escape')).toThrow(/\.\./);
    expect(() => parseLocalArtifactDirHints('user://safe/../bad')).toThrow(/\.\./);
  });

  it('returns a frozen array', () => {
    const hints = parseLocalArtifactDirHints('project://.local/kairos/work');
    expect(Object.isFrozen(hints)).toBe(true);
  });

  it('refuses to leak server-side absolute paths regardless of input', () => {
    // Regression guard for the original bug: server emitted /app/node_modules/... in Docker.
    // Hints must always be relative under a known scheme; absolute filesystem paths must be rejected.
    expect(() =>
      parseLocalArtifactDirHints('project:///app/node_modules/@squadrules/mcp/.local/kairos/work')
    ).toThrow(/safe relative path/);
  });
});
