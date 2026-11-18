import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';

const script = 'scripts/deploy-generate-dev-secrets.py';
const template = 'scripts/env/.env.template';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'squadrules-env-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts', 'env'), { recursive: true });
  cpSync(script, join(root, script));
  cpSync(template, join(root, template));
  return root;
}

function run(root, apiKey, args = []) {
  return spawnSync('python3', [join(root, script), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, OPENAI_API_KEY: apiKey },
  });
}

function assertSuccess(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

test('fullstack env generation defaults to local embeddings without an OpenAI key', t => {
  const root = fixture(t);
  assertSuccess(run(root, ''));
  const env = readFileSync(join(root, '.env'), 'utf8');
  assert.match(env, /^EMBEDDING_PROVIDER=auto$/m);
  assert.match(env, /^OPENAI_API_KEY=$/m);
  assert.match(env, /^QDRANT_URL=http:\/\/127\.0\.0\.1:6333$/m);
  assert.match(env, /^AUTH_ENABLED=true$/m);
  assertSuccess(run(root, '', ['--verify']));
});

test('fullstack env generator preserves optional OpenAI credentials', t => {
  const root = fixture(t);
  assertSuccess(run(root, 'test-key-not-real'));
  const env = readFileSync(join(root, '.env'), 'utf8');
  assert.match(env, /^OPENAI_API_KEY=test-key-not-real$/m);
  assert.match(env, /^EMBEDDING_PROVIDER=auto$/m);
  assertSuccess(run(root, 'test-key-not-real', ['--verify']));
});

test('explicit OpenAI provider fails verification without a key or endpoint', t => {
  const root = fixture(t);
  assertSuccess(run(root, ''));
  const filename = join(root, '.env');
  const env = readFileSync(filename, 'utf8');
  writeFileSync(filename, env.replace('EMBEDDING_PROVIDER=auto', 'EMBEDDING_PROVIDER=openai'));
  const failed = run(root, '', ['--verify']);
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /OPENAI_API_KEY\|OPENAI_API_URL/);

  writeFileSync(filename, readFileSync(filename, 'utf8') + 'OPENAI_API_URL=http://localhost:11434\n');
  assertSuccess(run(root, '', ['--verify']));
});

test('integration workflow does not require an OpenAI secret', () => {
  const integration = load(readFileSync('.github/workflows/integration.yml', 'utf8'));
  assert.equal(integration.on.workflow_call.secrets.OPENAI_API_KEY.required, false);
  const cluster = integration.jobs['verify-integration-cluster'];
  const start = cluster.steps.find(step => step.name?.startsWith('Start app'));
  assert.equal(start.env.HEALTH_CHECK_ATTEMPTS, 120);
});
