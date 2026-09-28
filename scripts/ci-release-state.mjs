import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export const ARTIFACTS = ['package.tgz', 'image.oci.tar', 'chart.tgz', 'chart-config.json', 'npm-sbom.json', 'image-amd64-sbom.json', 'image-arm64-sbom.json', 'validation.json'];
export const versionPattern = /^\d+\.\d+\.\d+(?:-[a-z0-9-]+\.\d+)?$/;
export const marker = /<!-- kairos-release:([A-Za-z0-9+/=]+) -->\s*$/;
export function digest(data, algorithm = 'sha256', encoding = 'hex') {
  return createHash(algorithm).update(data).digest(encoding);
}
export async function fileDigest(file, algorithm = 'sha256', encoding = 'hex') {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}
export function assertManifest(m) {
  if (m.schema !== 1 || !versionPattern.test(m.version) || !/^[a-f0-9]{40}$/.test(m.sourceSha) ||
      typeof m.branch !== 'string' || !m.branch || !/^[a-z0-9][a-z0-9-]*$/.test(m.channel) ||
      (m.version.includes('-') ? m.channel === 'latest' || /^v?\d+$/.test(m.channel) || m.branch === 'main' : m.channel !== 'latest' || m.branch !== 'main') ||
      m.validated !== true || !/^sha256:[a-f0-9]{64}$/.test(m.imageDigest) ||
      !/^sha512-[A-Za-z0-9+/]+=*$/.test(m.npmIntegrity) ||
      !ARTIFACTS.every(file => /^[a-f0-9]{64}$/.test(m.files?.[file])) ||
      Object.keys(m.files).length !== ARTIFACTS.length) throw new Error('Invalid or unvalidated release manifest');
  return m;
}
export function releaseRecord(release) {
  const encoded = release.body?.match(marker)?.[1];
  if (!encoded) throw new Error(`Draft ${release.tag_name} has no recoverable manifest; manual migration required`);
  const record = JSON.parse(Buffer.from(encoded, 'base64').toString());
  assertManifest(record.manifest);
  if (release.tag_name !== `v${record.manifest.version}` || !Number.isSafeInteger(record.artifactId) || record.artifactId <= 0 ||
      !Number.isSafeInteger(record.runId) || record.runId <= 0) {
    throw new Error('Release record identity mismatch');
  }
  return record;
}
export function recordBody(record) {
  assertManifest(record.manifest);
  return `${record.notes || ''}\n\n<!-- kairos-release:${Buffer.from(JSON.stringify(record)).toString('base64')} -->`;
}
export function channelTags(manifest) {
  assertManifest(manifest);
  if (manifest.version.includes('-')) return [manifest.channel];
  const [major, minor] = manifest.version.split('.');
  return ['latest', major, `${major}.${minor}`];
}
export function requireSame(actual, expected, artifact) {
  if (actual !== expected) throw new Error(`${artifact} immutable identity mismatch`);
}
// Immutable writes can be accepted by the remote yet expose queryable metadata only after
// an eventual-consistency delay (npm registry propagation is the common case). Poll longer
// than the generic command retry so a completed publication is verified rather than mistaken
// for a failure that would strand the release as an unrecoverable draft. A real identity
// mismatch is still fatal and thrown on the first occurrence.
export async function ensurePublished({ lookup, publish, verify, attempts = 12, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let accepted = false;
  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      let existing = await lookup();
      if (!existing && !accepted) {
        await publish();
        accepted = true;
        existing = await lookup();
      }
      if (!existing) throw new Error('Published metadata is not yet available');
      await verify(existing);
      return existing;
    } catch (error) {
      if (/identity mismatch|Invalid|unvalidated/.test(error.message)) throw error;
      last = error;
      if (attempt < attempts) await wait(Math.min(attempt * 5000, 30000));
    }
  }
  throw last;
}
export async function recordChannel(api, manifest) {
  const ref = `notes/semantic-release-v${manifest.version}`;
  const content = JSON.stringify({ channels: [manifest.channel === 'latest' ? null : manifest.channel] });
  await ensurePublished({
    lookup: async () => {
      let note;
      try { note = await api.request(`/git/ref/${ref}`); } catch (error) { if (error.status !== 404) throw error; }
      if (!note) return null;
      const commit = await api.request(`/git/commits/${note.object.sha}`);
      const tree = await api.request(`/git/trees/${commit.tree.sha}`);
      const file = tree.tree.find(entry => entry.path === manifest.sourceSha);
      if (!file) throw new Error('Semantic-release note source identity mismatch');
      const blob = await api.request(`/git/blobs/${file.sha}`);
      return Buffer.from(blob.content, 'base64').toString().trim();
    },
    publish: async () => {
      const tree = await api.request('/git/trees', { method: 'POST', body: {
        tree: [{ path: manifest.sourceSha, mode: '100644', type: 'blob', content }],
      } });
      const commit = await api.request('/git/commits', { method: 'POST', body: {
        message: `Record semantic-release channel for v${manifest.version}`, tree: tree.sha, parents: [],
      } });
      await api.request('/git/refs', { method: 'POST', body: { ref: `refs/${ref}`, sha: commit.sha } });
    },
    verify: actual => requireSame(actual, content, 'Semantic-release channel'),
  });
}
export async function publishStages(record, operations) {
  const manifest = structuredClone(assertManifest(record.manifest));
  Object.freeze(manifest.files);
  Object.freeze(manifest);
  await operations.validate(manifest);
  await operations.recover(manifest);
  await operations.mark('persisted');
  await operations.tag(manifest);
  for (const stage of ['npm', 'images', 'chart', 'promoted']) {
    await operations[stage](manifest);
    await operations.mark(stage);
  }
  await operations.complete(manifest);
}
export async function retry(operation, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await operation(); } catch (error) {
      if (/identity mismatch|Invalid|unvalidated/.test(error.message)) throw error;
      last = error;
      if (attempt < 3) await wait(attempt * 3000);
    }
  }
  throw last;
}
