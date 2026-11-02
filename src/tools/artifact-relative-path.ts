/**
 * Skill-root-relative paths for trained artifacts (train input + Qdrant payload).
 * Used for export layout preservation and validation (no path traversal).
 */

/** Normalize and validate a skill-root-relative path. Returns null if invalid. */
export function normalizeArtifactRelativePath(raw: string): string | null {
  let s = raw.trim().replace(/\\/g, '/');
  while (s.startsWith('./')) {
    s = s.slice(2);
  }
  if (s.startsWith('/')) {
    return null;
  }
  const segments = s.split('/');
  for (const seg of segments) {
    if (seg === '..') return null;
    if (seg === '') return null;
  }
  if (!s || s.endsWith('/')) {
    return null;
  }
  if (s.length > 2048) {
    return null;
  }
  return s;
}

/**
 * Shell metacharacters that must never appear in a materialize destination path
 * (ADR 0040): double quote, single quote, backtick, dollar sign, backslash, and
 * control / DEL bytes (including newline). Spaces and ordinary filename
 * characters stay allowed; {@link normalizeArtifactRelativePath} already rejects
 * `..`, absolute paths, empty segments, and over-long paths.
 */
const MATERIALIZE_FORBIDDEN_RE = /["'`$\\\u0000-\u001f\u007f]/;

/** Characters allowed in a synthesized artifact filename segment. */
const FILENAME_DISALLOWED_RE = /[^A-Za-z0-9._-]/g;

/**
 * Canonicalize and validate a skill-root-relative path destined for the
 * materialize command. Stricter than {@link normalizeArtifactRelativePath}, which
 * is shared with the ZIP export layout: this also rejects shell metacharacters and
 * ambiguous interior `.` segments, because the result is embedded in a shell
 * command and resolved against an absolute filesystem root. Returns null if
 * invalid; the caller must fail closed rather than substitute a default.
 */
export function normalizeMaterializeRelativePath(raw: string): string | null {
  if (MATERIALIZE_FORBIDDEN_RE.test(raw)) {
    return null;
  }
  const normalized = normalizeArtifactRelativePath(raw);
  if (normalized === null) {
    return null;
  }
  for (const segment of normalized.split('/')) {
    if (segment === '.') {
      return null;
    }
  }
  // Defense in depth: the base canonicalizer maps `\` to `/`, so re-check the
  // normalized result for metacharacters that must never reach the shell.
  if (MATERIALIZE_FORBIDDEN_RE.test(normalized)) {
    return null;
  }
  return normalized;
}

/**
 * Reduce an arbitrary artifact name to a conservative, shell-safe single filename
 * segment for a synthesized materialize path. Disallowed characters become `_`;
 * an empty, `.`, or `..` result is ambiguous and returns null so the caller fails
 * the load instead of inventing an unsafe destination.
 */
export function sanitizeArtifactFileName(name: string): string | null {
  const candidate = name.trim().replace(FILENAME_DISALLOWED_RE, '_');
  if (candidate.length === 0 || candidate === '.' || candidate === '..') {
    return null;
  }
  return candidate;
}
