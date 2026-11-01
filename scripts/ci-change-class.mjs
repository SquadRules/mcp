#!/usr/bin/env node
/**
 * Change-class classifier for the aggregate CI gate (.github/workflows/ci-gate.yml).
 *
 * Issue #196: a required check that is provided by a path-filtered workflow never
 * reports for a change outside that filter, so enforcement cannot live on the
 * filtered workflows themselves. The aggregate is always-on and asks this script
 * which lanes the revision actually owes evidence for.
 *
 * Input: a newline-separated list of repository paths on stdin, exactly as produced
 * by `git diff --name-only <merge-base> <head>`. Output: one JSON object on stdout
 * plus `docs` / `app` / `reason` key lines appended to $GITHUB_OUTPUT when set.
 *
 * `APP_PATHS` is the union of the `on.pull_request.paths` filters of integration.yml
 * and security.yml; `tests/scripts/change-class.test.mjs` asserts that lockstep, so
 * widening a filtered workflow widens the aggregate expectation in the same commit.
 *
 * Classification fails closed. Anything this script cannot positively attribute to
 * documentation is treated as application work, because a false `app: false` is a
 * merge without build, integration or security evidence:
 *   - every path documentation-only  -> { docs: true,  app: false }
 *   - any APP_PATHS hit              -> app: true, docs decided independently
 *   - no path matches either set     -> both lanes expected (reason: unmatched-paths)
 *   - empty or unreadable input      -> both lanes expected (reason: unclassified)
 * `--empty-diff` is the explicit hard-fail path for a revision that contributes no
 * files at all: it prints the reason and exits non-zero instead of letting the gate
 * spend its wait budget on workflows that were never going to run.
 *
 * Usage: git diff --name-only -z "$MB" "$HEAD" | node scripts/ci-change-class.mjs --null [--empty-diff]
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Application-class globs: union of the PR path filters in integration.yml and
 * security.yml. Kept as literal workflow filter strings (not regexes) so the
 * lockstep test can compare them against the YAML verbatim.
 */
export const APP_PATHS = [
  'src/**',
  'tests/**',
  'package.json',
  'package-lock.json',
  'tsconfig*.json',
  'eslint.config.cjs',
  'knip.config.ts',
  'eslint/**',
  '.github/workflows/**',
  'scripts/**',
  'compose/**',
  '.agents/skills/**',
];

/** Documentation-class globs: prose and generated wiki content only. */
export const DOCS_PATHS = ['docs/**', '.qoder/**', '.agents/**', '*.md'];

/**
 * Translate one workflow-style glob into a regular expression over a POSIX path:
 * `**` spans slashes, `*` and `?` do not. A pattern without a slash matches the
 * basename at any depth, which is what `*.md` needs in order to count
 * `docs/adr/0032-x.md` as documentation.
 */
function globToRegExp(pattern) {
  const prefix = pattern.includes('/') ? '' : '(?:^|.*/)';
  let body = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') {
      i += 1;
      body += '.*';
    } else if (char === '*') body += '[^/]*';
    else if (char === '?') body += '[^/]';
    else body += char.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  return new RegExp(`^${prefix}${body}$`);
}

const APP_RES = APP_PATHS.map(globToRegExp);
const DOCS_RES = DOCS_PATHS.map(globToRegExp);

/** True when `file` is covered by the application-class filter set. */
export function isAppPath(file) {
  return APP_RES.some((re) => re.test(file));
}

/** True when `file` is covered by the documentation-class filter set. */
export function isDocsPath(file) {
  return DOCS_RES.some((re) => re.test(file));
}

/**
 * Classify a changed-file list into the lanes the revision owes evidence for.
 * @param {string[]} paths repository-relative paths; blank lines are ignored
 * @returns {{docs: boolean, app: boolean, reason: string, files: number, app_hits: number, docs_hits: number}}
 */
export function classify(paths) {
  const files = Array.isArray(paths) ? paths.map((p) => String(p).trim()).filter(Boolean) : [];
  const detail = (docs, app, reason) => ({
    docs,
    app,
    reason,
    files: files.length,
    app_hits: files.filter(isAppPath).length,
    docs_hits: files.filter(isDocsPath).length,
  });

  if (files.length === 0) return detail(true, true, 'unclassified');
  const appHits = files.filter(isAppPath);
  const docsHits = files.filter(isDocsPath);
  if (appHits.length === 0 && docsHits.length === files.length) return detail(true, false, 'documentation-only');
  if (appHits.length > 0) return detail(docsHits.length > 0, true, docsHits.length > 0 ? 'mixed' : 'application');
  return detail(true, true, 'unmatched-paths');
}

function writeOutput(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  for (const [key, value] of Object.entries(values)) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}

function emit(result) {
  console.log(JSON.stringify(result));
  writeOutput({ docs: result.docs, app: result.app, reason: result.reason });
}

function readChangedPaths() {
  // Git's default newline output C-quotes paths containing Unicode, tabs or
  // newlines. Treating those as literal paths makes a docs-only PR appear
  // unclassified and strands the required gate waiting for nonexistent app CI.
  // --null expects git diff --name-only -z, which emits raw path bytes.
  if (process.stdin.isTTY) throw new Error('stdin is a terminal, not a file list');
  const raw = readFileSync(0, 'utf8');
  return raw.split(process.argv.includes('--null') ? '\0' : '\n');
}

function main() {
  const emptyDiff = process.argv.slice(2).includes('--empty-diff');
  let paths = [];
  let unreadable = false;
  try {
    paths = readChangedPaths();
  } catch {
    unreadable = true;
  }
  const result = classify(unreadable ? [] : paths);

  if (emptyDiff || unreadable) {
    emit(result);
    console.error(
      'ci-change-class: no changed files could be read for this revision, so no CI evidence can be attributed to it. ' +
        'A PR that contributes no files must not be accepted as validated; rebase or close it rather than waiting.',
    );
    process.exit(1);
  }

  emit(result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
