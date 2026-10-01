import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const accept = 'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json';
export function registries(namespace = process.env.QUAY_NAMESPACE) {
  if (!/^[a-z0-9][a-z0-9_-]+$/.test(namespace ?? '')) throw new Error('Invalid Quay namespace');
  return [
    { image: 'docker.io/squadrules/mcp', host: 'registry-1.docker.io', path: 'squadrules/mcp',
      user: process.env.DOCKER_USERNAME, password: process.env.DOCKER_PASSWORD },
    { image: `quay.io/${namespace}/mcp`, host: 'quay.io', path: `${namespace}/mcp`,
      user: process.env.QUAY_USERNAME, password: process.env.QUAY_PASSWORD },
  ];
}

export async function registryRequest(registry, resource, { missing = false } = {}) {
  const url = `https://${registry.host}/v2/${registry.path}/${resource}`;
  const headers = { Accept: accept };
  let response = await fetch(url, { headers, signal: AbortSignal.timeout(120000) });
  if (response.status === 401) {
    const challenge = response.headers.get('www-authenticate') ?? '';
    const fields = Object.fromEntries([...challenge.matchAll(/(realm|service|scope)="([^"]+)"/g)].map(m => [m[1], m[2]]));
    const realm = new URL(fields.realm);
    if (realm.protocol !== 'https:' || !['auth.docker.io', 'quay.io'].includes(realm.hostname)) throw new Error('Untrusted registry token endpoint');
    realm.searchParams.set('service', fields.service ?? registry.host);
    realm.searchParams.set('scope', fields.scope ?? `repository:${registry.path}:pull`);
    const tokenHeaders = registry.user && registry.password
      ? { Authorization: `Basic ${Buffer.from(`${registry.user}:${registry.password}`).toString('base64')}` } : {};
    const tokenResponse = await fetch(realm, { headers: tokenHeaders, signal: AbortSignal.timeout(60000) });
    if (!tokenResponse.ok) throw new Error(`Registry authentication failed: HTTP ${tokenResponse.status}`);
    const token = await tokenResponse.json();
    headers.Authorization = `Bearer ${token.token ?? token.access_token}`;
    response = await fetch(url, { headers, signal: AbortSignal.timeout(120000) });
  }
  if (missing && response.status === 404) return null;
  if (!response.ok) throw new Error(`Registry ${registry.host}: HTTP ${response.status}`);
  return response;
}

export async function remoteManifest(registry, version) {
  const response = await registryRequest(registry, `manifests/${version}`, { missing: true });
  if (!response) return null;
  const data = Buffer.from(await response.arrayBuffer());
  return { digest: `sha256:${createHash('sha256').update(data).digest('hex')}`, manifest: JSON.parse(data) };
}

export async function download(response, file) {
  if (!response.ok) throw new Error(`Artifact download failed: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
}
