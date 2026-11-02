/**
 * Linked-artifact loading for activate choices.
 *
 * A choice that ships scripts must tell the agent how to obtain them, and a
 * failed lookup must never look like "this adapter has no artifacts" — the
 * caller would then run a script path it can never obtain (SquadRules/mcp#216).
 *
 * Materialization is transport-neutral (ADR 0040): every artifact is fetched by a
 * `curl`-to-staging command from a source URL. On stdio the running server writes
 * the verified bytes to its private local cache and hands back a `file://` URL; on
 * HTTP it mints a short-lived capability URL. Destination paths are validated and
 * checked for collisions *before* any cache write or capability mint, so an unsafe
 * path or a collision fails the whole load without leaving side effects behind.
 */
import type { MemoryQdrantStore } from '../services/memory/store.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { structuredLogger } from '../utils/structured-logger.js';
import { listAdapterArtifacts, type AdapterArtifactMetadata } from './artifact-catalog.js';
import { mintExportArtifactDownloadCapability } from '../services/export-artifact-download-capability.js';
import { resolveExportAdapter } from './export-resolve-adapter.js';
import { normalizeMaterializeRelativePath, sanitizeArtifactFileName } from './artifact-relative-path.js';
import { buildArtifactMaterializeInstruction } from './artifact-materialize-command.js';
import { getArtifactLocalCache } from './artifact-local-cache.js';

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

interface ResolvedArtifact {
  artifact: AdapterArtifactMetadata;
  /** Canonical, shell-safe skill-root-relative destination validated for materialization. */
  relativePath: string;
}

/**
 * Resolve the destination path for one artifact. An explicit `relative_path` that
 * fails validation fails the load — it is never silently replaced with a default.
 * Only an absent path is synthesized as `artifacts/<safe filename>`, and the
 * synthesized value passes through the same validator before it is used.
 */
function resolveMaterializePath(artifact: AdapterArtifactMetadata): string {
  const stored = artifact.relative_path?.trim() ?? '';
  if (stored.length > 0) {
    const normalized = normalizeMaterializeRelativePath(stored);
    if (normalized === null) {
      throw new Error(
        `artifact ${artifact.artifact_uuid} ("${artifact.name}") has an unsafe relative_path ` +
          `${JSON.stringify(artifact.relative_path)}; refusing to materialize it — ` +
          're-train the artifact with a safe skill-root-relative path'
      );
    }
    return normalized;
  }
  const safeName = sanitizeArtifactFileName(artifact.name);
  if (safeName === null) {
    throw new Error(
      `artifact ${artifact.artifact_uuid} has no relative_path and its name ${JSON.stringify(artifact.name)} ` +
        'cannot be reduced to a safe filename; refusing to materialize it'
    );
  }
  const synthesized = normalizeMaterializeRelativePath(`artifacts/${safeName}`);
  if (synthesized === null) {
    throw new Error(
      `artifact ${artifact.artifact_uuid} synthesized an unsafe destination path from its name; refusing to materialize it`
    );
  }
  return synthesized;
}

/** Case-folded, Unicode-normalized key so filesystem aliases count as one destination. */
function collisionKey(relativePath: string): string {
  return relativePath.normalize('NFC').toLowerCase();
}

/**
 * Fail the whole load when two distinct artifact UUIDs target the same canonical
 * destination. UUID + SHA source identity does not resolve a destination collision
 * and there is no safe last writer, so this rejects rather than picks one — even
 * when the two digests match, and even for Unicode/case aliases of the same path.
 */
function assertNoDestinationCollisions(resolved: readonly ResolvedArtifact[]): void {
  const seen = new Map<string, string>();
  for (const { artifact, relativePath } of resolved) {
    const key = collisionKey(relativePath);
    const priorUuid = seen.get(key);
    if (priorUuid !== undefined && priorUuid !== artifact.artifact_uuid) {
      throw new Error(
        `two linked artifacts target the same destination path ${JSON.stringify(relativePath)}: ` +
          `${priorUuid} and ${artifact.artifact_uuid}; refusing to pick a last writer ` +
          '(give them distinct relative_path values and re-train)'
      );
    }
    seen.set(key, artifact.artifact_uuid);
  }
}

/** stdio: publish the whole verified batch to this process's local cache; return `file://` URLs by UUID. */
async function publishStdioCacheUrls(resolved: readonly ResolvedArtifact[]): Promise<Map<string, string>> {
  const published = await getArtifactLocalCache().publishBatch(
    resolved.map(({ artifact, relativePath }) => ({
      artifactUuid: artifact.artifact_uuid,
      sha256: artifact.sha256,
      text: artifact.text,
      relativePath,
      contentType: artifact.content_type
    }))
  );
  const urls = new Map<string, string>();
  for (const [uuid, cached] of published) {
    urls.set(uuid, cached.url);
  }
  return urls;
}

/** HTTP: mint a short-lived capability URL per artifact; return the URLs by UUID. */
async function mintHttpCapabilityUrls(resolved: readonly ResolvedArtifact[]): Promise<Map<string, string>> {
  const minted = await Promise.all(
    resolved.map(async ({ artifact, relativePath }) => {
      const capability = await mintExportArtifactDownloadCapability({
        artifactUuid: artifact.artifact_uuid,
        filename: artifact.name,
        contentType: artifact.content_type,
        sha256: artifact.sha256,
        relativePath
      });
      return [artifact.artifact_uuid, capability.url] as const;
    })
  );
  return new Map(minted);
}

export async function loadLinkedArtifacts(
  memoryStore: MemoryQdrantStore,
  qdrantService: QdrantService | undefined,
  adapterUri: string,
  isStdio: boolean
): Promise<LinkedArtifactsResult> {
  try {
    const { adapterId } = await resolveExportAdapter(memoryStore, qdrantService, adapterUri);
    const artifacts = await listAdapterArtifacts(memoryStore, adapterId);

    // Preflight before any side effect: resolve + validate every destination and
    // reject collisions, so a bad path or a clash leaves no cache write or mint.
    const resolved: ResolvedArtifact[] = artifacts.map((artifact) => ({
      artifact,
      relativePath: resolveMaterializePath(artifact)
    }));
    assertNoDestinationCollisions(resolved);

    const urlByUuid = isStdio ? await publishStdioCacheUrls(resolved) : await mintHttpCapabilityUrls(resolved);

    const linkedArtifacts = resolved.map<LinkedArtifactRow>(({ artifact, relativePath }) => {
      const url = urlByUuid.get(artifact.artifact_uuid);
      if (url === undefined) {
        throw new Error(`no materialize URL was prepared for artifact ${artifact.artifact_uuid}`);
      }
      return {
        slug: artifact.slug,
        filename: artifact.name,
        relative_path: relativePath,
        download_url: url,
        sha256: artifact.sha256,
        content_type: artifact.content_type,
        materialize: buildArtifactMaterializeInstruction({
          url,
          relativePath,
          sha256: artifact.sha256
        })
      };
    });
    return { linkedArtifacts, artifactLoadError: null };
  } catch (error) {
    const artifactLoadError = error instanceof Error ? error.message : String(error);
    structuredLogger.warn(
      `[activate] failed to load linked artifacts for ${adapterUri}: ${artifactLoadError}`
    );
    return { linkedArtifacts: [], artifactLoadError };
  }
}
