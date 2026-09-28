import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { generateNotes } from '@semantic-release/release-notes-generator';
import { parserOpts, releaseRules, prereleaseChannel } from '../../release.config.mjs';
import { ARTIFACTS, assertManifest, digest, channelTags, requireSame, retry, releaseRecord, recordBody, ensurePublished, publishStages, recordChannel } from '../../scripts/ci-release-state.mjs';
import { verifyFiles, runToFile } from '../../scripts/ci-release.mjs';
import { auditResult, nativeProgressing } from '../../scripts/ci-audit.mjs';
import { promoteNpmTag } from '../../scripts/ci-npm.mjs';

const manifest = (overrides = {}) => ({ schema: 1, sourceSha: 'a'.repeat(40), branch: 'main', version: '5.1.2',
  channel: 'latest', validated: true, imageDigest: `sha256:${'b'.repeat(64)}`, npmIntegrity: 'sha512-YWJjZA==',
  files: Object.fromEntries(ARTIFACTS.map(file => [file, digest(file)])), ...overrides });
const analyze = messages => analyzeCommits({ parserOpts, releaseRules }, {
  cwd: process.cwd(), commits: messages.map(message => ({ message, hash: 'a'.repeat(40) })), logger: { log() {} },
});

for (const [name, messages, expected] of [
  ['dependency patch', ['fix(deps): bump react'], 'patch'],
  ['historical dependency patch', ['chore(deps): bump react', 'deps(actions): update action'], 'patch'],
  ['feature overrides dependency patch', ['feat: add a capability', 'fix(deps): bump react'], 'minor'],
  ['breaking header overrides dependency patch', ['fix(deps)!: upgrade major API', 'fix: patch'], 'major'],
  ['breaking footer overrides feature', ['feat: add feature\n\nBREAKING CHANGE: old format removed'], 'major'],
  ['housekeeping no-release', ['chore: clean workspace', 'docs: describe setup'], null],
]) {
  test(name, async () => assert.equal(await analyze(messages), expected));
}

test('release notes preserve the same breaking-header semantics as version analysis', async () => {
  const notes = await generateNotes({ parserOpts }, {
    cwd: process.cwd(), commits: [{ hash: 'a'.repeat(40), message: 'fix(deps)!: remove obsolete API' }],
    lastRelease: { gitTag: 'v4.0.0' }, nextRelease: { version: '5.0.0', gitTag: 'v5.0.0' },
    options: { repositoryUrl: 'https://github.com/owner/repo.git' },
  });
  assert.match(notes, /BREAKING CHANGES/);
  assert.match(notes, /remove obsolete API/);
});

test('prereleases never promote stable aliases', () => {
  assert.deepEqual(channelTags(manifest()), ['latest', '5', '5.1']);
  assert.deepEqual(channelTags(manifest({ version: '5.2.0-beta.1', branch: 'beta', channel: 'beta' })), ['beta']);
  assert.throws(() => assertManifest(manifest({ version: '5.2.0-beta.1' })), /Invalid/);
  assert.throws(() => assertManifest(manifest({ version: '5.2.0-beta.1', branch: '5', channel: '5' })), /Invalid/);
  assert.equal(prereleaseChannel('latest'), 'pre-latest');
  assert.equal(prereleaseChannel('5'), 'pre-5');
  assert.equal(prereleaseChannel('Feature/API'), 'feature-api');
});

test('semantic-release channel notes are preserved for subsequent prerelease numbering', async () => {
  for (const m of [manifest(), manifest({ version: '5.2.0-beta.1', channel: 'beta', branch: 'beta' })]) {
    let note;
    let tree;
    let writes = 0;
    const api = { request: async (path, options = {}) => {
      if (options.method) {
        writes++;
        if (path === '/git/trees') { tree = options.body.tree; return { sha: 'tree' }; }
        if (path === '/git/commits') return { sha: 'note' };
        assert.equal(options.body.ref, `refs/notes/semantic-release-v${m.version}`);
        note = { object: { sha: 'note' } };
        return note;
      }
      if (path.startsWith('/git/ref/')) {
        if (!note) throw Object.assign(new Error('missing'), { status: 404 });
        return note;
      }
      if (path === '/git/commits/note') return { tree: { sha: 'tree' } };
      if (path === '/git/trees/tree') return { tree: tree.map(entry => ({ ...entry, sha: 'blob' })) };
      return { content: Buffer.from(tree[0].content).toString('base64') };
    } };
    await recordChannel(api, m);
    assert.equal(tree[0].path, m.sourceSha);
    assert.deepEqual(JSON.parse(tree[0].content), { channels: [m.channel === 'latest' ? null : 'beta'] });
    await recordChannel(api, m);
    assert.equal(writes, 3);
  }
});

test('publication requires a complete validated source/version/checksum manifest', () => {
  for (const change of [{ validated: false }, { sourceSha: 'main' }, { version: 'latest' }, { files: {} },
    { imageDigest: 'latest' }, { npmIntegrity: null }]) assert.throws(() => assertManifest(manifest(change)));
});

test('partial recovery preserves the original source, version and hashes', () => {
  const record = { manifest: manifest(), artifactId: 123, runId: 456, stages: { npm: 'done' } };
  const release = { tag_name: 'v5.1.2', body: recordBody(record) };
  assert.deepEqual(releaseRecord(release), record);
  assert.throws(() => releaseRecord({ ...release, tag_name: 'v5.1.3' }), /identity mismatch/);
  assert.throws(() => releaseRecord({ ...release, body: 'older incomplete release' }), /manual migration/);
});

test('existing mismatched artifacts fail; retries cannot accept a different identity', async () => {
  assert.throws(() => requireSame('sha256:old', 'sha256:new', 'container'), /identity mismatch/);
  let attempts = 0;
  await assert.rejects(retry(async () => { attempts++; requireSame('old', 'new', 'npm'); }, async () => {}));
  assert.equal(attempts, 1);
});

test('transient failures retry at most three times', async () => {
  let attempts = 0;
  await assert.rejects(retry(async () => { attempts++; throw new Error('HTTP 503'); }, async () => {}));
  assert.equal(attempts, 3);
});

test('SBOM output larger than the subprocess capture limit is preserved byte-for-byte', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'release-sbom-'));
  try {
    const path = join(directory, 'sbom.json');
    const payload = 'x'.repeat(2 * 1024 * 1024);
    runToFile(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({ payload: "x".repeat(2 * 1024 * 1024), marker: process.env.SBOM_MARKER }))'],
      path, { env: { SBOM_MARKER: 'complete' } });
    assert.equal(await readFile(path, 'utf8'), JSON.stringify({ payload, marker: 'complete' }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('SBOM subprocess failures still block preparation and allow a clean retry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'release-sbom-failure-'));
  try {
    const path = join(directory, 'sbom.json');
    assert.throws(() => runToFile(process.execPath, ['-e', 'process.stdout.write("partial"); process.exitCode = 7'], path), /failed \(7\)/);
    assert.throws(() => runToFile(join(directory, 'missing-command'), [], path), /ENOENT/);
    runToFile(process.execPath, ['-e', 'process.stdout.write("{}")'], path);
    assert.equal(await readFile(path, 'utf8'), '{}');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('artifact recovery validates actual bytes, not names or version strings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'release-fixture-'));
  try {
    for (const file of ARTIFACTS) await writeFile(join(directory, file), file);
    await verifyFiles(manifest(), directory);
    await writeFile(join(directory, 'package.tgz'), 'newer source under old version');
    await assert.rejects(verifyFiles(manifest(), directory), /identity mismatch/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('publication has no public effects before validation and persistence; every stage is recoverable', async () => {
  const stages = ['validate', 'recover', 'tag', 'npm', 'images', 'chart', 'promoted', 'complete'];
  for (const failure of stages) {
    const record = { manifest: manifest(), stages: {} };
    const calls = [];
    let failing = true;
    const operations = Object.fromEntries(stages.map(stage => [stage, async m => {
      assert.deepEqual(m, manifest());
      assert.ok(Object.isFrozen(m) && Object.isFrozen(m.files));
      calls.push(stage);
      if (failing && stage === failure) throw new Error(`fixture failure: ${stage}`);
    }]));
    operations.mark = async stage => { record.stages[stage] = 'done'; };
    await assert.rejects(publishStages(record, operations), /fixture failure/);
    assert.deepEqual(calls, stages.slice(0, stages.indexOf(failure) + 1));
    const saved = JSON.parse(JSON.stringify(record));
    failing = false;
    calls.length = 0;
    await publishStages(saved, operations);
    assert.deepEqual(calls, stages);
    assert.deepEqual(saved.manifest, manifest());
  }
});

test('all immutable destinations recover uncertain successful writes without overwriting', async () => {
  for (const destination of ['npm', 'Docker Hub', 'Quay', 'Helm', 'GitHub asset']) {
    let remote;
    let writes = 0;
    const operation = {
      lookup: async () => remote,
      publish: async () => { writes++; remote = { digest: 'expected' }; throw new Error('connection lost after server accepted bytes'); },
      verify: value => requireSame(value.digest, 'expected', destination),
      wait: async () => {},
    };
    await ensurePublished(operation);
    await ensurePublished(operation);
    assert.equal(writes, 1);
    remote = { digest: 'wrong' };
    await assert.rejects(ensurePublished(operation), /identity mismatch/);
    assert.equal(writes, 1);
  }
});

test('missing post-publish metadata is transient, not proof of a mismatched artifact', async () => {
  let reads = 0;
  let writes = 0;
  await ensurePublished({
    lookup: async () => ++reads < 4 ? null : { digest: 'expected' },
    publish: async () => { writes++; },
    verify: value => requireSame(value.digest, 'expected', 'npm'), wait: async () => {},
  });
  assert.equal(writes, 1);
});

test('post-publish metadata propagation outlasts the old three-attempt window', async () => {
  let reads = 0;
  let writes = 0;
  const waits = [];
  // npm registry can withhold metadata well past three lookups; publication must keep polling.
  await ensurePublished({
    lookup: async () => ++reads < 8 ? null : { digest: 'expected' },
    publish: async () => { writes++; },
    verify: value => requireSame(value.digest, 'expected', 'npm'),
    wait: async ms => { waits.push(ms); },
  });
  assert.equal(writes, 1);
  assert.ok(reads >= 8); assert.equal(waits.length, 6);
});

test('propagation polling still fails fast on a real identity mismatch', async () => {
  let reads = 0; let writes = 0;
  await assert.rejects(ensurePublished({
    lookup: async () => { reads++; return writes ? { digest: 'wrong' } : null; },
    publish: async () => { writes++; },
    verify: value => requireSame(value.digest, 'expected', 'npm'),
    wait: async () => {},
  }), /identity mismatch/);
  assert.equal(reads, 2); // published then re-read once; the mismatch is not retried away
});

const audit = (count = 0) => JSON.stringify({ vulnerabilities: {}, metadata: { vulnerabilities: {
  moderate: count, high: 0, critical: 0,
} } });
test('audit clean no-op and structured moderate assessment', () => {
  assert.equal(auditResult(audit(), 0).count, 0);
  assert.equal(auditResult(audit(1), 1).count, 1);
});
test('npm promotion exchanges OIDC and uses only a package-scoped temporary credential', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json(calls.length === 1 ? { value: 'fixture-id' } : calls.length === 2 ? { token: 'fixture-exchange' } : {});
  };
  await promoteNpmTag('@owner/package', '1.2.3', 'latest', request, {
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.actions.githubusercontent.com/token', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture-request',
  });
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /audience=npm%3Aregistry.npmjs.org/);
  assert.match(calls[1].url, /oidc\/token\/exchange\/package\/%40owner%2Fpackage/);
  assert.equal(calls[2].options.method, 'PUT');
  assert.equal(calls[2].options.headers.Authorization, 'Bearer fixture-exchange');
  await assert.rejects(promoteNpmTag('@owner/package', '1.2.3', 'latest', request, {}), /requires GitHub OIDC/);
});

test('registry and auth errors are not security findings', () => {
  assert.throws(() => auditResult('{"error":{"code":"E401"}}', 1), /registry\/auth/);
  assert.throws(() => auditResult('not json', 1), /invalid audit JSON/);
  assert.throws(() => auditResult(audit(), 2), /registry\/auth/);
});
test('progressing native fixes take precedence; stalled/failed updates allow refreshed fallback', () => {
  const now = Date.now();
  const pr = { user: { id: 49699333, login: 'dependabot[bot]' }, state: 'open',
    labels: [{ name: 'security' }], head: { sha: 'abc' }, updated_at: new Date(now).toISOString() };
  assert.equal(nativeProgressing(pr, [], now), true);
  assert.equal(nativeProgressing(pr, [{ head_sha: 'abc', conclusion: 'failure' }], now), false);
  assert.equal(nativeProgressing(pr, [], now + 3 * 60 * 60 * 1000), false);
});
