/**
 * Shared-backend CI lane contract (ADR 0048).
 *
 * Split out of `workflow-structure.test.mjs` so each file stays under the ESLint
 * `max-lines` budget while still pinning the whole lane. The lane exists because the
 * ArangoDB backend was implemented but never executed by CI (ADR 0044 §2): the two
 * ways it could stop proving anything — being skipped, or being told nothing is
 * required — are what these tests forbid.
 *
 * The lane now carries three required suite groups (Arango parity, mock-free embedded,
 * shipped-package API). The trigger, the dist prerequisite and the suite selection each
 * decide how many assertions the lane really executes, so each is pinned below.
 *
 * What "mock-free" means here: no suite in the embedded group may import the
 * synthetic-verdict harness, and the shared harness may not manufacture a critic verdict
 * at all. Accepting any write still requires a real gate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { classify } from '../../scripts/ci-change-class.mjs';

const workflow = name => load(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
const stepNamed = (config, job, name) => config.jobs[job].steps.find(s => s.name === name);
const runOf = (config, job, name) => stepNamed(config, job, name).run;

test('the shared-backend Graph lane runs real ArangoDB 3.11 and cannot be skipped', () => {
  const integration = workflow('integration');
  const graph = integration.jobs['verify-integration-graph'];
  assert.ok(graph, 'Integration must carry the shared-backend lane (ADR 0048)');

  // Unconditional: a path filter or an `if:` guard would make the lane skippable, and a
  // skipped required check is exactly the failure mode ci-gate exists to prevent.
  assert.equal(graph.if, undefined, 'The Graph lane must not be conditionally skipped');
  assert.equal(graph['continue-on-error'], undefined, 'The Graph lane cannot be advisory');
  assert.equal(graph['timeout-minutes'], 40, 'Preserve the budget for all three required Graph suite groups');

  // Test-owned disposable service: pinned minor, no auth secret, no privileged mode,
  // no host mount, nothing published.
  const service = graph.services?.arangodb;
  assert.ok(service, 'The lane must start its own ArangoDB service container');
  assert.equal(service.image, 'arangodb:3.11', 'The lane must pin the supported 3.11 series');
  assert.deepEqual(service.env, { ARANGO_NO_AUTH: '1' }, 'A disposable test server needs no credential');
  assert.ok(Array.isArray(service.ports) && service.ports.includes('8529:8529'));
  assert.doesNotMatch(JSON.stringify(service), /privileged|volumes|\/var\/run\/docker\.sock/);

  // The suites must be told the lane requires them: without the flag an empty env would
  // be reported as a skip, and the job would go green executing zero assertions.
  const run = graph.steps.find(s => s.name === 'Run shared-backend integration suites against real ArangoDB');
  assert.ok(run, 'The lane must run the shared-backend suites');
  assert.equal(run.env.SQUADRULES_ARANGO_REQUIRED, 'true', 'A required lane must fail, not skip, when unconfigured');
  assert.equal(run.env.SQUADRULES_ARANGO_URL, 'http://127.0.0.1:8529');
  assert.equal(run.env.SQUADRULES_ARANGO_DATABASE, 'squadrules_it');
  assert.match(run.run, /tests\/integration\/graph-db-arango-shared\.test\.ts/);
  assert.match(run.run, /tests\/integration\/graph-db-arango-evolution\.test\.ts/);
  // The link-failure parity suite is the Arango half of ADR 0045's atomic append: a
  // backend that appends the node but not the edge must fail here, not in production.
  assert.match(run.run, /tests\/integration\/graph-db-arango-history-link-fault\.test\.ts/);
  assert.match(run.run, /NODE_OPTIONS=--experimental-vm-modules/);

  // The database the deployment URL points at is created by the job, not assumed.
  const bootstrap = graph.steps.find(s => s.name === 'Wait for ArangoDB and create the test database');
  assert.ok(bootstrap, 'The lane must wait for the server and create its database');
  assert.match(bootstrap.run, /_api\/version/, 'Readiness must be an observed endpoint, not a sleep');
  assert.match(bootstrap.run, /_api\/database/);
  assert.match(bootstrap.run, /exit 1/, 'An unreachable server must fail the step');

  // The aggregator is the enforcement point: success, never skipped.
  const pass = integration.jobs['integration-pass'];
  assert.ok(pass.needs.includes('verify-integration-graph'));
  const step = pass.steps.find(s => s.run);
  assert.ok(Object.values(step.env).includes('${{ needs.verify-integration-graph.result }}'));
  assert.match(step.run, /test "\$GRAPH" = "success"/, 'A skipped Graph lane must not pass the gate');
});

test('the gate reports the shared-backend class but never lets it grant a skip', () => {
  const gate = workflow('ci-gate');
  const classify = runOf(gate, 'gate', 'Classify changed paths');

  assert.match(classify, /jq -r \.graph/, 'The gate must read the shared-backend class');
  assert.match(classify, /shared-backend class/, 'The gate summary must name the class');
  // Fail-closed paths owe the graph lane as well, exactly like the application lanes.
  assert.equal((classify.match(/graph=true/g) ?? []).length, 3, 'Every fail-closed path must expect the Graph lane');
  assert.match(classify, /graph=false/, 'A dispatch revision is not graph-class');
  // The class is diagnostic: it may never gate the lane that is unconditionally required.
  assert.doesNotMatch(classify, /graph == 'true'/, 'The graph class must not condition the required lane');
});

const graphJob = () => workflow('integration').jobs['verify-integration-graph'];
const graphStep = name => graphJob().steps.find(s => s.name === name);

/** Suite files one graph script names, in script order. */
const suitesOf = script => {
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
  return scripts[script].match(/tests\/integration\/[a-z0-9-]+\.test\.ts/g) ?? [];
};

const weightCache = action =>
  graphJob().steps.find(s => s.uses?.startsWith(`actions/cache/${action}@`) && s.with?.path === '~/.cache/embedding-models');

test('required checks and evidence producers cover the same branches and PR events', () => {
  const required = workflow('ci-gate').on.pull_request;
  assert.deepEqual(required.branches, ['main', 'squadrules-6']);
  for (const name of ['integration', 'security', 'automation-policy']) {
    const config = workflow(name);
    assert.deepEqual(config.on.pull_request.branches, required.branches, `${name} must cover every required branch`);
    for (const event of required.types) {
      assert.ok(config.on.pull_request.types.includes(event), `${name} must produce evidence on ${event}`);
    }
    if (name === 'automation-policy') {
      assert.equal(config.on.pull_request.paths, undefined, 'Policy must remain always-on');
      assert.equal(config.on.pull_request['paths-ignore'], undefined);
      assert.ok(config.on.pull_request.types.includes('edited'), 'Title edits must still rerun policy');
    }
  }
});

test('producer path alignment preserves application, documentation and fail-closed classification', () => {
  for (const path of [
    'tsconfig.build.json', 'eslint.config.cjs', 'knip.config.ts', 'eslint/rules/example.cjs',
    'compose/infra.yaml', '.agents/skills/squadrules/SKILL.md'
  ]) {
    assert.equal(classify([path]).app, true, `${path} requires both integration and security evidence`);
  }
  for (const path of ['docs/specs/graph-schema.md', '.qoder/rules/example.md', '.agents/example.md', 'README.md']) {
    const result = classify([path]);
    assert.equal(result.docs, true);
    assert.equal(result.app, false, `${path} must stay documentation-only`);
    assert.equal(result.graph, false);
  }
  for (const paths of [[], ['unknown/file']]) {
    const result = classify(paths);
    assert.equal(result.docs, true);
    assert.equal(result.app, true);
    assert.equal(result.graph, true);
  }
});

test('the Graph lane boots the build job tarball, never a source rebuild', () => {
  const download = graphJob().steps.find(s => s.uses?.startsWith('actions/download-artifact@'));
  assert.equal(
    download?.with?.name,
    'npm-package-node24',
    'The API group must consume the tarball the build job packed for this same revision'
  );
  assert.match(graphStep('Install package from tgz').run, /artifact-npm/);
  assert.match(
    graphStep('Expose installed package dist for the API suites').run,
    /cp -R node_modules\/@squadrules\/mcp\/dist \.\/dist/,
    'The child servers boot dist/bootstrap.js, which npm ci alone never emits'
  );
  const names = graphJob().steps.map(s => s.name);
  assert.ok(
    names.indexOf('Expose installed package dist for the API suites') <
      names.indexOf('Run shipped-package graph API suites'),
    'dist must exist before the suites that boot it'
  );
});

test('the Graph lane requires the mock-free embedded suites and no synthetic-verdict suite', () => {
  assert.equal(graphStep('Run mock-free embedded graph suites').run, 'npm run test:graph-embedded');

  const suites = suitesOf('test:graph-embedded');
  for (const suite of [
    'graph-db-boot-repair',
    'graph-db-instance-isolation',
    'graph-db-topology-projection',
    'adapter-inheritance-checkpoints',
    'adapter-inheritance-effective-content'
  ]) {
    assert.ok(suites.includes(`tests/integration/${suite}.test.ts`), `test:graph-embedded must run ${suite}`);
  }
  // `graph-db-critic-fixture.ts` hands `tune` a verdict file the test wrote itself, so a
  // suite that writes through it proves the write, not the gate. Those suites stay out
  // until the gate is exercised for real; naming them here keeps the omission deliberate
  // and visible.
  for (const suite of ['adapter-inheritance-projection', 'graph-db-evolution', 'graph-db-history-restore']) {
    assert.ok(
      !suites.includes(`tests/integration/${suite}.test.ts`),
      `${suite} writes on a fabricated critic PASS; it cannot join a required lane yet`
    );
  }
  // The synthetic verdict lives in `graph-db-critic-fixture.ts` only, so importing the
  // shared harness cannot smuggle one into the lane.
  assert.doesNotMatch(
    readFileSync('tests/integration/graph-db-fixture.ts', 'utf8'),
    /verdict_file|review_evidence/,
    'The shared harness must never hand the gate a verdict'
  );
  for (const suite of suites) {
    const source = readFileSync(suite, 'utf8');
    assert.doesNotMatch(
      source,
      /graph-db-critic-fixture/,
      `${suite} may not import the synthetic-verdict harness`
    );
    assert.doesNotMatch(
      source,
      /verdict_file|review_evidence/,
      `${suite} may not hand the gate a verdict the test wrote`
    );
  }
  assert.ok(
    graphJob()['timeout-minutes'] >= 30,
    'Three suite groups, one booting a server per suite, need more than the Arango-only budget'
  );
});

test('the Graph lane requires the shipped-package API suites, CAS included, on one weight cache', () => {
  const api = graphStep('Run shipped-package graph API suites');
  assert.equal(api.run, 'npm run test:graph-api');
  assert.equal(api.env, undefined, 'The API group must prove the package defaults: no backend override');

  const suites = suitesOf('test:graph-api');
  for (const suite of [
    'http-api-graph-api',
    'http-api-graph-cas',
    'http-api-graph-evolution',
    'http-api-graph-inheritance'
  ]) {
    assert.ok(suites.includes(`tests/integration/${suite}.test.ts`), `test:graph-api must run ${suite}`);
  }
  for (const suite of suites) {
    assert.doesNotMatch(readFileSync(suite, 'utf8'), /verdict_file/, `${suite} may not hand the gate a verdict the test wrote`);
  }

  // Every child server forwards these ambient cache dirs, so one download serves them all.
  assert.ok(weightCache('restore'), 'The lane must reuse one fastembed weight cache across child boots');
  assert.equal(
    weightCache('save')?.if,
    "always() && steps.fastembed-model-cache.outputs.cache-hit != 'true'",
    'A cold cache must be stored even when a suite fails, or every run pays the download again'
  );
});
