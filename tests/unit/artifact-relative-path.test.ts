import { describe, expect, it } from '@jest/globals';
import {
  normalizeArtifactRelativePath,
  normalizeMaterializeRelativePath,
  sanitizeArtifactFileName
} from '../../src/tools/artifact-relative-path.js';

describe('normalizeArtifactRelativePath', () => {
  it('accepts a simple nested path', () => {
    expect(normalizeArtifactRelativePath('scripts/hello.py')).toBe('scripts/hello.py');
  });

  it('strips leading ./ segments', () => {
    expect(normalizeArtifactRelativePath('./conf/app.toml')).toBe('conf/app.toml');
    expect(normalizeArtifactRelativePath('././notes.txt')).toBe('notes.txt');
  });

  it('normalizes backslashes to slashes', () => {
    expect(normalizeArtifactRelativePath('scripts\\hello.py')).toBe('scripts/hello.py');
  });

  it('trims outer whitespace', () => {
    expect(normalizeArtifactRelativePath('  conf/routes.yaml  ')).toBe('conf/routes.yaml');
  });

  it('rejects empty and slash-only paths', () => {
    expect(normalizeArtifactRelativePath('')).toBeNull();
    expect(normalizeArtifactRelativePath('   ')).toBeNull();
    expect(normalizeArtifactRelativePath('/abs')).toBeNull();
    expect(normalizeArtifactRelativePath('a//b')).toBeNull();
    expect(normalizeArtifactRelativePath('a/')).toBeNull();
  });

  it('rejects .. segments', () => {
    expect(normalizeArtifactRelativePath('../etc/passwd')).toBeNull();
    expect(normalizeArtifactRelativePath('scripts/../../../etc')).toBeNull();
    expect(normalizeArtifactRelativePath('ok/../bad')).toBeNull();
  });

  it('rejects overlong paths', () => {
    const long = `${'a/'.repeat(1025)}b`;
    expect(normalizeArtifactRelativePath(long)).toBeNull();
  });
});

describe('normalizeMaterializeRelativePath', () => {
  it('accepts shell-safe paths the base canonicalizer accepts', () => {
    expect(normalizeMaterializeRelativePath('scripts/hello.py')).toBe('scripts/hello.py');
    expect(normalizeMaterializeRelativePath('./conf/app.toml')).toBe('conf/app.toml');
    expect(normalizeMaterializeRelativePath('  conf/routes.yaml  ')).toBe('conf/routes.yaml');
  });

  it('allows spaces and ordinary filename characters', () => {
    expect(normalizeMaterializeRelativePath('my dir/gate script.py')).toBe('my dir/gate script.py');
  });

  it('rejects shell metacharacters the base canonicalizer would allow', () => {
    expect(normalizeMaterializeRelativePath('scripts\\hello.py')).toBeNull();
    expect(normalizeMaterializeRelativePath('artifacts/x$y.py')).toBeNull();
    expect(normalizeMaterializeRelativePath('artifacts/x`y.py')).toBeNull();
    expect(normalizeMaterializeRelativePath('artifacts/quo"te.py')).toBeNull();
    expect(normalizeMaterializeRelativePath("artifacts/quo'te.py")).toBeNull();
    expect(normalizeMaterializeRelativePath('artifacts/new\nline.py')).toBeNull();
    expect(normalizeMaterializeRelativePath('artifacts/del\x7f.py')).toBeNull();
  });

  it('rejects an ambiguous interior . segment', () => {
    expect(normalizeMaterializeRelativePath('a/./b')).toBeNull();
  });

  it('still rejects traversal, absolute, empty, and overlong paths', () => {
    expect(normalizeMaterializeRelativePath('../etc/passwd')).toBeNull();
    expect(normalizeMaterializeRelativePath('/abs')).toBeNull();
    expect(normalizeMaterializeRelativePath('')).toBeNull();
    expect(normalizeMaterializeRelativePath(`${'a/'.repeat(1025)}b`)).toBeNull();
  });
});

describe('sanitizeArtifactFileName', () => {
  it('keeps an already-safe name', () => {
    expect(sanitizeArtifactFileName('helper.py')).toBe('helper.py');
  });

  it('replaces disallowed characters with underscores', () => {
    expect(sanitizeArtifactFileName('my script.py')).toBe('my_script.py');
    expect(sanitizeArtifactFileName('a/b.py')).toBe('a_b.py');
    expect(sanitizeArtifactFileName('gate$.py')).toBe('gate_.py');
    expect(sanitizeArtifactFileName('naïve.py')).toBe('na_ve.py');
  });

  it('returns null for an empty, dot, or dot-dot result', () => {
    expect(sanitizeArtifactFileName('')).toBeNull();
    expect(sanitizeArtifactFileName('   ')).toBeNull();
    expect(sanitizeArtifactFileName('.')).toBeNull();
    expect(sanitizeArtifactFileName('..')).toBeNull();
  });

  it('keeps a longer run of dots that is not . or ..', () => {
    expect(sanitizeArtifactFileName('...')).toBe('...');
  });
});
