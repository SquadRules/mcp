import type { MemoryQdrantStore } from '../services/memory/store.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { executionTraceStore } from '../services/execution-trace-store.js';
import { getSpaceContextFromStorage, getTenantId } from '../utils/tenant-context.js';
import { mcpToolCalls, mcpToolDuration, mcpToolErrors, mcpToolInputSize, mcpToolOutputSize } from '../services/metrics/mcp-metrics.js';
import { executeDump } from './dump.js';
import { exportInputSchema, exportOutputSchema, type ExportInput, type ExportOutput } from './export_schema.js';
import { assertWireAdapterUri, parseSquadrulesUri } from './squadrules-uri.js';
import { mcpLooseToolInput } from './mcp-loose-input-schema.js';
import { mcpToolInputValidationErrorResult } from './mcp-tool-input-teaching.js';
import { spaceIdToDisplayName, spaceKindFromSpaceId } from '../utils/space-display.js';
import { executeExportSource } from './export-source.js';
import { resolveExportAdapter } from './export-resolve-adapter.js';
import { buildPreferenceJsonlItems, buildRewardJsonlItems, buildSftJsonlItems, stringifyLines } from './export-reward-jsonl.js';
import { resolveToolDoc } from '../utils/mcp-tool-doc-runtime.js';
import { collectSkillExportItemsForZip } from './export-skill-items.js';
import { resolveExportUris } from './export-selection.js';
import { flattenSkillItemsToZipPaths, zipSkillFiles } from './skill-export/zip-bundle.js';
import { sha256Hex } from './skill-export/sha256.js';
import { mintExportDownloadCapability } from '../services/export-download-capability.js';
import {
  finalizeExportObservation,
  runExportTelemetryContext,
  setSkillZipDecodedBytes
} from './export-telemetry.js';

interface RegisterExportOptions {
  toolName?: string;
  qdrantService?: QdrantService;
}

export interface ExecuteExportOptions {
  downloadBaseUrl?: string;
}

function toCurrentMarkdown(markdownDoc: string): string {
  return markdownDoc.replaceAll('"challenge":', '"contract":');
}

export async function executeExport(
  memoryStore: MemoryQdrantStore,
  qdrantService: QdrantService | undefined,
  input: ExportInput,
  options: ExecuteExportOptions = {}
): Promise<ExportOutput> {
  return runExportTelemetryContext(async () => {
    const t0 = process.hrtime.bigint();
    let result: ExportOutput | undefined;
    let caught: unknown;
    try {
      result = await executeExportImpl(memoryStore, qdrantService, input, options);
      return result;
    } catch (e) {
      caught = e;
      throw e;
    } finally {
      finalizeExportObservation(input, result, t0, caught);
    }
  });
}

async function executeExportImpl(
  memoryStore: MemoryQdrantStore,
  qdrantService: QdrantService | undefined,
  input: ExportInput,
  options: ExecuteExportOptions
): Promise<ExportOutput> {
  if (typeof input.uri === 'string') {
    const parsedUri = parseSquadrulesUri(input.uri.trim());
    if (parsedUri.kind === 'adapter') {
      input.uri = assertWireAdapterUri(input.uri.trim());
    }
  }
  if (typeof input.uri === 'string' && parseSquadrulesUri(input.uri.trim()).kind === 'artifact') {
    return executeExportSource(memoryStore, qdrantService, input.uri, resolveExportAdapter);
  }

  if (input.format === 'source' && typeof input.uri === 'string') {
    return executeExportSource(memoryStore, qdrantService, input.uri, resolveExportAdapter);
  }

  const adapterUris = await resolveExportUris(memoryStore, input);

  if (input.format === 'markdown') {
    if (adapterUris.length !== 1 || !input.uri) {
      throw new Error('Flat markdown export requires a single `uri`.');
    }
    const { layerId } = await resolveExportAdapter(memoryStore, qdrantService, input.uri);
    const dump = await executeDump(memoryStore, qdrantService, {
      uri: `squadrules://layer/${layerId}`,
      protocol: true
    });
    const headMemory = await memoryStore.getMemory(layerId);
    const sid = typeof headMemory?.space_id === 'string' ? headMemory.space_id.trim() : '';
    const spaceNamesById = getSpaceContextFromStorage().spaceNamesById;
    const spaceFields =
      sid.length > 0
        ? {
            space_id: sid,
            space_name: spaceIdToDisplayName(sid, spaceNamesById),
            space_type: spaceKindFromSpaceId(sid)
          }
        : {
            space_id: null,
            space_name: null
          };
    return {
      uri: input.uri,
      format: 'markdown',
      content_type: 'text/markdown',
      content: toCurrentMarkdown(String(dump['content'] ?? '')),
      item_count: 1,
      adapter_name: typeof dump['label'] === 'string' ? dump['label'] : null,
      adapter_version: typeof dump['adapter_version'] === 'string' ? dump['adapter_version'] : null,
      ...spaceFields
    };
  }

  if (
    input.format === 'trace_jsonl' ||
    input.format === 'reward_jsonl' ||
    input.format === 'sft_jsonl' ||
    input.format === 'preference_jsonl'
  ) {
    if (adapterUris.length !== 1) {
      throw new Error(`Training format ${input.format} requires a single adapter uri.`);
    }
    const { adapterId } = await resolveExportAdapter(memoryStore, qdrantService, adapterUris[0]!);
    const pairs = await executionTraceStore.buildTrainingPairsForAdapter(
      adapterId,
      input.format === 'reward_jsonl' ? true : input.include_reward
    );

    if (input.format === 'trace_jsonl') {
      return {
        uri: adapterUris[0]!,
        format: input.format,
        content_type: 'application/x-ndjson',
        content: stringifyLines(pairs),
        item_count: pairs.length
      };
    }

    if (input.format === 'reward_jsonl') {
      const rewardItems = buildRewardJsonlItems(pairs);
      return {
        uri: adapterUris[0]!,
        format: input.format,
        content_type: 'application/x-ndjson',
        content: stringifyLines(rewardItems),
        item_count: rewardItems.length
      };
    }

    if (input.format === 'sft_jsonl') {
      const sftItems = buildSftJsonlItems(pairs, input.include_reward);
      return {
        uri: adapterUris[0]!,
        format: input.format,
        content_type: 'application/x-ndjson',
        content: stringifyLines(sftItems),
        item_count: sftItems.length
      };
    }

    const preferenceItems = buildPreferenceJsonlItems(pairs);
    return {
      uri: adapterUris[0]!,
      format: input.format,
      content_type: 'application/x-ndjson',
      content: stringifyLines(preferenceItems),
      item_count: preferenceItems.length
    };
  }

  if (input.format === 'skill_tree' || input.format === 'skill_zip') {
    const { items, primaryUri } = await collectSkillExportItemsForZip(memoryStore, qdrantService, adapterUris);

    if (input.format === 'skill_tree') {
      const tree = {
        format: 'skill_tree' as const,
        version: 1,
        skills: items.map((it) => ({
          slug: it.slug,
          version: it.adapterVersion ?? null,
          squadrules_uri: it.squadrulesUri,
          files: it.files.map((f) => ({ path: f.path, content: typeof f.content === 'string' ? f.content : f.content.toString('utf8') })),
          diagnostics: it.diagnostics
        }))
      };
      const json = JSON.stringify(tree, null, 2);
      return {
        uri: primaryUri,
        format: 'skill_tree',
        content_type: 'application/json',
        content: json,
        item_count: items.length,
        export_adapter_count: items.length,
        adapter_name: items.length === 1 ? items[0]!.name : null,
        adapter_version: items.length === 1 ? items[0]!.adapterVersion ?? null : null
      };
    }

    const manifest = {
      type: 'skill_bundle',
      format: 'zip',
      skills: items.map((it) => ({
        slug: it.slug,
        version: it.adapterVersion ?? null,
        entrypoint: `${it.slug}/SKILL.md`,
        artifacts: it.files
          .filter((f) => f.path !== 'SKILL.md' && f.path !== 'SHA256SUMS')
          .map((f) => `${it.slug}/${f.path}`)
      }))
    };
    if (input.delivery === 'inline_base64') {
      const flat = flattenSkillItemsToZipPaths(
        items.map((it) => ({ slug: it.slug, files: it.files }))
      );
      const buf = await zipSkillFiles(flat);
      setSkillZipDecodedBytes(buf.length);
      const b64 = buf.toString('base64');
      const digest = sha256Hex(buf);
      const shaLabel = `sha256:${digest}`;
      const inlineManifest = {
        ...manifest,
        bundle_sha256: shaLabel
      };
      return {
        uri: primaryUri,
        format: 'skill_zip',
        content_type: 'application/zip',
        content: b64,
        content_encoding: 'base64',
        bundle_sha256: shaLabel,
        item_count: items.length,
        export_adapter_count: items.length,
        skill_bundle_manifest: JSON.stringify(inlineManifest),
        adapter_name: items.length === 1 ? items[0]!.name : null,
        adapter_version: items.length === 1 ? items[0]!.adapterVersion ?? null : null
      };
    }

    const manifestJson = JSON.stringify(manifest);
    const downloadRef = await mintExportDownloadCapability({
      adapterUris,
      primaryUri,
      itemCount: items.length,
      adapterName: items.length === 1 ? items[0]!.name : null,
      adapterVersion: items.length === 1 ? items[0]!.adapterVersion ?? null : null,
      skillBundleManifest: manifestJson,
      ...(options.downloadBaseUrl ? { baseUrl: options.downloadBaseUrl } : {})
    });
    return {
      uri: primaryUri,
      format: 'skill_zip',
      content_type: 'application/zip',
      content: '',
      item_count: items.length,
      export_adapter_count: items.length,
      skill_bundle_manifest: manifestJson,
      download_ref: downloadRef,
      adapter_name: items.length === 1 ? items[0]!.name : null,
      adapter_version: items.length === 1 ? items[0]!.adapterVersion ?? null : null
    };
  }

  throw new Error(
    `Unsupported export format "${input.format}" for this selection. Use skill_tree, skill_zip, training JSONL, source, or flat markdown (format: markdown).`
  );
}

export function registerExportTool(server: any, memoryStore: MemoryQdrantStore, options: RegisterExportOptions = {}) {
  const toolName = options.toolName || 'export';
  const qdrantService = options.qdrantService;

  server.registerTool(
    toolName,
    {
      title: 'Export adapter or training data',
      description: resolveToolDoc('export') || 'Export adapter markdown or training datasets.',
      inputSchema: mcpLooseToolInput(exportInputSchema),
      outputSchema: exportOutputSchema
    },
    async (params: unknown) => {
      const tenantId = getTenantId();
      mcpToolInputSize.observe({ tool: toolName, tenant_id: tenantId }, JSON.stringify(params).length);
      const timer = mcpToolDuration.startTimer({ tool: toolName, tenant_id: tenantId });

      const parsedInput = exportInputSchema.safeParse(params);
      if (!parsedInput.success) {
        mcpToolCalls.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        mcpToolErrors.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        timer({ tool: toolName, status: 'error', tenant_id: tenantId });
        return mcpToolInputValidationErrorResult('export', parsedInput.error, params);
      }
      const input = parsedInput.data;

      try {
        const output = await executeExport(memoryStore, qdrantService, input);
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
        throw error;
      }
    }
  );
}
