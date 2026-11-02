/**
 * Build the materialize instruction for one adapter-linked artifact (ADR 0040).
 *
 * Byte-exactness is framework work, not agent work: the instruction carries an
 * exact shell line (`cmd`) that downloads the artifact from a transport-neutral
 * URL, verifies its digest, marks it `0700`, and publishes it atomically, so the
 * agent never re-types artifact bytes through an editor or a heredoc
 * (SquadRules/mcp#231). The URL is a `file://` cache path on stdio and a
 * short-lived capability URL on HTTP; this builder does not branch on transport
 * because `curl` fetches both. The destination tree is caller-owned and trusted:
 * a POSIX shell alone cannot close time-of-check/time-of-use races against a
 * hostile concurrent writer, so `cmd` rejects symlinked roots/ancestors and
 * re-checks containment after resolution, but does not claim race-free isolation.
 */

import { normalizeMaterializeRelativePath } from './artifact-relative-path.js';

export const SQUADRULES_LOCAL_ARTIFACT_DIR_ENV = 'SQUADRULES_LOCAL_ARTIFACT_DIR';

const SHA256_RE = /^[a-f0-9]{64}$/i;
const URL_SCHEME_RE = /^(?:https?|file):\/\//i;

export interface ArtifactMaterializeInput {
  /** Transport-neutral source URL `cmd` curls: a `file://` cache path (stdio) or an `http(s)://` capability URL (HTTP). */
  url: string;
  /** Skill-root-relative artifact path; the payload lands here under the artifact dir. */
  relativePath: string;
  /** SHA-256 hex of the stored artifact bytes; `cmd` verifies the download against it. */
  sha256: string;
}

export interface MaterializeInstruction {
  /** Always `url`: the bytes are fetched from `url` by `cmd` on every transport. */
  method: 'url';
  /** Source URL `cmd` downloads (a `file://` cache path on stdio, a capability URL on HTTP). */
  url: string;
  /** Absolute path where the bytes land (uses $SQUADRULES_LOCAL_ARTIFACT_DIR). */
  out: string;
  /** SHA-256 digest `cmd` verifies; check it against the same value. */
  sha256: string;
  /** File permissions `cmd` sets on the verified bytes before publishing. */
  chmod: '700';
  /** Exact POSIX shell line that downloads, verifies, chmods, and atomically publishes. Run it verbatim. */
  cmd: string;
}

/**
 * Wrap a value in single quotes for safe interpolation into a POSIX shell
 * command. Every embedded `'` becomes the four-character sequence `'\''`, which
 * closes the quoted string, adds an escaped quote, and reopens it. Single quotes
 * suppress `$`, backtick, glob, and word-splitting expansion, so any URL — even
 * one carrying adversarial characters — reaches `curl` as a literal argument.
 */
export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildArtifactMaterializeInstruction(input: ArtifactMaterializeInput): MaterializeInstruction {
  const relativePath = normalizeMaterializeRelativePath(input.relativePath);
  if (relativePath === null) {
    throw new Error(
      `refusing to build a materialize command for an unsafe artifact relative_path: ${JSON.stringify(input.relativePath)}`
    );
  }
  if (!SHA256_RE.test(input.sha256)) {
    throw new Error(`refusing to build a materialize command without a valid SHA-256 for ${relativePath}`);
  }
  if (!URL_SCHEME_RE.test(input.url)) {
    throw new Error(
      `refusing to build a materialize command for a URL scheme that is not http(s) or file: ${JSON.stringify(input.url)}`
    );
  }

  const envName = SQUADRULES_LOCAL_ARTIFACT_DIR_ENV;
  const sha256 = input.sha256.toLowerCase();
  const out = `$${envName}/${relativePath}`;

  // Reject a symlinked root, every existing destination ancestor, and the final
  // destination before anything is created or written.
  const segments = relativePath.split('/');
  const symlinkGuards: string[] = ['[ ! -L "$dir" ]'];
  for (let i = 1; i <= segments.length; i += 1) {
    symlinkGuards.push(`[ ! -L "$dir/${segments.slice(0, i).join('/')}" ]`);
  }

  const cmd = [
    // Fail closed unless the artifact dir is set, non-empty, and absolute.
    `dir="\${${envName}:?${envName} must be set to an absolute artifact directory}"`,
    `case "$dir" in /*) ;; *) printf '%s\\n' '${envName} must be an absolute path' >&2; exit 1 ;; esac`,
    ...symlinkGuards,
    `out="$dir/${relativePath}"`,
    `parent="$(dirname "$out")"`,
    `mkdir -p "$parent"`,
    // The resolved parent must stay inside the resolved root, not merely lack `../`.
    `root_phys="$(cd "$dir" && pwd -P)"`,
    `parent_phys="$(cd "$parent" && pwd -P)"`,
    `case "$parent_phys" in "$root_phys" | "$root_phys"/*) ;; *) printf '%s\\n' 'resolved destination escapes the artifact root' >&2; exit 1 ;; esac`,
    // Download into a fresh private temp file in the destination directory so the
    // final rename is atomic on one filesystem.
    `staging="$(mktemp "$parent/.squadrules-materialize.XXXXXX")"`,
    `trap 'rm -f "$staging"' EXIT INT TERM HUP`,
    `curl -fsS -o "$staging" ${shellSingleQuote(input.url)}`,
    // Portable digest chain with no platform assumption baked in.
    `{ if command -v sha256sum >/dev/null 2>&1; then digest="$(sha256sum "$staging" | cut -d' ' -f1)"; ` +
      `elif command -v shasum >/dev/null 2>&1; then digest="$(shasum -a 256 "$staging" | cut -d' ' -f1)"; ` +
      `elif command -v openssl >/dev/null 2>&1; then digest="$(openssl dgst -sha256 "$staging" | sed 's/^.*= //')"; ` +
      `else printf '%s\\n' 'no sha256 tool (need sha256sum, shasum, or openssl) on PATH' >&2; exit 1; fi; }`,
    `[ "$digest" = '${sha256}' ]`,
    // Only a verified file is chmod'd and published; a prior destination survives any earlier failure.
    `chmod 700 "$staging"`,
    `mv -f "$staging" "$out"`,
    `trap - EXIT INT TERM HUP`
  ].join(' && ');

  return { method: 'url', url: input.url, out, sha256, chmod: '700', cmd };
}
