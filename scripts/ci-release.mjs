import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, openSync, closeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { GitHub, gateRuns, output, report } from './ci-automation.mjs';
import { ARTIFACTS, assertManifest, fileDigest, digest, releaseRecord, recordBody, requireSame, versionPattern, ensurePublished, publishStages, recordChannel } from './ci-release-state.mjs';
import { download } from './ci-registry.mjs';

const dir = '.local/release';
const packageName = '@squadrules/mcp';
function json(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function save(path, value) { writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); }
function run(command, args, { capture = false, ...options } = {}) {
  const result = spawnSync(command, args, { stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.error?.message})`);
  return capture ? result.stdout : undefined;
}
export function runToFile(command, args, path, options = {}) {
  // SBOMs exceed spawnSync's capture buffer; write bytes directly to the artifact.
  const fd = openSync(path, 'w');
  try {
    run(command, args, { ...options, stdio: ['ignore', fd, 'inherit'] });
  } finally {
    closeSync(fd);
  }
}
function noCredentials() {
  const env = { ...process.env };
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'DOCKER_PASSWORD', 'QUAY_PASSWORD']) delete env[key];
  return env;
}
function source() {
  const sha = run('git', ['rev-parse', 'HEAD'], { capture: true }).toString().trim();
  requireSame(sha, process.env.SOURCE_SHA, 'Source SHA');
  return sha;
}
async function gates(api, sha, branch) {
  const runs = await api.pages(`/actions/runs?head_sha=${sha}`, 'workflow_runs');
  return gateRuns(runs, { sha, branch, repo: api.repo, event: branch === 'main' ? 'push' : 'workflow_dispatch' });
}

async function resolve() {
  const api = new GitHub();
  const event = process.env.GITHUB_EVENT_PATH ? json(process.env.GITHUB_EVENT_PATH) : {};
  if (process.env.GITHUB_EVENT_NAME === 'workflow_run' &&
      (event.workflow_run?.head_branch !== 'main' || event.workflow_run?.event !== 'push' ||
       event.workflow_run?.head_repository?.full_name !== api.repo)) {
    output({ skip: true }); return report({ state: 'ignored', reason: 'not a trusted main validation event' });
  }
  const releases = await api.pages('/releases');
  // An interrupted run can leave a release whose git tag was created but whose GitHub
  // publication never reached `complete`; GitHub then detaches it to an unrecoverable
  // "untagged-*" draft (our identity checks require tag_name vX). Delete those orphans so
  // they cannot pile up on the Releases page or force a fresh version reservation each run.
  // Genuine in-flight drafts keep tag_name vX and are preserved for recovery below.
  for (const orphan of releases.filter(r => r.draft && /^untagged-/.test(r.tag_name ?? ''))) {
    await api.request(`/releases/${orphan.id}`, { method: 'DELETE' });
  }
  const drafts = releases.filter(r => r.draft && /^v\d+\./.test(r.tag_name))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const recovery = drafts[0];
  let branch = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' ? process.env.GITHUB_REF_NAME : 'main';
  if (!branch || process.env.GITHUB_REF_TYPE === 'tag') throw new Error('Release requires a branch');
  let sha;
  if (recovery) {
    const record = releaseRecord(recovery);
    sha = record.manifest.sourceSha;
    branch = record.manifest.branch;
  } else {
    sha = (await api.request(`/branches/${encodeURIComponent(branch)}`)).commit.sha;
  }
  const validation = await gates(api, sha, branch);
  report({ state: validation.ready ? 'ready' : 'deferred', sourceSha: sha, branch, recovery: recovery?.id, ...validation });
  output({ skip: !validation.ready, sha, branch, recovery: recovery?.id ?? '' });
  if (validation.gates.some(g => g.status === 'completed' && g.conclusion !== 'success')) {
    throw new Error('Exact-source release validation failed; publication is blocked');
  }
}

async function plan() {
  const sha = source();
  const { default: semanticRelease } = await import('semantic-release');
  const { default: config } = await import('../release.config.mjs');
  const result = await semanticRelease({ ...config, dryRun: true, ci: true }, {
    env: { ...process.env, GITHUB_REF: `refs/heads/${process.env.RELEASE_BRANCH}`, GITHUB_SHA: sha },
  });
  if (!result) { output({ skip: true }); return report({ state: 'no-release', sourceSha: sha }); }
  const { version, channel, type, notes } = result.nextRelease;
  if (!versionPattern.test(version)) throw new Error('Invalid semantic-release version');
  const value = { sourceSha: sha, branch: process.env.RELEASE_BRANCH, version, channel: channel || 'latest', type, notes };
  save(`${dir}/plan.json`, value);
  output({ skip: process.env.DRY_RUN === 'true' && process.env.VALIDATE_ARTIFACTS !== 'true', version });
  report({ state: 'planned', ...value });
}

function preparePackage() {
  const plan = json(`${dir}/plan.json`);
  requireSame(source(), plan.sourceSha, 'Planned source');
  const env = noCredentials();
  run('npm', ['version', plan.version, '--no-git-tag-version', '--allow-same-version', '--ignore-scripts'], { env });
  run('npm', ['run', 'version:sync'], { env });
  run('npm', ['run', 'prepare:publish'], { env });
  copyFileSync(`dist/squadrules-mcp-${plan.version}.tgz`, `${dir}/package.tgz`);
  runToFile('npm', ['sbom', '--sbom-format', 'cyclonedx'], `${dir}/npm-sbom.json`, { env });
  // Helm chart packaging/publishing moved to the SquadRules/charts repository. This
  // pipeline produces only the npm tarball and the runtime images; there is no Helm
  // dependency here anymore.
}

async function seal() {
  const plan = json(`${dir}/plan.json`);
  requireSame(source(), plan.sourceSha, 'Validated source');
  if (process.env.VALIDATION_PASSED !== 'true') throw new Error('Validation is required before sealing artifacts');
  save(`${dir}/validation.json`, { sourceSha: plan.sourceSha, version: plan.version, packedConsumer: true,
    runId: process.env.GITHUB_RUN_ID });
  const files = {};
  for (const file of ARTIFACTS) files[file] = await fileDigest(`${dir}/${file}`);
  const manifest = assertManifest({ schema: 1, ...plan, files, validated: true,
    npmIntegrity: `sha512-${await fileDigest(`${dir}/package.tgz`, 'sha512', 'base64')}` });
  save(`${dir}/manifest.json`, manifest);
  report(manifest);
}

export async function verifyFiles(manifest, directory = dir) {
  assertManifest(manifest);
  for (const file of ARTIFACTS) requireSame(await fileDigest(`${directory}/${file}`), manifest.files[file], file);
}

async function draft(api) {
  if (process.env.RECOVERY_ID) return api.request(`/releases/${process.env.RECOVERY_ID}`);
  const manifest = assertManifest(json(`${dir}/manifest.json`));
  await verifyFiles(manifest);
  const drafts = (await api.pages('/releases')).filter(r => r.draft && /^v\d+\./.test(r.tag_name));
  if (drafts.length) throw new Error('An incomplete release must be recovered before reserving a new version');
  const artifactId = Number(process.env.RECOVERY_ARTIFACT_ID);
  if (!Number.isSafeInteger(artifactId) || artifactId <= 0) throw new Error('Immutable recovery artifact is required');
  const record = { manifest, artifactId, runId: Number(process.env.GITHUB_RUN_ID), notes: manifest.notes, stages: {} };
  return api.request('/releases', { method: 'POST', body: { tag_name: `v${manifest.version}`,
    target_commitish: manifest.sourceSha, name: `v${manifest.version}`, body: recordBody(record),
    draft: true, prerelease: manifest.version.includes('-') } });
}

async function recover(api, release, record) {
  const manifest = record.manifest;
  requireSame(source(), manifest.sourceSha, 'Recovery source');
  const assets = await api.pages(`/releases/${release.id}/assets`);
  const missing = ARTIFACTS.filter(file => !existsSync(`${dir}/${file}`));
  const unavailable = missing.some(file => !assets.some(a => a.name === file));
  if (unavailable) {
    const artifact = await api.request(`/actions/artifacts/${record.artifactId}`);
    const originalRun = await api.request(`/actions/runs/${record.runId}`);
    if (artifact.expired || artifact.workflow_run?.id !== record.runId ||
        originalRun.path !== '.github/workflows/release.yml' ||
        !['schedule', 'workflow_run', 'workflow_dispatch'].includes(originalRun.event) ||
        originalRun.head_repository?.full_name !== api.repo) throw new Error('Recovery artifact expired or has an untrusted producer');
    const response = await fetch(`https://api.github.com/repos/${api.repo}/actions/artifacts/${record.artifactId}/zip`, {
      headers: { Authorization: `Bearer ${api.token}` }, signal: AbortSignal.timeout(600000),
    });
    await download(response, `${dir}/recovery.zip`);
    const entries = run('unzip', ['-Z1', `${dir}/recovery.zip`], { capture: true }).toString().trim().split('\n');
    if (entries.some(entry => ![...ARTIFACTS, 'manifest.json', 'plan.json'].includes(entry))) throw new Error('Invalid recovery archive paths');
    run('unzip', ['-o', `${dir}/recovery.zip`, '-d', dir]);
  } else {
    for (const file of missing) {
      const asset = assets.find(a => a.name === file);
      const response = await fetch(`https://api.github.com/repos/${api.repo}/releases/assets/${asset.id}`, {
        headers: { Authorization: `Bearer ${api.token}`, Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(600000),
      });
      await download(response, `${dir}/${file}`);
    }
  }
  await verifyFiles(manifest);
  save(`${dir}/manifest.json`, manifest);
  for (const file of [...ARTIFACTS, 'manifest.json']) {
    const expected = await fileDigest(`${dir}/${file}`);
    await ensurePublished({
      lookup: async () => (await api.pages(`/releases/${release.id}/assets`)).find(a => a.name === file),
      publish: async () => run('gh', ['release', 'upload', release.tag_name, `${dir}/${file}`, '--repo', api.repo]),
      verify: async existing => {
        if (existing.digest) requireSame(existing.digest, `sha256:${expected}`, `GitHub asset ${file}`);
        else {
          const data = await api.request(`/releases/assets/${existing.id}`, { accept: 'application/octet-stream' });
          requireSame(digest(data), expected, `GitHub asset ${file}`);
        }
      },
    });
  }
}

async function mark(api, release, record, stage) {
  record.stages[stage] = new Date().toISOString();
  await api.request(`/releases/${release.id}`, { method: 'PATCH', body: { tag_name: `v${record.manifest.version}`, body: recordBody(record) } });
  report({ sourceSha: record.manifest.sourceSha, version: record.manifest.version, stages: record.stages });
}

async function npmVersion(version) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/${version}`, { signal: AbortSignal.timeout(60000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`npm metadata: HTTP ${response.status}`);
  return response.json();
}

async function publishNpm(manifest) {
  await ensurePublished({
    lookup: () => npmVersion(manifest.version),
    // npm OIDC authorizes only `npm publish`, which sets the version's dist-tag directly.
    publish: async () => run('npm', ['publish', `${dir}/package.tgz`, '--access', 'public', '--provenance', '--ignore-scripts',
      '--tag', manifest.channel], { env: { ...noCredentials(), GITHUB_SHA: manifest.sourceSha, GITHUB_REF: `refs/heads/${manifest.branch}` } }),
    verify: existing => requireSame(existing.dist?.integrity, manifest.npmIntegrity, 'npm package'),
    attempts: 30, // npm's post-publish provenance pass keeps the version unqueryable for minutes; this slowest registry gets the widest still-capped poll (mismatches fast-fail)
  });
}

// Image publication (Docker Hub + quay), cosign signing, alias promotion and the Helm chart
// all moved out of this pipeline: images are built FROM the published npm package by
// SquadRules/containers, and the chart lives in SquadRules/charts. The npm release therefore
// has a single publication stage (`npm`); the channel dist-tag is set atomically by
// `npm publish --tag <channel>`.

async function publish() {
  const api = new GitHub();
  const release = await draft(api);
  const record = releaseRecord(release);
  await publishStages(record, {
    validate: async manifest => {
      if (!(await gates(api, manifest.sourceSha, manifest.branch)).ready) throw new Error('Exact-source release validations are not successful');
    },
    recover: () => recover(api, release, record),
    mark: stage => mark(api, release, record, stage),
    tag: async manifest => {
      let tag;
      try { tag = await api.request(`/git/ref/tags/v${manifest.version}`); } catch (error) { if (error.status !== 404) throw error; }
      if (tag) requireSame(tag.object.sha, manifest.sourceSha, 'Git tag');
      else await api.request('/git/refs', { method: 'POST', body: { ref: `refs/tags/v${manifest.version}`, sha: manifest.sourceSha } });
      // A draft made before its ref exists is keyed to an untagged-<id> placeholder, and any later release PATCH that omits tag_name re-detaches it; mark()/complete() therefore re-submit tag_name on every write.
      await recordChannel(api, manifest);
    },
    npm: publishNpm,
    complete: async manifest => {
      const tag = `v${manifest.version}`;
      const published = await api.request(`/releases/${release.id}`, { method: 'PATCH', body: {
        tag_name: tag, draft: false, make_latest: manifest.version.includes('-') ? 'false' : 'true', body: recordBody(record),
      } });
      if (published.draft || !published.published_at) throw new Error('GitHub Release promotion was not confirmed');
      requireSame((await api.request(`/releases/tags/${tag}`)).id, release.id, 'GitHub release tag binding');
      report({ state: 'published', sourceSha: manifest.sourceSha, version: manifest.version });
    },
  });
}

async function main() {
  mkdirSync(dir, { recursive: true });
  const command = process.argv[2];
  if (command === 'resolve') return resolve();
  if (command === 'plan') return plan();
  if (command === 'package') return preparePackage();
  if (command === 'seal') return seal();
  if (command === 'publish') {
    // Release runs by default and is not governed by vars.AUTOMATION_ENABLED (which only
    // pauses the dependency producers/controller). A dry run never publishes.
    if (process.env.DRY_RUN === 'true') throw new Error('Publishing is disabled (dry run)');
    return publish();
  }
  throw new Error('Unknown release command');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
