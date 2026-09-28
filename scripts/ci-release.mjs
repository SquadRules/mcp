import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, openSync, closeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { GitHub, gateRuns, output, report } from './ci-automation.mjs';
import { ARTIFACTS, assertManifest, fileDigest, digest, releaseRecord, recordBody, channelTags, requireSame, retry, versionPattern, ensurePublished, publishStages, recordChannel } from './ci-release-state.mjs';
import { registries, remoteManifest, registryRequest, download } from './ci-registry.mjs';
import { promoteNpmTag } from './ci-npm.mjs';

const dir = '.local/release';
const packageName = '@jakub-plichcinski/kairos-mcp';
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
  copyFileSync(`dist/jakub-plichcinski-kairos-mcp-${plan.version}.tgz`, `${dir}/package.tgz`);
  runToFile('npm', ['sbom', '--sbom-format', 'cyclonedx'], `${dir}/npm-sbom.json`, { env });
  run('node', ['scripts/helm-set-release-version.mjs', plan.version], { env });
  run('helm', ['repo', 'add', 'qdrant', 'https://qdrant.github.io/qdrant-helm']);
  run('helm', ['repo', 'add', 'valkey', 'https://valkey.io/valkey-helm/']);
  run('helm', ['dependency', 'build', 'helm/kairos-mcp']);
  run('helm', ['lint', 'helm/kairos-mcp', '--strict']);
  run('helm', ['package', 'helm/kairos-mcp', '--destination', dir]);
  copyFileSync(`${dir}/kairos-mcp-${plan.version}.tgz`, `${dir}/chart.tgz`);
  save(`${dir}/chart-config.json`, { name: 'kairos-mcp', version: plan.version, appVersion: plan.version, apiVersion: 'v2', type: 'application' });
}

function prepareImages() {
  const plan = json(`${dir}/plan.json`);
  requireSame(source(), plan.sourceSha, 'Image source');
  mkdirSync('.ci/docker', { recursive: true });
  copyFileSync(`${dir}/package.tgz`, '.ci/docker/package.tgz');
  run('docker', ['buildx', 'build', '--platform', 'linux/amd64,linux/arm64', '--target', 'runtime-ci',
    '--build-arg', `PACKAGE_VERSION=${plan.version}`, '--label', `org.opencontainers.image.revision=${plan.sourceSha}`,
    '--label', `org.opencontainers.image.version=${plan.version}`, '--provenance=false', '--sbom=false',
    '--output', `type=oci,dest=${dir}/image.oci.tar`, '.'], { env: noCredentials() });
  for (const arch of ['amd64', 'arm64']) {
    run('skopeo', ['copy', '--override-os', 'linux', '--override-arch', arch,
      `oci-archive:${dir}/image.oci.tar`, `docker-archive:${dir}/scan-${arch}.tar:kairos-scan:${arch}`]);
    run('docker', ['load', '--input', `${dir}/scan-${arch}.tar`]);
    const actual = run('docker', ['run', '--rm', '--platform', `linux/${arch}`, '--entrypoint', 'node', `kairos-scan:${arch}`,
      '-p', `require('./node_modules/${packageName}/package.json').version`], { capture: true }).toString().trim();
    requireSame(actual, plan.version, `Image ${arch} package version`);
    run('docker', ['run', '--rm', '--platform', `linux/${arch}`, '--entrypoint', 'node', `kairos-scan:${arch}`,
      `node_modules/${packageName}/dist/cli/index.js`, 'serve', '--help']);
  }
}

async function seal() {
  const plan = json(`${dir}/plan.json`);
  requireSame(source(), plan.sourceSha, 'Validated source');
  if (process.env.VALIDATION_PASSED !== 'true') throw new Error('Validation is required before sealing artifacts');
  for (const arch of ['amd64', 'arm64']) {
    runToFile('trivy', ['image', '--input', `${dir}/scan-${arch}.tar`,
      '--format', 'cyclonedx', '--scanners', 'vuln'], `${dir}/image-${arch}-sbom.json`);
  }
  save(`${dir}/validation.json`, { sourceSha: plan.sourceSha, version: plan.version, packedConsumer: true,
    helm: true, platforms: ['linux/amd64', 'linux/arm64'], imageSmoke: true, trivy: 'CRITICAL,HIGH', runId: process.env.GITHUB_RUN_ID });
  const files = {};
  for (const file of ARTIFACTS) files[file] = await fileDigest(`${dir}/${file}`);
  const manifest = assertManifest({ schema: 1, ...plan, files, validated: true,
    imageDigest: `sha256:${digest(run('skopeo', ['inspect', '--raw', `oci-archive:${dir}/image.oci.tar`], { capture: true }))}`,
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
  await api.request(`/releases/${release.id}`, { method: 'PATCH', body: { body: recordBody(record) } });
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
    publish: async () => run('npm', ['publish', `${dir}/package.tgz`, '--access', 'public', '--provenance', '--ignore-scripts',
      '--tag', `pending-${manifest.version}`], { env: { ...noCredentials(), GITHUB_SHA: manifest.sourceSha, GITHUB_REF: `refs/heads/${manifest.branch}` } }),
    verify: existing => requireSame(existing.dist?.integrity, manifest.npmIntegrity, 'npm package'),
  });
}

async function publishImages(manifest, targets) {
  for (const target of targets) {
    await ensurePublished({
      lookup: () => remoteManifest(target, manifest.version),
      publish: async () => run('skopeo', ['copy', '--all', '--preserve-digests', '--authfile', `${process.env.HOME}/.docker/config.json`,
        `oci-archive:${dir}/image.oci.tar`, `docker://${target.image}:${manifest.version}`]),
      verify: existing => requireSame(existing.digest, manifest.imageDigest, target.image),
    });
    await retry(async () => {
      run('cosign', ['sign', '--yes', `${target.image}@${manifest.imageDigest}`]);
      run('cosign', ['verify', '--certificate-identity', `https://github.com/${process.env.GITHUB_WORKFLOW_REF}`,
        '--certificate-oidc-issuer', 'https://token.actions.githubusercontent.com', `${target.image}@${manifest.imageDigest}`]);
    });
  }
}

async function publishChart(manifest, target) {
  const chart = { ...target, path: `${process.env.QUAY_NAMESPACE}/kairos-mcp-chart`, image: `quay.io/${process.env.QUAY_NAMESPACE}/kairos-mcp-chart` };
  await ensurePublished({
    lookup: () => remoteManifest(chart, manifest.version),
    publish: async () => run('oras', ['push', `${chart.image}:${manifest.version}`, '--config', `${dir}/chart-config.json:application/vnd.cncf.helm.config.v1+json`,
      `${dir}/chart.tgz:application/vnd.cncf.helm.chart.content.v1.tar+gzip`]),
    verify: async existing => {
      const layer = existing.manifest.layers?.find(l => l.mediaType === 'application/vnd.cncf.helm.chart.content.v1.tar+gzip');
      requireSame(layer?.digest, `sha256:${manifest.files['chart.tgz']}`, 'Helm chart');
      requireSame(existing.manifest.config?.digest, `sha256:${manifest.files['chart-config.json']}`, 'Helm config');
      const response = await registryRequest(chart, `blobs/${layer.digest}`);
      requireSame(digest(Buffer.from(await response.arrayBuffer())), manifest.files['chart.tgz'], 'Published Helm payload');
    },
  });
}

async function promote(manifest, targets) {
  requireSame((await npmVersion(manifest.version))?.dist?.integrity, manifest.npmIntegrity, 'npm promotion');
  for (const target of targets) {
    requireSame((await remoteManifest(target, manifest.version))?.digest, manifest.imageDigest, 'Image promotion source');
    for (const tag of channelTags(manifest)) {
      await retry(async () => {
        run('skopeo', ['copy', '--all', '--preserve-digests', '--authfile', `${process.env.HOME}/.docker/config.json`,
          `docker://${target.image}@${manifest.imageDigest}`, `docker://${target.image}:${tag}`]);
        requireSame((await remoteManifest(target, tag))?.digest, manifest.imageDigest, `Alias ${tag}`);
      });
    }
  }
  await retry(async () => {
    await promoteNpmTag(packageName, manifest.version, manifest.channel);
    const response = await fetch(`https://registry.npmjs.org/-/package/${encodeURIComponent(packageName)}/dist-tags`);
    if (!response.ok) throw new Error(`npm dist-tags: HTTP ${response.status}`);
    requireSame((await response.json())[manifest.channel], manifest.version, 'npm dist-tag');
  });
}

async function publish() {
  const api = new GitHub();
  const release = await draft(api);
  const record = releaseRecord(release);
  const targets = registries();
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
      await recordChannel(api, manifest);
    },
    npm: publishNpm,
    images: manifest => publishImages(manifest, targets),
    chart: manifest => publishChart(manifest, targets[1]),
    promoted: manifest => promote(manifest, targets),
    complete: async manifest => {
      const published = await api.request(`/releases/${release.id}`, { method: 'PATCH', body: {
        draft: false, make_latest: manifest.version.includes('-') ? 'false' : 'true', body: recordBody(record),
      } });
      if (published.draft || !published.published_at) throw new Error('GitHub Release promotion was not confirmed');
      report({ state: 'published', sourceSha: manifest.sourceSha, version: manifest.version, imageDigest: manifest.imageDigest });
    },
  });
}

async function main() {
  mkdirSync(dir, { recursive: true });
  const command = process.argv[2];
  if (command === 'resolve') return resolve();
  if (command === 'plan') return plan();
  if (command === 'package') return preparePackage();
  if (command === 'images') return prepareImages();
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
