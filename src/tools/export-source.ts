import type { MemoryQdrantStore } from '../services/memory/store.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { parseSquadrulesUri } from './squadrules-uri.js';
import type { ExportOutput } from './export_schema.js';
import { listAdapterArtifacts } from './artifact-catalog.js';
import { sha256Hex } from './skill-export/sha256.js';

interface ArtifactUriResolution {
  requestedUri: string;
  artifactUuid: string;
  uri: string;
}

type ExportDelivery = 'download_ref' | 'inline_base64';

/**
 * Digest over the stored UTF-8 bytes, so the value matches `sha256sum` of the
 * materialized file whichever encoding carries them.
 */
function encodeSourcePayload(text: string, delivery: ExportDelivery | undefined): Pick<ExportOutput, 'content' | 'content_encoding' | 'sha256'> {
  const sha256 = sha256Hex(text);
  if (delivery !== 'inline_base64') {
    return { content: text, sha256 };
  }
  return { content: Buffer.from(text, 'utf8').toString('base64'), content_encoding: 'base64', sha256 };
}

async function resolveArtifactUri(qdrantService: QdrantService | undefined, uri: string): Promise<ArtifactUriResolution | null> {
  const parsed = parseSquadrulesUri((uri || '').trim());
  if (parsed.kind !== 'artifact') return null;
  if (parsed.idKind === 'uuid') {
    return { requestedUri: uri, artifactUuid: parsed.id, uri };
  }
  if (!qdrantService) {
    throw new Error('Artifact slug lookup is unavailable');
  }
  const resolved = await qdrantService.findArtifactMemoryUuidBySlug(parsed.id);
  if (resolved.disambiguation_note) {
    throw new Error(resolved.disambiguation_note);
  }
  if (!resolved.artifactUuid) {
    throw new Error(`Artifact slug "${parsed.id}" not found`);
  }
  return {
    requestedUri: uri,
    artifactUuid: resolved.artifactUuid,
    uri
  };
}

async function sourceFromMemory(
  memoryStore: MemoryQdrantStore,
  uri: string,
  memoryId: string,
  delivery: ExportDelivery | undefined
): Promise<ExportOutput> {
  const memory = await memoryStore.getMemory(memoryId);
  if (!memory) {
    throw new Error('Artifact not found');
  }
  return {
    uri,
    format: 'source',
    content_type: memory.content_type || 'text/markdown',
    ...encodeSourcePayload(memory.text, delivery),
    item_count: 1,
    adapter_name: memory.adapter?.name ?? null,
    adapter_version: memory.adapter?.protocol_version ?? null
  };
}

async function sourceListForAdapter(
  memoryStore: MemoryQdrantStore,
  uri: string,
  adapterId: string,
  delivery: ExportDelivery | undefined
): Promise<ExportOutput> {
  const artifacts: Array<{
    uri: string;
    uuid_uri: string;
    artifact_uuid: string;
    label: string;
    slug: string;
    version: string;
    sha256: string;
    name: string;
    content_type: string;
    tags: string[];
    relative_path: string | null;
  }> = [];
  const rows = await listAdapterArtifacts(memoryStore, adapterId);
  for (const row of rows) {
    artifacts.push({
      uri: `squadrules://artifact/${row.slug}`,
      uuid_uri: `squadrules://artifact/${row.artifact_uuid}`,
      artifact_uuid: row.artifact_uuid,
      label: row.label,
      slug: row.slug,
      version: row.version,
      sha256: row.sha256,
      name: row.name,
      content_type: row.content_type,
      tags: row.tags,
      relative_path: row.relative_path
    });
  }

  const json = JSON.stringify({ artifacts });
  return {
    uri,
    format: 'source',
    content_type: 'application/json',
    ...encodeSourcePayload(json, delivery),
    item_count: artifacts.length,
    adapter_name: null,
    adapter_version: null
  };
}

export async function executeExportSource(
  memoryStore: MemoryQdrantStore,
  qdrantService: QdrantService | undefined,
  uri: string,
  resolveAdapter: (memoryStore: MemoryQdrantStore, qdrantService: QdrantService | undefined, uri: string) => Promise<{ adapterId: string; layerId: string }>,
  delivery?: ExportDelivery
): Promise<ExportOutput> {
  const parsedArtifact = await resolveArtifactUri(qdrantService, uri);
  if (parsedArtifact) {
    return sourceFromMemory(memoryStore, parsedArtifact.uri, parsedArtifact.artifactUuid, delivery);
  }

  const parsed = parseSquadrulesUri(uri);
  if (parsed.kind === 'adapter') {
    const { adapterId } = await resolveAdapter(memoryStore, qdrantService, uri);
    return sourceListForAdapter(memoryStore, uri, adapterId, delivery);
  }

  const { layerId } = await resolveAdapter(memoryStore, qdrantService, uri);
  return sourceFromMemory(memoryStore, uri, layerId, delivery);
}
