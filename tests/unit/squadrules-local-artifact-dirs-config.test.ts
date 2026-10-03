import { describe, expect, it } from '@jest/globals';
import { parseLocalArtifactDirHints } from '../../src/config.js';

describe('parseLocalArtifactDirHints', () => {
  it('parses the canonical default to the ordered hint pair', () => {
    expect(parseLocalArtifactDirHints('project://.local/squadrules/work,user://.config/squadrules/work')).toEqual([
      'project://.local/squadrules/work',
      'user://.config/squadrules/work'
    ]);
  });

  it('preserves order (preferred first)', () => {
    expect(parseLocalArtifactDirHints('user://.config/squadrules/work,project://.local/squadrules/work')).toEqual([
      'user://.config/squadrules/work',
      'project://.local/squadrules/work'
    ]);
  });

  it('trims whitespace and ignores empty segments', () => {
    expect(parseLocalArtifactDirHints('  project://.local/squadrules/work , , user://x ')).toEqual([
      'project://.local/squadrules/work',
      'user://x'
    ]);
  });

  it('accepts a single hint', () => {
    expect(parseLocalArtifactDirHints('project://.local/squadrules/work')).toEqual([
      'project://.local/squadrules/work'
    ]);
  });

  it('rejects an empty list', () => {
    expect(() => parseLocalArtifactDirHints('')).toThrow(/at least one hint/);
    expect(() => parseLocalArtifactDirHints('  ,  , ')).toThrow(/at least one hint/);
  });

  it('rejects unknown URI schemes', () => {
    expect(() => parseLocalArtifactDirHints('repo://.local/squadrules/work')).toThrow(/Invalid scheme/);
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
    const hints = parseLocalArtifactDirHints('project://.local/squadrules/work');
    expect(Object.isFrozen(hints)).toBe(true);
  });

  it('refuses to leak server-side absolute paths regardless of input', () => {
    // Regression guard for the original bug: server emitted /app/node_modules/... in Docker.
    // Hints must always be relative under a known scheme; absolute filesystem paths must be rejected.
    expect(() =>
      parseLocalArtifactDirHints('project:///app/node_modules/@squadrules/mcp/.local/squadrules/work')
    ).toThrow(/safe relative path/);
  });
});
