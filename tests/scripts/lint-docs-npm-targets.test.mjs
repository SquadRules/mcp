import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

/**
 * Coverage for rule (e) of scripts/lint-docs-links.mjs (issue #187): a `npm run
 * <target>` citation in scoped documentation or script comments must name a real
 * package.json#scripts key, with historical prose exempt.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const LINTER = join(HERE, '..', '..', 'scripts', 'lint-docs-links.mjs');

let lab;
let repo;

function git(args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

function write(rel, text) {
  const abs = join(repo, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
  git(['add', rel]);
}

function lint(args = []) {
  return spawnSync('node', [join(repo, 'scripts', 'lint-docs-links.mjs'), ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
}

before(() => {
  lab = mkdtempSync(join(tmpdir(), 'squadrules-lint-docs-'));
  repo = realpathSync(lab);
  git(['init', '-q', '-b', 'main', repo]);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);

  mkdirSync(join(repo, 'scripts'), { recursive: true });
  copyFileSync(LINTER, join(repo, 'scripts', 'lint-docs-links.mjs'));

  write(
    'package.json',
    `${JSON.stringify(
      { name: 'fixture', scripts: { build: 'tsc', 'test:ui': 'vitest run', 'lint:docs': 'node scripts/lint-docs-links.mjs' } },
      null,
      2
    )}\n`
  );

  // Valid references — must not be reported.
  write('README.md', 'Run `npm run build` then `npm run test:ui`.\n');

  // Stale reference in prose.
  write('docs/guide.md', 'Start the suite with `npm run dev:serve`.\n');

  // Stale reference in a script comment, and one in a compose comment.
  write('scripts/deploy.sh', '# deploy helper\n# bring the stack up with npm run infra:up\nnpm run build\n');
  write('compose/infra.yaml', '# bring the stack up with npm run cluster:up\nservices: {}\n');

  // Historical prose documenting a removal — must not be reported.
  write(
    'scripts/README.md',
    '| helper | *manual* (its former `npm run prod:raw-qdrant-search` target was retired) |\n'
  );

  // ADR bodies are immutable records — must not be reported.
  write('docs/adr/0009-lanes.md', '`npm run dev:test` ran the four lanes.\n');

  // Explicit inline escape hatch, on the referencing line — must not be reported.
  write('scripts/keep.py', 'npm run retired:job  # squadrules-npm-target-keep: quoted from a released changelog\n');
});

after(() => {
  rmSync(lab, { recursive: true, force: true });
});

test('report-only mode lists stale targets and still exits 0', () => {
  const res = lint();
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /docs\/guide\.md:1: `npm run dev:serve` is not a package\.json#scripts target/);
  assert.match(res.stdout, /scripts\/deploy\.sh:2: `npm run infra:up`/);
  assert.match(res.stdout, /compose\/infra\.yaml:1: `npm run cluster:up`/);
});

test('valid targets are never reported', () => {
  const res = lint();
  assert.doesNotMatch(res.stdout, /npm run build` is not/);
  assert.doesNotMatch(res.stdout, /npm run test:ui` is not/);
  assert.doesNotMatch(res.stdout, /npm run lint:docs` is not/);
});

test('historical prose, ADR bodies, and the keep marker are exempt', () => {
  const res = lint();
  assert.doesNotMatch(res.stdout, /npm run prod:raw-qdrant-search` is not/);
  assert.doesNotMatch(res.stdout, /npm run dev:test` is not/);
  assert.doesNotMatch(res.stdout, /npm run retired:job` is not/);
});

test('strict mode fails the build on a stale target', () => {
  const res = lint(['--strict']);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /STRICT/);
});

test('a removed target is paired with an existing suggestion', () => {
  write('docs/typo.md', 'Run the load suite with `npm run test:load`.\n');
  const res = lint();
  assert.match(res.stdout, /docs\/typo\.md:1: `npm run test:load`[\s\S]*?test:ui/);
});

test('LINT_DOCS_STRICT=1 enforces without the flag', () => {
  const res = spawnSync('node', [join(repo, 'scripts', 'lint-docs-links.mjs')], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, LINT_DOCS_STRICT: '1' },
  });
  assert.equal(res.status, 1);
});
