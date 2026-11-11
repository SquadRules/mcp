/**
 * HTTP and adapter-document helpers shared by both bakes.
 *
 * Every helper returns data instead of throwing on a non-2xx reply: a step decides
 * whether a status is a pass, a fail, or a skip, and the ledger records the numbers.
 * Only transport-level trouble (timeout, dead process) reaches the caller as a throw.
 */
import { createServer } from 'node:net';
import { FORK_SOURCE, REQUEST_TIMEOUT_MS, sha256 } from './common.mjs';

export async function request(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const text = await response.text();
  let body = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

export function postJson(url, payload) {
  return request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

/** A structurally valid adapter document: one H1, Activation Patterns, one contract fence. */
export function adapterDoc(title, marker) {
  return [
    '---',
    'version: 1.0.0',
    '---',
    '',
    `# ${title}`,
    '',
    '## Activation Patterns',
    '',
    `- ${title}`,
    '',
    '## Bake Step',
    '',
    marker,
    '',
    '```json',
    JSON.stringify({ contract: { type: 'shell', shell: { cmd: `echo ${marker}`, interpreter: 'bash' } } }),
    '```',
    '',
    '## Reward Signal',
    '',
    'Done.'
  ].join('\n');
}

/** Reserve a free port by binding and immediately releasing it. */
export function reservePort() {
  return new Promise((done, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

/**
 * Fork train — the write the bake performs.
 *
 * `executeTrain` exempts exactly two real contracts from `review_evidence`: artifact
 * trains and fork trains. A fork of the bundled `critic-loop` adapter is therefore a
 * real write that needs no fabricated critic verdict.
 */
export async function forkWrite(server, title, marker) {
  const reply = await postJson(`${server.baseUrl}/api/train`, {
    content: adapterDoc(title, marker),
    source_adapter_uri: FORK_SOURCE,
    llm_model_id: 'production-bake',
    force_update: true
  });
  const items = Array.isArray(reply.body?.['items']) ? reply.body['items'] : [];
  const first = items[0] ?? {};
  return {
    status: reply.status,
    adapterUri: typeof first['adapter_uri'] === 'string' ? first['adapter_uri'] : '',
    layerUuid: typeof first['layer_uuid'] === 'string' ? first['layer_uuid'] : '',
    body: reply.body
  };
}

/**
 * Head bytes plus the first historical snapshot. The head rebuilds the stored layers; the
 * versioned export returns the authored bytes with their own digest, so both are captured:
 * a restart that loses history still returns a head.
 */
export async function readBack(server, uri, marker) {
  const head = await postJson(`${server.baseUrl}/api/export`, { uri, format: 'markdown' });
  const history = await postJson(`${server.baseUrl}/api/export`, { uri, format: 'markdown', version: '1' });
  const headContent = typeof head.body?.['content'] === 'string' ? head.body['content'] : '';
  const historyContent = typeof history.body?.['content'] === 'string' ? history.body['content'] : '';
  return {
    headStatus: head.status,
    headSha256: headContent === '' ? '' : sha256(headContent),
    // A digest match alone repeats whatever the server returned; the marker proves the
    // bytes are the adapter this run wrote, not an older snapshot of the same entity.
    headHasMarker: headContent.includes(marker),
    historyStatus: history.status,
    historySha256:
      typeof history.body?.['snapshot_sha256'] === 'string' ? history.body['snapshot_sha256'] : '',
    recomputedHistorySha256: historyContent === '' ? '' : sha256(historyContent),
    historyVersion: history.body?.['history_version'] ?? null,
    historyVersions: history.body?.['history_versions'] ?? null,
    adapterVersion: history.body?.['adapter_version'] ?? null
  };
}

/** A read-back is complete when head and history both served and the digest is consistent. */
export function readBackComplete(read) {
  return (
    read.headStatus === 200 &&
    read.historyStatus === 200 &&
    read.headHasMarker === true &&
    read.headSha256 !== '' &&
    read.historySha256 !== '' &&
    read.historySha256 === read.recomputedHistorySha256 &&
    Number(read.historyVersions ?? 0) >= 1
  );
}
