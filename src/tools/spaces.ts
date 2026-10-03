/**
 * List the agent's available spaces with human-readable names,
 * adapter counts per space, and optionally adapter titles and layer counts.
 */

import type { MemoryQdrantStore } from '../services/memory/store.js';
import { resolveToolDoc } from '../utils/mcp-tool-doc-runtime.js';
import { mcpToolCalls, mcpToolDuration, mcpToolErrors, mcpToolInputSize, mcpToolOutputSize } from '../services/metrics/mcp-metrics.js';
import { getTenantId, getSpaceContextFromStorage } from '../utils/tenant-context.js';
import { buildSpaceFilter } from '../utils/space-filter.js';
import { spaceIdToDisplayName, spaceKindFromSpaceId } from '../utils/space-display.js';
import { SQUADRULES_APP_SPACE_ID } from '../config.js';
import { SQUADRULES_SPACES_TOOL_UI_META } from '../mcp-apps/squadrules-ui-constants.js';
import { structuredLogger } from '../utils/structured-logger.js';
import { normalizeAuthorSlug, slugifyFromTitle } from '../utils/protocol-slug.js';
import { buildAdapterUri } from './squadrules-uri.js';
import { spacesInputSchema, spacesOutputSchema } from './spaces_schema.js';
import { mcpLooseToolInput } from './mcp-loose-input-schema.js';
import { mcpToolInputValidationErrorResult } from './mcp-tool-input-teaching.js';
import { renderSpacesWidgetHtml } from '../mcp-apps/spaces-widget-html.js';
import { isAllowedArtifactMime } from './artifact-mime.js';

const DEFAULT_TOOL_NAME = 'spaces';
const SCROLL_LIMIT = 2000;

interface AdapterInfo {
  adapter_id: string;
  title: string;
  layer_count: number;
  slug: string | null;
  uri: string;
  artifacts?: Array<{
    name: string;
    slug: string;
    uri: string;
    uuid_uri: string;
    content_type: string;
    sha256: string;
    relative_path: string | null;
  }>;
}

export interface SpaceInfo {
  name: string;
  space_id: string;
  type: 'personal' | 'group' | 'app' | 'other';
  adapter_count: number;
  adapters?: AdapterInfo[];
}

function dedupeSpaceIds(ids: string[]): string[] {
  const seen = new Set<string>();
  return ids.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function getSpacesToReport(): string[] {
  const ctx = getSpaceContextFromStorage();
  const allowed = ctx.allowedSpaceIds;
  return dedupeSpaceIds([...allowed, SQUADRULES_APP_SPACE_ID]);
}

async function scrollSpace(
  client: { scroll: (collectionName: string, opts?: unknown) => Promise<{ points?: unknown[] }> } | unknown,
  collection: string,
  spaceId: string
): Promise<Array<{ id: string; payload?: Record<string, unknown> }>> {
  const filter = buildSpaceFilter([spaceId]);
  const scrollClient = client as { scroll: (collectionName: string, opts: unknown) => Promise<{ points?: unknown[] }> };
  const result = await scrollClient.scroll(collection, {
    filter,
    limit: SCROLL_LIMIT,
    with_payload: true,
    with_vector: false
  });
  const points = result?.points ?? [];
  return points as Array<{ id: string; payload?: Record<string, unknown> }>;
}

function buildSpaceInfo(
  spaceId: string,
  points: Array<{ id: string; payload?: Record<string, unknown> }>,
  includeAdapterTitles: boolean,
  includeArtifacts: boolean,
  spaceNamesById: Record<string, string> | undefined
): SpaceInfo {
  const name = spaceIdToDisplayName(spaceId, spaceNamesById);
  const byAdapter = new Map<string, Array<{ id: string; payload?: Record<string, unknown> }>>();

  for (const point of points) {
    const payload = point.payload ?? {};
    const adapterObject = payload['adapter'] as { id?: string } | undefined;
    const adapterId = adapterObject?.id ?? point.id;
    const key = typeof adapterId === 'string' ? adapterId : String(adapterId);
    if (!byAdapter.has(key)) byAdapter.set(key, []);
    byAdapter.get(key)!.push(point);
  }

  const adapterCount = byAdapter.size;
  const adapters: AdapterInfo[] = [];

  if (includeAdapterTitles) {
    for (const [, adapterPoints] of byAdapter) {
      const first = adapterPoints[0];
      const payload = first?.payload ?? {};
      const adapter = payload['adapter'] as
        | { id?: string; name?: string; layer_count?: number }
        | undefined;
      const title = (adapter?.name ?? payload['label'] ?? 'Untitled') as string;
      const adapterId = adapter?.id ?? first?.id ?? '';
      const storedSlug = typeof payload['slug'] === 'string' && payload['slug'].trim().length > 0
        ? payload['slug'].trim()
        : null;
      let slug: string | null = storedSlug;
      if (!slug) {
        slug = normalizeAuthorSlug(title) ?? slugifyFromTitle(title || String(adapterId) || 'adapter');
      }
      adapters.push({
        adapter_id: String(adapterId),
        title: String(title),
        layer_count:
          typeof adapter?.layer_count === 'number'
            ? adapter.layer_count
            : adapterPoints.length,
        slug,
        uri: buildAdapterUri(slug),
        ...(includeArtifacts
          ? {
              artifacts: adapterPoints
                .map((point) => {
                  const payload = (point.payload ?? {}) as Record<string, unknown>;
                  const idRaw = point.id;
                  const artifactUuid =
                    typeof idRaw === 'string' ? idRaw : typeof idRaw === 'number' ? String(idRaw) : '';
                  const contentType =
                    typeof payload['content_type'] === 'string' ? payload['content_type'].trim() : '';
                  const artifactPayload = (payload['artifact'] ?? {}) as Record<string, unknown>;
                  if (!artifactUuid || !isAllowedArtifactMime(contentType) || typeof artifactPayload['slug'] !== 'string') {
                    return null;
                  }
                  const slugValue = artifactPayload['slug'].trim();
                  if (!slugValue) return null;
                  const name =
                    typeof artifactPayload['name'] === 'string' && artifactPayload['name'].trim().length > 0
                      ? artifactPayload['name'].trim()
                      : typeof payload['label'] === 'string' && payload['label'].trim().length > 0
                        ? payload['label'].trim()
                        : slugValue;
                  const sha256 =
                    typeof artifactPayload['sha256'] === 'string' ? artifactPayload['sha256'] : '';
                  const relativePath =
                    typeof artifactPayload['relative_path'] === 'string' && artifactPayload['relative_path'].trim().length > 0
                      ? artifactPayload['relative_path'].trim()
                      : null;
                  return {
                    name,
                    slug: slugValue,
                    uri: `squadrules://artifact/${slugValue}`,
                    uuid_uri: `squadrules://artifact/${artifactUuid}`,
                    content_type: contentType,
                    sha256,
                    relative_path: relativePath
                  };
                })
                .filter((row): row is NonNullable<typeof row> => row !== null)
            }
          : {})
      });
    }
  }

  const kind = spaceKindFromSpaceId(spaceId);
  const type: SpaceInfo['type'] = kind === 'other' ? 'other' : kind;
  return {
    name,
    space_id: spaceId,
    type,
    adapter_count: adapterCount,
    ...(includeAdapterTitles ? { adapters } : {})
  };
}

/**
 * List spaces and adapter counts. Uses current request space context (set by auth middleware).
 * Call from HTTP handlers or MCP tool.
 */
export async function executeSpaces(
  memoryStore: MemoryQdrantStore,
  options: { include_adapter_titles?: boolean; include_artifacts?: boolean } = {}
): Promise<{ spaces: SpaceInfo[] }> {
  const includeAdapterTitles = options.include_adapter_titles ?? false;
  const includeArtifacts = options.include_artifacts ?? false;
  const ctx = getSpaceContextFromStorage();
  const spaceIds = getSpacesToReport();
  const { client, collection } = memoryStore.getQdrantAccess();
  const spaces: SpaceInfo[] = [];

  for (const spaceId of spaceIds) {
    const points = await scrollSpace(client, collection, spaceId);
    spaces.push(buildSpaceInfo(spaceId, points, includeAdapterTitles || includeArtifacts, includeArtifacts, ctx.spaceNamesById));
  }

  return { spaces };
}

export interface RegisterSpacesOptions {
  toolName?: string;
}

export function registerSpacesTool(server: any, memoryStore: MemoryQdrantStore, options: RegisterSpacesOptions = {}): void {
  const toolName = options.toolName ?? DEFAULT_TOOL_NAME;

  server.registerTool(
    toolName,
    {
      title: 'List spaces and adapter counts',
      description: resolveToolDoc('spaces') ?? 'List the agent\'s available spaces with human-readable names and adapter counts. Optionally include adapter titles and layer counts per space.',
      inputSchema: mcpLooseToolInput(spacesInputSchema),
      outputSchema: spacesOutputSchema,
      _meta: SQUADRULES_SPACES_TOOL_UI_META
    },
    async (params: unknown) => {
      const tenantId = getTenantId();
      const inputSize = JSON.stringify(params ?? {}).length;
      mcpToolInputSize.observe({ tool: toolName, tenant_id: tenantId }, inputSize);
      const timer = mcpToolDuration.startTimer({ tool: toolName, tenant_id: tenantId });

      const parsedInput = spacesInputSchema.safeParse(params ?? {});
      if (!parsedInput.success) {
        mcpToolCalls.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        mcpToolErrors.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        timer({ tool: toolName, status: 'error', tenant_id: tenantId });
        return mcpToolInputValidationErrorResult('spaces', parsedInput.error, params);
      }
      const paramsOk = parsedInput.data;

      try {
        const wantWidget = paramsOk.include_widget_html ?? false;
        const includeArtifacts = paramsOk.include_artifacts ?? false;
        const includeTitles = wantWidget || (paramsOk.include_adapter_titles ?? false) || includeArtifacts;
        const output = await executeSpaces(memoryStore, {
          include_adapter_titles: includeTitles,
          include_artifacts: includeArtifacts
        });
        mcpToolCalls.inc({ tool: toolName, status: 'success', tenant_id: tenantId });
        const jsonText = JSON.stringify(output);
        mcpToolOutputSize.observe({ tool: toolName, tenant_id: tenantId }, jsonText.length);
        timer({ tool: toolName, status: 'success', tenant_id: tenantId });
        const content: Array<{ type: 'text'; text: string }> = [{ type: 'text' as const, text: jsonText }];
        if (wantWidget) {
          content.push({ type: 'text' as const, text: renderSpacesWidgetHtml(output.spaces) });
        }
        return {
          content,
          structuredContent: output
        };
      } catch (error) {
        structuredLogger.warn(`[${toolName}] error: ${error instanceof Error ? error.message : String(error)}`);
        mcpToolCalls.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        mcpToolErrors.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        timer({ tool: toolName, status: 'error', tenant_id: tenantId });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'internal_error', message: error instanceof Error ? error.message : String(error) }) }],
          isError: true
        };
      }
    }
  );
}
