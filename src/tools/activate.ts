import crypto from 'node:crypto';
import type { MemoryQdrantStore } from '../services/memory/store.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { resolveToolDoc } from '../utils/mcp-tool-doc-runtime.js';
import { structuredLogger } from '../utils/structured-logger.js';
import { mcpToolCalls, mcpToolDuration, mcpToolErrors, mcpToolInputSize, mcpToolOutputSize } from '../services/metrics/mcp-metrics.js';
import { getTenantId, runWithOptionalSpaceAsync } from '../utils/tenant-context.js';
import { executeSearch } from './search.js';
import { activateInputSchema, activateOutputSchema, type ActivateInput, type ActivateOutput } from './activate_schema.js';
import { buildAdapterUri, parseSquadrulesUri } from './squadrules-uri.js';
import { mcpLooseToolInput } from './mcp-loose-input-schema.js';
import { mcpToolInputValidationErrorResult } from './mcp-tool-input-teaching.js';
import { mcpRateLimitErrorResult } from './mcp-runtime-error.js';
import { SQUADRULES_ACTIVATE_TOOL_UI_META } from '../mcp-apps/squadrules-ui-constants.js';
import { SQUADRULES_CREATION_FOOTER_NEXT_ACTION } from '../constants/builtin-search-meta.js';
import { SQUADRULES_LOCAL_ARTIFACT_DIRS } from '../config.js';
import { buildLocalArtifactDirFields } from './local-artifact-dir-contract.js';
import { normalizeAuthorSlug } from '../utils/protocol-slug.js';
import { listAdapterArtifacts } from './artifact-catalog.js';
import { mintExportArtifactDownloadCapability } from '../services/export-artifact-download-capability.js';
import { resolveExportAdapter } from './export-resolve-adapter.js';
import { normalizeArtifactRelativePath } from './artifact-relative-path.js';
import { activateRefinementStore } from '../services/activate-refinement-store.js';

interface RegisterActivateOptions {
  toolName?: string;
  qdrantService?: QdrantService;
}

function canonicalizeAdapterUri(
  uri: string,
  options?: { slug?: string | null }
): string {
  if (options?.slug) {
    return buildAdapterUri(options.slug);
  }
  const parsed = parseSquadrulesUri(uri);
  if (parsed.kind === 'adapter' && parsed.idKind === 'slug') {
    return buildAdapterUri(parsed.id);
  }
  throw new Error(`Adapter URI must be slug-form at emit time: ${uri}`);
}

async function mapSearchToActivate(
  memoryStore: MemoryQdrantStore,
  qdrantService: QdrantService | undefined,
  searchOutput: Awaited<ReturnType<typeof executeSearch>>,
  query: string,
  options: { executionId: string; includeRefineFooter: boolean }
): Promise<ActivateOutput> {
  const escapeShellSingleQuoted = (value: string): string => value.replace(/'/g, `'\\''`);
  const escapeShellDoubleQuoted = (value: string): string => value.replace(/["\\$`]/g, '\\$&');
  const safeArtifactFileName = (value: string): string => value.replace(/[/\\]/g, '_');
  const defaultArtifactRelativePath = (fileName: string): string => `artifacts/${safeArtifactFileName(fileName)}`;
  const materializeCommand = (url: string, relativePath: string, sha256: string): string => {
    const relForPath = escapeShellDoubleQuoted(relativePath);
    const relEscaped = escapeShellSingleQuoted(relativePath);
    const shaEscaped = escapeShellSingleQuoted(sha256);
    const urlEscaped = escapeShellSingleQuoted(url);
    const parentDir = relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : '';
    const parentDirForPath = escapeShellDoubleQuoted(parentDir);
    const mkdirPart =
      parentDir.length > 0
        ? `mkdir -p "$SQUADRULES_LOCAL_ARTIFACT_DIR/${parentDirForPath}" && `
        : '';
    return `${mkdirPart}curl -fsSL '${urlEscaped}' -o "$SQUADRULES_LOCAL_ARTIFACT_DIR/${relForPath}" && (cd "$SQUADRULES_LOCAL_ARTIFACT_DIR" && echo '${shaEscaped}  ${relEscaped}' | sha256sum -c) && chmod 700 "$SQUADRULES_LOCAL_ARTIFACT_DIR/${relForPath}"`;
  };

  const visibleChoices = options.includeRefineFooter
    ? searchOutput.choices
    : searchOutput.choices.filter((choice) => choice.role !== 'refine');

  const choices = await Promise.all(
    visibleChoices.map(async (choice) => {
      const adapterUri = canonicalizeAdapterUri(choice.uri, {
        slug: choice.slug ?? normalizeAuthorSlug(choice.adapter_name ?? choice.label)
      });
      if (choice.role === 'create') {
        return {
          uri: adapterUri,
          label: choice.label,
          adapter_name: choice.adapter_name,
          activation_score: choice.score,
          role: choice.role,
          tags: choice.tags,
          next_action: choice.role === 'create'
            ? SQUADRULES_CREATION_FOOTER_NEXT_ACTION
            : `call forward with ${adapterUri} and no solution to start the refine adapter`,
          adapter_version: choice.adapter_version,
          activation_patterns: [],
          space_name: choice.space_name ?? null,
          slug: choice.slug ?? null,
          forward_first_call: null
        };
      }
      if (choice.role === 'refine') {
        return {
          uri: adapterUri,
          label: choice.label,
          adapter_name: choice.adapter_name,
          activation_score: choice.score,
          role: choice.role,
          tags: choice.tags,
          next_action: `call forward with ${adapterUri} and no solution to start the refine adapter`,
          adapter_version: choice.adapter_version,
          activation_patterns: [],
          space_name: choice.space_name ?? null,
          slug: choice.slug ?? null,
          forward_first_call: {
            uri: adapterUri
          }
        };
      }

      const adapterLabel = choice.adapter_name ?? choice.label;
      let linkedArtifacts: Array<{
        slug: string;
        filename: string;
        relative_path: string;
        download_url: string;
        sha256: string;
        content_type: string;
        materialize: string;
      }> = [];
      try {
        const { adapterId } = await resolveExportAdapter(memoryStore, qdrantService, adapterUri);
        const linkedArtifactsRaw = await listAdapterArtifacts(memoryStore, adapterId);
        linkedArtifacts = await Promise.all(
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
            return {
              slug: artifact.slug,
              filename: artifact.name,
              relative_path: relativePath,
              download_url: capability.url,
              sha256: artifact.sha256,
              content_type: artifact.content_type,
              materialize: materializeCommand(capability.url, relativePath, artifact.sha256)
            };
          })
        );
      } catch (error) {
        structuredLogger.warn(
          `[activate] failed to load linked artifacts for ${adapterUri}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      const nextAction = linkedArtifacts.length > 0
        ? `Materialize this choice's linked_artifacts to $SQUADRULES_LOCAL_ARTIFACT_DIR, verify sha256, then call forward with ${adapterUri} and no solution to start this adapter`
        : `call forward with ${adapterUri} and no solution to start this adapter`;
      return {
        uri: adapterUri,
        label: adapterLabel,
        adapter_name: adapterLabel,
        activation_score: choice.score,
        role: choice.role,
        tags: choice.tags,
        next_action: nextAction,
        adapter_version: choice.adapter_version,
        activation_patterns: choice.activation_patterns ?? [],
        space_name: choice.space_name ?? null,
        slug: choice.slug ?? null,
        forward_first_call: {
          uri: adapterUri
        },
        ...(linkedArtifacts.length > 0 ? { linked_artifacts: linkedArtifacts } : {})
      };
    })
  );

  const groundingReminder =
    'Protocols are interfaces for AI agents. Choose the adapter that serves the human\'s real need, follow it exactly, and never fabricate proof.';

  const matchCount = choices.filter((c) => c.role === 'match').length;
  const searchMessage = searchOutput.message;
  const createOnlyMessage = (() => {
    if (matchCount === 0) {
      return 'No existing adapter/protocol matched your query. Create a new one or ask the user clarifying questions before searching again.';
    }
    if (matchCount === 1) {
      return 'Found 1 match. You can run it or create a new adapter/protocol.';
    }
    const topMatch = choices.find((c) => c.role === 'match');
    const confidencePercent = Math.round(((topMatch?.activation_score as number | null) ?? 0) * 100);
    return `Found ${matchCount} matches (top confidence: ${confidencePercent}%). Choose one or create a new adapter/protocol.`;
  })();

  return {
    must_obey: true,
    message: `${groundingReminder}\n\n${options.includeRefineFooter ? searchMessage : createOnlyMessage}`,
    next_action: "Pick one choice and follow that choice's next_action.",
    execution_id: options.executionId,
    query,
    choices,
    ...buildLocalArtifactDirFields(SQUADRULES_LOCAL_ARTIFACT_DIRS)
  };
}

export async function executeActivate(
  memoryStore: MemoryQdrantStore,
  qdrantService: QdrantService | undefined,
  input: ActivateInput
): Promise<ActivateOutput> {
  const executionId = input.execution_id ?? crypto.randomUUID();
  const refineCount = input.execution_id
    ? await activateRefinementStore.incrementRefineCount(executionId)
    : 0;
  const includeRefineFooter = !input.execution_id || refineCount <= 2;

  const searchOutput = await executeSearch(
    memoryStore,
    qdrantService,
    input,
    input.space ?? input.space_id
      ? {
          runInSpace: (fn) => runWithOptionalSpaceAsync(input.space ?? input.space_id ?? '', fn)
        }
      : undefined
  );

  return mapSearchToActivate(memoryStore, qdrantService, searchOutput, input.query, {
    executionId,
    includeRefineFooter
  });
}

export function registerActivateTool(server: any, memoryStore: MemoryQdrantStore, options: RegisterActivateOptions = {}) {
  const toolName = options.toolName || 'activate';
  const qdrantService = options.qdrantService;

  structuredLogger.debug(`activate registration inputSchema: ${JSON.stringify(activateInputSchema)}`);
  structuredLogger.debug(`activate registration outputSchema: ${JSON.stringify(activateOutputSchema)}`);

  server.registerTool(
    toolName,
    {
      title: 'Activate the best adapter',
      description: resolveToolDoc('activate') || 'Find the best adapter for the current input and return ranked activation choices.',
      inputSchema: mcpLooseToolInput(activateInputSchema),
      outputSchema: activateOutputSchema,
      _meta: SQUADRULES_ACTIVATE_TOOL_UI_META
    },
    async (params: unknown) => {
      const tenantId = getTenantId();
      mcpToolInputSize.observe({ tool: toolName, tenant_id: tenantId }, JSON.stringify(params).length);
      const timer = mcpToolDuration.startTimer({ tool: toolName, tenant_id: tenantId });

      const parsedInput = activateInputSchema.safeParse(params);
      if (!parsedInput.success) {
        mcpToolCalls.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        mcpToolErrors.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        timer({ tool: toolName, status: 'error', tenant_id: tenantId });
        return mcpToolInputValidationErrorResult('activate', parsedInput.error, params);
      }
      const input = parsedInput.data;

      try {
        const output = await executeActivate(memoryStore, qdrantService, input);
        mcpToolCalls.inc({ tool: toolName, status: 'success', tenant_id: tenantId });
        mcpToolOutputSize.observe({ tool: toolName, tenant_id: tenantId }, JSON.stringify(output).length);
        timer({ tool: toolName, status: 'success', tenant_id: tenantId });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(output) }],
          structuredContent: output
        };
      } catch (error) {
        mcpToolCalls.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        mcpToolErrors.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        timer({ tool: toolName, status: 'error', tenant_id: tenantId });
        const rateLimitResult = mcpRateLimitErrorResult(error);
        if (rateLimitResult) return rateLimitResult;
        throw error;
      }
    }
  );
}
