// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import type { MemoryQdrantStore } from '../services/memory/store.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { parseSquadrulesUri } from './kairos-uri.js';
import type { ExportOutput } from './export_schema.js';
import { listAdapterArtifacts } from './artifact-catalog.js';

interface ArtifactUriResolution {
  requestedUri: string;
  artifactUuid: string;
  uri: string;
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

async function sourceFromMemory(memoryStore: MemoryQdrantStore, uri: string, memoryId: string): Promise<ExportOutput> {
  const memory = await memoryStore.getMemory(memoryId);
  if (!memory) {
    throw new Error('Artifact not found');
  }
  return {
    uri,
    format: 'source',
    content_type: memory.content_type || 'text/markdown',
    content: memory.text,
    item_count: 1,
    adapter_name: memory.adapter?.name ?? null,
    adapter_version: memory.adapter?.protocol_version ?? null
  };
}

async function sourceListForAdapter(memoryStore: MemoryQdrantStore, uri: string, adapterId: string): Promise<ExportOutput> {
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
      uri: `kairos://artifact/${row.slug}`,
      uuid_uri: `kairos://artifact/${row.artifact_uuid}`,
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

  return {
    uri,
    format: 'source',
    content_type: 'application/json',
    content: JSON.stringify({ artifacts }),
    item_count: artifacts.length,
    adapter_name: null,
    adapter_version: null
  };
}

export async function executeExportSource(
  memoryStore: MemoryQdrantStore,
  qdrantService: QdrantService | undefined,
  uri: string,
  resolveAdapter: (memoryStore: MemoryQdrantStore, qdrantService: QdrantService | undefined, uri: string) => Promise<{ adapterId: string; layerId: string }>
): Promise<ExportOutput> {
  const parsedArtifact = await resolveArtifactUri(qdrantService, uri);
  if (parsedArtifact) {
    return sourceFromMemory(memoryStore, parsedArtifact.uri, parsedArtifact.artifactUuid);
  }

  const parsed = parseSquadrulesUri(uri);
  if (parsed.kind === 'adapter') {
    const { adapterId } = await resolveAdapter(memoryStore, qdrantService, uri);
    return sourceListForAdapter(memoryStore, uri, adapterId);
  }

  const { layerId } = await resolveAdapter(memoryStore, qdrantService, uri);
  return sourceFromMemory(memoryStore, uri, layerId);
}
