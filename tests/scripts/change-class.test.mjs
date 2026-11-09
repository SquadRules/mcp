import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { APP_PATHS, DOCS_PATHS, GRAPH_PATHS, classify, isAppPath, isDocsPath, isGraphPath } from '../../scripts/ci-change-class.mjs';

const script = 'scripts/ci-change-class.mjs';
const run = (input, args = [], env = {}) =>
  spawnSync(process.execPath, [script, ...args], { input, encoding: 'utf8', env: { ...process.env, ...env } });
const stdout = result => JSON.parse(result.stdout.trim());

// A representative path for each glob, so a broken translator is caught per pattern
// rather than only through the aggregate classification cases.
const sample = pattern => pattern.replace(/\*\*/g, 'probe').replace(/\*/g, 'p').replace(/\?/g, 'q');

test('documentation-only changes owe no application evidence', () => {
  for (const paths of [
    ['docs/adr/0032-change-class-routing-for-required-ci-gates.md'],
    ['README.md', 'CONTRIBUTING.md'],
    ['.qoder/repowiki/en/content/overview.md', '.agents/rules/task-isolation.md'],
  ]) {
    assert.deepEqual(classify(paths), { docs: true, app: false, graph: false, reason: 'documentation-only', files: paths.length, app_hits: 0, docs_hits: paths.length, graph_hits: 0 });
  }
});

test('NUL input preserves Unicode, spaces and quotes in generated wiki paths', () => {
  const paths = [
    '.qoder/repowiki/knowledge/en/SquadRules UI — Theme/overview.md',
    '.qoder/repowiki/en/content/Page with "quotes".md',
    '.qoder/repowiki/en/content/Line\nBreak.md',
  ];
  const result = run(paths.join('\0') + '\0', ['--null']);
  assert.equal(result.status, 0, result.stderr);
  const classified = stdout(result);
  assert.equal(classified.docs, true);
  assert.equal(classified.app, false, 'Unicode wiki pages must not require app lanes');
  assert.equal(classified.reason, 'documentation-only');
  assert.equal(classified.files, paths.length);

  // Preserve fail-closed behavior for genuinely unmatched paths.
  const mixed = stdout(run(paths.concat('mystery/settings.ini').join('\0') + '\0', ['--null']));
  assert.equal(mixed.app, true);
  assert.equal(mixed.reason, 'unmatched-paths');
});

test('source changes demand the application lanes', () => {
  assert.equal(classify(['src/bootstrap.ts']).app, true);
  assert.equal(classify(['src/bootstrap.ts']).docs, false);
  assert.equal(classify(['src/bootstrap.ts']).reason, 'application');
  assert.equal(classify(['package-lock.json']).app, true);
  assert.equal(classify(['.github/workflows/ci-gate.yml']).app, true, 'CI edits must prove their own build evidence');
});

test('mixed changes demand both lanes and keep docs independently true', () => {
  const mixed = classify(['src/index.ts', 'docs/design.md']);
  assert.equal(mixed.app, true);
  assert.equal(mixed.docs, true);
  assert.equal(mixed.reason, 'mixed');
});

test('skill edits are shipped content, not documentation-only', () => {
  const skills = classify(['.agents/skills/github-pr-checks-watcher/SKILL.md']);
  assert.equal(skills.app, true, 'APP_PATHS covers .agents/skills/** so skill edits run Integration and Security');
  assert.equal(skills.docs, true);
});

test('unattributable paths fail closed into both lanes', () => {
  const unknown = classify(['logo/icon.svg']);
  assert.equal(unknown.app, true);
  assert.equal(unknown.docs, true);
  assert.equal(unknown.reason, 'unmatched-paths');
  // Documentation plus an unattributed file is not a documentation-only change.
  assert.equal(classify(['README.md', 'logo/icon.svg']).app, true);
});

test('an empty or unreadable file list fails closed as unclassified', () => {
  for (const paths of [[], [''], ['  ', '\n'], undefined]) {
    const result = classify(paths);
    assert.equal(result.app, true);
    assert.equal(result.docs, true);
    assert.equal(result.reason, 'unclassified');
  }
});

test('every declared application glob matches a real path shape', () => {
  assert.deepEqual(APP_PATHS, [
    'src/**', 'tests/**', 'package.json', 'package-lock.json', 'tsconfig*.json', 'eslint.config.cjs',
    'knip.config.ts', 'eslint/**', '.github/workflows/**', 'scripts/**', 'compose/**', '.agents/skills/**',
  ]);
  for (const pattern of APP_PATHS) {
    assert.ok(isAppPath(sample(pattern)), `${pattern} must classify as application work`);
    assert.ok(!isAppPath('docs/notes.md'), `${pattern} must not claim documentation`);
  }
  // A globstar must span directories, not just one path segment.
  assert.ok(isAppPath('scripts/ci-change-class.mjs'), 'scripts/** spans depth');
  assert.ok(isAppPath('.github/workflows/integration.yml'), '.github/workflows/** spans depth');
  assert.ok(isAppPath('.agents/skills/github-pr-checks-watcher/SKILL.md'), '.agents/skills/** spans depth');
  assert.ok(isAppPath('tests/scripts/change-class.test.mjs'), 'tests/** spans depth');
  assert.ok(!isAppPath('docs/adr/0032-x.md'), 'a nested document is not application work');
});

test('every declared documentation glob matches a real path shape', () => {
  assert.deepEqual(DOCS_PATHS, ['docs/**', '.qoder/**', '.agents/**', '*.md']);
  for (const pattern of DOCS_PATHS) assert.ok(isDocsPath(sample(pattern)), `${pattern} must classify as documentation`);
  assert.ok(isDocsPath('docs/adr/0031-ruleset-enforced-single-required-gate.md'), '*.md must match at depth');
  assert.ok(isDocsPath('.qoder/repowiki/en/content/overview.md'), '.qoder/** spans depth');
  assert.ok(isDocsPath('.agents/skills/github-pr-checks-watcher/SKILL.md'), '.agents/** spans depth');
  assert.ok(!isDocsPath('src/index.ts'), 'source is not documentation');
});

test('the command emits JSON plus the documented step output keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'change-class-'));
  const outputFile = join(dir, 'output');
  try {
    const result = run('src/index.ts\ndocs/design.md\n', [], { GITHUB_OUTPUT: outputFile });
    assert.equal(result.status, 0, result.stderr);
    const parsed = stdout(result);
    assert.equal(parsed.app, true);
    assert.equal(parsed.docs, true);
    assert.equal(readFileSync(outputFile, 'utf8'), 'docs=true\napp=true\ngraph=false\nreason=mixed\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('graph-class revisions are attributed to the shared-backend surface', () => {
  // One representative path per declared glob, so a broken translator is caught per
  // pattern rather than only through the aggregate class.
  assert.deepEqual(GRAPH_PATHS, [
    'src/services/graph-db/**', 'src/config/graph-backend.ts', 'compose/**', 'tests/integration/graph-db-*',
    'tests/unit/graph-*', 'scripts/ci-change-class.mjs', '.github/workflows/**',
  ]);
  for (const path of [
    'src/services/graph-db/arango/arango-schema.ts',
    'src/config/graph-backend.ts',
    'compose/infra.yaml',
    'tests/integration/graph-db-arango-shared.test.ts',
    'tests/unit/graph-db-reward-unit.test.ts',
    '.github/workflows/integration.yml',
  ]) {
    assert.ok(isGraphPath(path), `${path} must be shared-backend class`);
    assert.equal(classify([path]).graph, true, `${path} must set graph=true`);
    assert.ok(isAppPath(path), `${path} must also be application class, or the graph lane could be path-filtered away`);
  }
  // Every graph glob is span-checked, not just segment-checked.
  assert.ok(isGraphPath('tests/integration/graph-db-arango-evolution.test.ts'));
  assert.ok(isGraphPath('scripts/ci-change-class.mjs'), 'the classifier contract proves itself');
  assert.ok(!isGraphPath('src/tools/train.ts'), 'a non-graph source file is application class only');
  assert.ok(!isGraphPath('docs/adr/0048-x.md'), 'prose about the graph is not graph-class work');
});

test('the graph class fails closed exactly like the application class', () => {
  // An unattributable revision could have touched graph behaviour, so it must be able
  // to attribute a shared-backend failure instead of silently skipping that lane.
  assert.equal(classify([]).graph, true);
  assert.equal(classify(['logo/icon.svg']).graph, true);
  assert.equal(classify(['README.md', 'logo/icon.svg']).graph, true);
  assert.equal(classify(['docs/adr/0048-shared-backend-ci-lane.md']).graph, false);
  assert.equal(classify(['src/tools/train.ts', 'docs/adr/0048-x.md']).graph, false);
});

test('a revision with no files fails the gate instead of burning the wait deadline', () => {
  const emptyDiff = run('', ['--empty-diff']);
  assert.equal(emptyDiff.status, 1, 'an explicit empty diff must not be accepted as validated');
  assert.match(emptyDiff.stderr, /no changed files/i);
  assert.equal(stdout(emptyDiff).reason, 'unclassified');

  // Without the flag the same input stays a pass-shaped unclassified result, so
  // the gate waits for evidence and fails on the deadline rather than crashing.
  const quiet = run('');
  assert.equal(quiet.status, 0);
  assert.equal(stdout(quiet).app, true);
  assert.equal(stdout(quiet).reason, 'unclassified');
});
