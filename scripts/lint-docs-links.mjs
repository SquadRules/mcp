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
 *
 * Rollout is STAGED. By default this runs in report-only mode: it prints every
 * finding but always exits 0, so it can join `npm run lint` + CI without
 * breaking green builds on pre-existing dangling links. Flip enforcement on
 * with `--strict` or `LINT_DOCS_STRICT=1`, which exits non-zero when any
 * ERROR-class finding (a/b) exists.
 *
 * Usage: node scripts/lint-docs-links.mjs [--strict]
 */
import { execSync } from 'node:child_process';
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

const files = trackedMarkdown();
const wikiNames = loadWikiCatalogNames();

for (const file of files) {
  const abs = join(ROOT, file);
  const md = readFileSync(abs, 'utf8');
  const scan = stripCode(md);

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

// Report
const mode = STRICT ? 'STRICT (errors fail the build)' : 'report-only (never fails; use --strict to enforce)';
console.log(`lint-docs-links: scanned ${files.length} tracked markdown file(s) — mode: ${mode}`);

if (warnings.length) {
  console.log(`\n⚠️  ${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  - ${w}`);
}

if (errors.length) {
  console.log(`\n❌ ${errors.length} error(s):`);
  for (const e of errors) console.log(`  - ${e}`);
} else {
  console.log('\n✅ no link/retired-path errors');
}

if (STRICT && errors.length) {
  process.exit(1);
}
process.exit(0);
