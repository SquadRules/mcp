// Structural discovery contract only: no Jest runner, setup hooks or suite imports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { createRequire } from 'node:module';
import { posix, win32 } from 'node:path';
import { runInNewContext } from 'node:vm';
import config from '../../jest.config.js';

const reviewed = 'tests/integration/http-api-graph-reviewed-content.test.ts';
const exclusion = '^<rootDir>/tests/integration/http-api-graph-reviewed-content\\.test\\.ts$';
const ordinaryIgnores = ['/node_modules/', '/tests/ui/', '/tests/load/'];
const require = createRequire(import.meta.url);
const regexSource = readFileSync(require.resolve('jest-regex-util'), 'utf8');

// Check wiring from configuration only; never import or execute the UNIT suites here.
const nodeUnitSuites = [
  'tests/unit/evolution-integrity-node.test.mjs',
  'tests/unit/evolution-consensus-boundary-node.test.mjs',
  'tests/unit/wire-diagnostic-integrity-node.test.mjs',
  'tests/unit/stored-adapter-frontmatter.test.mjs',
  'tests/unit/frontmatter-read-integrity-node.test.mjs',
  'tests/scripts/jest-discovery.test.mjs'
];

test('focused Node UNIT regressions have an explicit runner without broadening Jest', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(scripts['test:unit-node'], `node --test ${nodeUnitSuites.join(' ')}`);
  for (const suite of nodeUnitSuites) {
    assert.equal(existsSync(new URL(`../../${suite}`, import.meta.url)), true, `required file: ${suite}`);
  }
});

test('Node UNIT gate is unconditional on both build nodes before packaging and feeds the aggregate', () => {
  const integration = load(readFileSync(new URL('../../.github/workflows/integration.yml', import.meta.url), 'utf8'));
  const { build } = integration.jobs;
  assert.deepEqual(build.strategy.matrix.node, ['24', '26']);
  assert.equal(build.if, undefined);
  assert.equal(build['continue-on-error'], undefined);
  const steps = build.steps;
  const gates = steps.filter(step => step.run === 'npm run test:unit-node');
  assert.equal(gates.length, 1);
  assert.deepEqual(gates[0], { run: 'npm run test:unit-node' });
  const install = steps.findIndex(step => step.run === 'npm ci');
  const gate = steps.indexOf(gates[0]);
  const pack = steps.findIndex(step => step.run === 'npm run build:tgz');
  assert.ok(install >= 0 && install < gate && gate < pack, 'install -> Node UNIT gate -> packaging');
  const aggregate = integration.jobs['integration-pass'];
  assert.ok(aggregate.needs.includes('build'));
  assert.equal(aggregate.if, 'always()');
  const requireAll = aggregate.steps.find(step => step.name === 'Require every validation job');
  assert.equal(requireAll.env.BUILD, '${{ needs.build.result }}');
  assert.ok(requireAll.run.includes('test "$BUILD" = "success"'), 'build requires positive success evidence');
});

// Exercise Jest's installed separator normalizer for both platforms without loading
// jest-config (or its preset). Matches its normalizeUnmockedModulePathPatterns rule:
// replace <rootDir>, then replacePathSepForRegex. This is NOT real test discovery.
function ignoreRegex(patterns, root, pathApi) {
  const module = { exports: {} };
  runInNewContext(regexSource, {
    module,
    require: name => {
      assert.equal(name, 'path');
      return pathApi;
    }
  });
  const { replacePathSepForRegex } = module.exports;
  return new RegExp(patterns.map(pattern =>
    replacePathSepForRegex(pattern.replaceAll('<rootDir>', root))).join('|'));
}

test('default discovery excludes only the approved task-bound proof file', () => {
  assert.deepEqual(config.testPathIgnorePatterns, [...ordinaryIgnores, exclusion]);
  assert.deepEqual(config.roots, ['<rootDir>/src', '<rootDir>/tests']);
  assert.deepEqual(config.testMatch, ['**/*.test.ts', '**/*.test.js', '**/*.spec.ts', '**/*.spec.js']);
});

test('anchored exclusion survives Jest POSIX/Windows normalization, not filename selection', () => {
  for (const [pathApi, root] of [[posix, '/workspace/mcp'], [win32, 'C:\\workspace\\mcp']]) {
    const target = pathApi.join(root, reviewed);
    const ignored = ignoreRegex(config.testPathIgnorePatterns, root, pathApi);
    assert.equal(ignored.test(target), true, `${target}: default exclusion`);
    // Naming a file via testMatch/CLI does not cancel testPathIgnorePatterns.
    const namedOnly = { ...config, testMatch: [reviewed] };
    assert.equal(ignoreRegex(namedOnly.testPathIgnorePatterns, root, pathApi).test(target), true);
    const optIn = config.testPathIgnorePatterns.filter(pattern => pattern !== exclusion);
    assert.deepEqual(optIn, ordinaryIgnores);
    assert.equal(ignoreRegex(optIn, root, pathApi).test(target), false, 'explicit removal permits opt-in');
    for (const nearMiss of [
      `${reviewed}.bak`,
      reviewed.replace('.test.ts', 'XtestXts'),
      reviewed.replace('-content.', '-content-extra.'),
      `nested/${reviewed}`,
      reviewed.replace('/integration/', '/unit/')
    ]) {
      assert.equal(ignored.test(pathApi.join(root, nearMiss)), false, nearMiss);
    }
    assert.equal(ignored.test(pathApi.join(`${root}-other`, reviewed)), false, 'root anchor');
    assert.equal(ignored.test(pathApi.join(root, 'tests/integration/http-api-graph-reviewed-backend.test.ts')), false);
  }
});

test('mandatory graph groups and parity files remain eligible under default ignore rules', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const required = ['test:spec-parity', 'test:api-spec-parity', 'test:graph-api', 'test:graph-embedded', 'test:graph-arango'];
  for (const [pathApi, root] of [[posix, '/workspace/mcp'], [win32, 'C:\\workspace\\mcp']]) {
    const ignored = ignoreRegex(config.testPathIgnorePatterns, root, pathApi);
    for (const name of required) {
      const suites = scripts[name].match(/tests\/(?:unit|integration)\/[a-z0-9-]+\.test\.ts/g) ?? [];
      assert.ok(suites.length > 0, `${name}: nonempty suite selection`);
      for (const suite of suites) {
        assert.equal(ignored.test(pathApi.join(root, suite)), false, `${name}: ${suite}`);
      }
    }
  }
});
