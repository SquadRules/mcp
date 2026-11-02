#!/usr/bin/env node
/**
 * Documentation link / DRY linter for SQUADRULES MCP.
 *
 * Enforces the `documentation-authority` rule (.qoder/rules/) mechanically:
 *   (a) dangling relative links in tracked *.md            -> ERROR
 *   (b) links to retired code-derivable docs (docs/architecture/**) -> ERROR
 *   (c) colocated README shape contract (H1 purpose line,
 *       or an explicit `<!-- squadrules-doc-keep: ... -->` marker) -> WARNING
 *   (d) docs/ file whose H1 duplicates a wiki catalog name  -> WARNING (DRY drift)
 *   (e) `npm run <target>` citing a target that is not a key -> ERROR
 *       in package.json#scripts (prevents the #181 reference drift)
 *
 * Rollout is STAGED. By default this runs in report-only mode: it prints every
 * finding but always exits 0, so it can join `npm run lint` + CI without
 * breaking green builds on pre-existing dangling links. Flip enforcement on
 * with `--strict` or `LINT_DOCS_STRICT=1`, which exits non-zero when any
 * ERROR-class finding (a/b/e) exists.
 *
 * Rule (e) reads a wider file set than (a)-(d): `README.md`, `CONTRIBUTING.md`,
 * `docs/**`, `scripts/**` and `compose/**`, because a stale `npm run` citation
 * is just as breaking in a script comment as in prose.
 *
 * Usage: node scripts/lint-docs-links.mjs [--strict]
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict') || process.env.LINT_DOCS_STRICT === '1';

// Paths that are managed/generated and must not be checked or hand-audited.
const SKIP_PREFIXES = [
  '.qoder/repowiki/', // Qoder-owned, prompt-generated
  '.qoder/plans/', // planning scratch
  'node_modules/',
  'dist/',
];

const RETIRED_PREFIXES = ['docs/architecture/'];
const RETIRED_HINT = /(^|\/)architecture\/[\w./-]+\.md/;

function trackedMarkdown() {
  const out = execSync('git ls-files "*.md"', { cwd: ROOT, encoding: 'utf8' });
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((p) => !SKIP_PREFIXES.some((pre) => p.startsWith(pre)))
    // git ls-files reports index entries; skip anything deleted from the tree.
    .filter((p) => existsSync(join(ROOT, p)));
}

/**
 * Blank a leading YAML frontmatter block so its values are not scanned as prose.
 * Frontmatter metadata legitimately looks like markdown: an agent definition may carry
 * `model: "[DeepSeek-Flash](dfmodel)"`, which the link extractor would otherwise report
 * as a dangling relative link. Lines are blanked rather than dropped so later findings
 * keep reporting the true file line number.
 */
function stripFrontmatter(md) {
  const lines = md.split('\n');
  if ((lines[0] ?? '').trim() !== '---') return md;
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (end === -1) return md; // unterminated block: leave the content to the link scan
  for (let i = 0; i <= end; i++) lines[i] = '';
  return lines.join('\n');
}

/** Strip fenced code blocks and inline code so link regex ignores examples. */
function stripCode(md) {
  const lines = md.split('\n');
  let inFence = false;
  let fence = '';
  const kept = [];
  for (const line of lines) {
    const m = line.match(/^\s*(```+|~~~+)/);
    if (m) {
      if (!inFence) {
        inFence = true;
        fence = m[1][0];
      } else if (line.trimStart().startsWith(fence)) {
        inFence = false;
      }
      kept.push(''); // preserve line count
      continue;
    }
    kept.push(inFence ? '' : line.replace(/`[^`]*`/g, ''));
  }
  return kept.join('\n');
}

const LINK_RE = /!?\[[^\]]*\]\(([^)]+)\)/g;

function linkTarget(raw) {
  // Drop an optional "title" and surrounding <>.
  let t = raw.trim();
  if (t.startsWith('<') && t.endsWith('>')) t = t.slice(1, -1);
  t = t.split(/\s+/)[0];
  return t;
}

function isExternalOrAnchor(t) {
  return (
    !t ||
    t.startsWith('#') ||
    t.startsWith('http://') ||
    t.startsWith('https://') ||
    t.startsWith('mailto:') ||
    t.startsWith('tel:') ||
    t.startsWith('data:') ||
    t.includes('{{') // templated example
  );
}

const errors = [];
const warnings = [];

function firstHeading(md) {
  for (const line of md.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('<!--')) continue;
    const m = t.match(/^#\s+(.+?)\s*$/);
    return m ? m[1] : null; // null: first meaningful line was not an H1
  }
  return null;
}

function loadWikiCatalogNames() {
  try {
    const p = join(ROOT, '.qoder/repowiki/en/meta/repowiki-metadata.json');
    const data = JSON.parse(readFileSync(p, 'utf8'));
    const names = (data.wiki_catalogs || [])
      .map((c) => (c && typeof c.name === 'string' ? c.name : null))
      .filter(Boolean)
      .map((n) => n.toLowerCase());
    return new Set(names);
  } catch {
    return new Set();
  }
}

function isColocatedReadme(p) {
  return (
    basename(p).toLowerCase() === 'readme.md' &&
    p !== 'README.md' &&
    !p.startsWith('docs/')
  );
}

// ---------------------------------------------------------------------------
// (e) `npm run <target>` references must exist in package.json#scripts
// ---------------------------------------------------------------------------

/** Target token after `npm run`; stops at spaces, `--` flags and punctuation. */
const NPM_RUN_RE = /npm\s+run\s+([A-Za-z0-9][A-Za-z0-9:_-]*)/g;

/**
 * Prose documenting a removal is correct by definition, so a retired target
 * beside these words is history, not drift. Line-local: it must not mask a file.
 */
const HISTORICAL_PROSE_RE =
  /\b(former|formerly|retired|removed|deleted|renamed|superseded|deprecated|previously|historical|no longer|used to|replaced by)\b/i;

/** Inline escape hatch for any file type; place on the referencing line. */
const KEEP_MARKER = 'squadrules-npm-target-keep';

/**
 * Historical-record paths. `documentation-authority.md` forbids rewriting an
 * accepted ADR body, so flagging a retired target inside one would push an
 * agent to break that rule.
 */
const HISTORY_PREFIXES = ['docs/adr/'];

/** Binaries: not a source of documentation references. */
const NPM_TARGET_SKIP_EXT =
  /\.(png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|pdf|mp4|tgz|gz|zip|wasm|lock)$/i;

function loadNpmScriptNames() {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    return new Set(Object.keys(pkg.scripts || {}));
  } catch {
    return new Set(); // unreadable package.json: skip rule (e) rather than flood findings
  }
}

/**
 * Scope from issue #187: the root contributor docs, all of `docs/`, colocated
 * READMEs under `scripts/`, plus comments in `scripts/` and `compose/` files.
 * Kept narrower than the markdown set so `tests/` headers and vendored wiki
 * pages are not dragged into a documentation gate.
 */
function npmTargetScanFiles() {
  let out = '';
  try {
    out = execFileSync(
      'git',
      ['ls-files', '--', 'README.md', 'CONTRIBUTING.md', 'docs', 'scripts', 'compose'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 << 20 }
    );
  } catch {
    return [];
  }
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((p) => !SKIP_PREFIXES.some((pre) => p.startsWith(pre)))
    .filter((p) => !NPM_TARGET_SKIP_EXT.test(p))
    .filter((p) => existsSync(join(ROOT, p)));
}

/** Best-effort "did you mean", because a bare "does not exist" is not actionable. */
function suggestTargets(target, known) {
  const head = target.split(':')[0];
  const parts = target.split(/[:_-]/);
  const scored = [...known]
    .map((k) => ({
      k,
      score:
        (k === target ? 100 : 0) +
        (k.split(':')[0] === head ? 20 : 0) +
        (k.includes(target) || target.includes(k) ? 10 : 0) +
        k.split(/[:_-]/).filter((s) => parts.includes(s)).length * 4,
    }))
    .filter((c) => c.score >= 8)
    .sort((a, b) => b.score - a.score || a.k.localeCompare(b.k))
    .slice(0, 3)
    .map((c) => c.k);
  return scored.length ? ` — nearest existing target(s): ${scored.join(', ')}` : '';
}

function checkNpmTargetReferences() {
  const known = loadNpmScriptNames();
  const findings = [];
  const scanned = [];

  for (const file of npmTargetScanFiles()) {
    if (HISTORY_PREFIXES.some((pre) => file.startsWith(pre))) continue;
    let text;
    try {
      text = readFileSync(join(ROOT, file), 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\0')) continue; // binary: not a documentation reference source
    scanned.push(file);

    text.split('\n').forEach((line, i) => {
      if (HISTORICAL_PROSE_RE.test(line) || line.includes(KEEP_MARKER)) return;
      NPM_RUN_RE.lastIndex = 0;
      let m;
      while ((m = NPM_RUN_RE.exec(line)) !== null) {
        const target = m[1];
        if (known.has(target)) continue;
        findings.push(
          `${file}:${i + 1}: \`npm run ${target}\` is not a package.json#scripts target${suggestTargets(target, known)}`
        );
      }
    });
  }

  return { findings, scanned: scanned.length };
}

const files = trackedMarkdown();
const wikiNames = loadWikiCatalogNames();

for (const file of files) {
  const abs = join(ROOT, file);
  const md = readFileSync(abs, 'utf8');
  const scan = stripCode(stripFrontmatter(md));

  // (a) + (b): link checks
  let m;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(scan)) !== null) {
    const target = linkTarget(m[1]);
    if (isExternalOrAnchor(target)) continue;
    const cleaned = target.split('#')[0].split('?')[0];
    if (!cleaned) continue;

    // (b) retired code-derivable docs
    const resolvedRel = normalize(relative(ROOT, resolve(dirname(abs), cleaned)));
    const posixRel = resolvedRel.split('\\').join('/');
    if (
      RETIRED_PREFIXES.some((pre) => posixRel.startsWith(pre)) ||
      RETIRED_HINT.test(cleaned)
    ) {
      errors.push(`${file}: link to retired code-derivable doc \`${target}\` — point to the project Wiki instead`);
      continue;
    }

    // (a) dangling relative link
    const abspath = resolve(dirname(abs), cleaned);
    if (!existsSync(abspath)) {
      errors.push(`${file}: dangling link \`${target}\` (resolved: ${posixRel})`);
    }
  }

  // (c) colocated README shape contract
  if (isColocatedReadme(file)) {
    const h1 = firstHeading(md);
    const hasMarker = /<!--\s*squadrules-doc-keep:/.test(md);
    if (!h1 && !hasMarker) {
      warnings.push(`${file}: colocated README should open with an H1 purpose line or carry a \`<!-- squadrules-doc-keep: reason -->\` marker`);
    }
  }

  // (d) DRY drift: docs/ file duplicating a wiki catalog name
  if (file.startsWith('docs/') && file !== 'docs/README.md' && wikiNames.size) {
    const h1 = firstHeading(md);
    if (h1 && wikiNames.has(h1.toLowerCase())) {
      warnings.push(`${file}: H1 "${h1}" matches a wiki catalog name — code-derivable content belongs in the Wiki (DRY drift)`);
    }
  }
}

// (e) stale `npm run <target>` references
const npmTargets = checkNpmTargetReferences();
errors.push(...npmTargets.findings);

// Report
const mode = STRICT ? 'STRICT (errors fail the build)' : 'report-only (never fails; use --strict to enforce)';
console.log(
  `lint-docs-links: scanned ${files.length} tracked markdown file(s) + ${npmTargets.scanned} npm-target file(s) — mode: ${mode}`
);

if (warnings.length) {
  console.log(`\n⚠️  ${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  - ${w}`);
}

if (errors.length) {
  console.log(`\n❌ ${errors.length} error(s):`);
  for (const e of errors) console.log(`  - ${e}`);
} else {
  console.log('\n✅ no link/retired-path/npm-target errors');
}

if (STRICT && errors.length) {
  process.exit(1);
}
process.exit(0);
