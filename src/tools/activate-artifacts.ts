/**
 * Linked-artifact loading for activate choices.
 *
 * A choice that ships scripts must tell the agent how to obtain them, and a
 * failed lookup must never look like "this adapter has no artifacts" — the
 * caller would then run a script path it can never obtain (SquadRules/mcp#216).
 */
import type { MemoryQdrantStore } from '../services/memory/store.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { structuredLogger } from '../utils/structured-logger.js';
import { listAdapterArtifacts } from './artifact-catalog.js';
import { mintExportArtifactDownloadCapability } from '../services/export-artifact-download-capability.js';
import { resolveExportAdapter } from './export-resolve-adapter.js';
import { normalizeArtifactRelativePath } from './artifact-relative-path.js';
import { buildArtifactMaterializeInstruction } from './artifact-materialize-command.js';

export interface LinkedArtifactRow {
  slug: string;
  filename: string;
  relative_path: string;
  download_url: string;
  sha256: string;
  content_type: string;
  materialize: import('./artifact-materialize-command.js').MaterializeInstruction;
}

export interface LinkedArtifactsResult {
  linkedArtifacts: LinkedArtifactRow[];
  /** Non-null when the lookup itself failed — distinct from "this adapter ships no artifacts". */
  artifactLoadError: string | null;
}

function safeArtifactFileName(value: string): string {
  return value.replace(/[/\\]/g, '_');
}

function defaultArtifactRelativePath(fileName: string): string {
  return `artifacts/${safeArtifactFileName(fileName)}`;
}

export async function loadLinkedArtifacts(
  memoryStore: MemoryQdrantStore,
  qdrantService: QdrantService | undefined,
  adapterUri: string,
  isStdio: boolean
): Promise<LinkedArtifactsResult> {
  try {
    const { adapterId } = await resolveExportAdapter(memoryStore, qdrantService, adapterUri);
    const linkedArtifactsRaw = await listAdapterArtifacts(memoryStore, adapterId);
    const linkedArtifacts = await Promise.all(
      linkedArtifactsRaw.map(async (artifact) => {
        const normalizedRelativePath =
          artifact.relative_path && artifact.relative_path.trim().length > 0
            ? normalizeArtifactRelativePath(artifact.relative_path.trim())
            : null;
        const relativePath = normalizedRelativePath ?? defaultArtifactRelativePath(artifact.name);
        const capability = await mintExportArtifactDownloadCapability({
          artifactUuid: artifact.artifact_uuid,
          filename: artifact.name,
          contentType: artifact.content_type,
          sha256: artifact.sha256,
          relativePath
        });
        // stdio transport: no HTTP listener available; use squadrules:// artifact URI
        // so the agent calls `squadrules export` instead of curl.
        const downloadUrl = isStdio
          ? `squadrules://artifact/${artifact.slug}`
          : capability.url;
        return {
          slug: artifact.slug,
          filename: artifact.name,
          relative_path: relativePath,
          download_url: downloadUrl,
          sha256: artifact.sha256,
          content_type: artifact.content_type,
          materialize: buildArtifactMaterializeInstruction({
            transport: isStdio ? 'stdio' : 'http',
            downloadUrl,
            relativePath,
            sha256: artifact.sha256
          })
        };
      })
    );
    return { linkedArtifacts, artifactLoadError: null };
  } catch (error) {
    const artifactLoadError = error instanceof Error ? error.message : String(error);
    structuredLogger.warn(
      `[activate] failed to load linked artifacts for ${adapterUri}: ${artifactLoadError}`
    );
    return { linkedArtifacts: [], artifactLoadError };
  }
}
