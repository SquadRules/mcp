import { getAuthHeaders, getTestAuthBaseUrl } from './auth-headers.js';
import type { McpClientConnection } from './mcp-client-utils.js';
import { parseMcpJson } from './expect-with-raw.js';
import { BASE_URL, CLI_PATH, execAsync } from '../integration/cli-commands-shared.js';

interface DeletePayload {
  total_deleted: number;
  total_failed: number;
  results: Array<{ uri: string; status: string; message: string }>;
}

function assertDeleteOk(payload: DeletePayload, label: string): void {
  if (typeof payload.total_failed !== 'number' || payload.total_failed > 0) {
    throw new Error(`${label}: delete failed or invalid payload: ${JSON.stringify(payload)}`);
  }
}

const API_BASE = `${getTestAuthBaseUrl()}/api`;
const UUID_RE = /^[0-9a-f-]{36}$/i;

function uniqUris(input: string[]): string[] {
  return [...new Set(input.map((v) => v.trim()).filter((v) => v.length > 0))];
}

function toLayerUriFromArtifactUri(uri: string): string {
  if (uri.startsWith('squadrules://layer/')) return uri;
  if (uri.startsWith('squadrules://artifact/')) {
    const id = uri.slice('squadrules://artifact/'.length).trim();
    return UUID_RE.test(id) ? `squadrules://layer/${id}` : '';
  }
  return uri;
}

function cleanupUris(adapterUri: string, artifactUris: string[]): string[] {
  const layers = artifactUris.map(toLayerUriFromArtifactUri).filter((v) => v.length > 0);
  return uniqUris([adapterUri, ...layers]);
}

export async function cleanupViaApi(adapterUri: string, artifactUris: string[]): Promise<void> {
  const uris = cleanupUris(adapterUri, artifactUris);
  const res = await fetch(`${API_BASE}/delete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders()
    },
    body: JSON.stringify({ uris })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API cleanup failed (${res.status}): ${body}`);
  }
  const payload = (await res.json()) as DeletePayload;
  assertDeleteOk(payload, 'API cleanup');
}

export async function cleanupViaMcp(
  mcp: Pick<McpClientConnection, 'client'>,
  adapterUri: string,
  artifactUris: string[]
): Promise<void> {
  const uris = cleanupUris(adapterUri, artifactUris);
  const result = await mcp.client.callTool({ name: 'delete', arguments: { uris } });
  const payload = parseMcpJson(result, 'artifact fixture cleanup delete') as DeletePayload;
  assertDeleteOk(payload, 'MCP cleanup');
}

export async function cleanupViaCli(
  adapterUri: string,
  artifactUris: string[],
  runExec: typeof execAsync = execAsync
): Promise<void> {
  const uris = cleanupUris(adapterUri, artifactUris);
  const cmd = `node ${CLI_PATH} delete --url ${BASE_URL} ${uris.join(' ')}`;
  const { stdout, stderr } = await runExec(cmd);
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error(`CLI cleanup empty stdout (stderr: ${stderr})`);
  }
  const payload = JSON.parse(trimmed) as DeletePayload;
  assertDeleteOk(payload, 'CLI cleanup');
}
