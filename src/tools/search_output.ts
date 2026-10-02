// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
/**
 * Output building for search: createResults, resolveHead, generateUnifiedOutput.
 * Extracted to keep `search.ts` under the max-lines limit.
 */

import type { Memory } from '../types/memory.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { resolveAdapterEntry } from '../services/adapter-navigation.js';
import {
  getActivationPatterns,
  getAdapterInfo,
  getAdapterName,
  getAdapterSlugForSearchOutput,
  getChainRoot,
  getLayerCount
} from '../services/memory/memory-accessors.js';
import { buildAdapterUri } from './kairos-uri.js';
import { spaceIdToDisplayName } from '../utils/space-display.js';
import { getSpaceContextFromStorage } from '../utils/tenant-context.js';
import { KAIROS_APP_SPACE_ID } from '../config.js';
import {
  KAIROS_CREATION_PROTOCOL_SLUG,
  KAIROS_CREATION_FOOTER_LABEL,
  KAIROS_REFINING_PROTOCOL_SLUG,
  KAIROS_REFINING_FOOTER_LABEL
} from '../constants/builtin-search-meta.js';
import { structuredLogger } from '../utils/structured-logger.js';
import { normalizeAuthorSlug, slugifyFromTitle } from '../utils/protocol-slug.js';

/** Slug-form `kairos://adapter/{slug}` for search/activate wire (never UUID adapter segments). */
function adapterWireUriFromMemory(memory: Memory): string {
  const stored = getAdapterSlugForSearchOutput(memory);
  if (stored) return buildAdapterUri(stored);
  const title = (getAdapterName(memory) || memory.label || '').trim();
  let s = normalizeAuthorSlug(title);
  if (!s) {
    const basis = title.length > 0 ? title : (memory.memory_uuid || 'adapter');
    s = slugifyFromTitle(basis);
  }
  return buildAdapterUri(s);
}

export interface Candidate {
  memory: Memory;
  score: number;
  uri: string;
  label: string;
  tags: string[];
  layer_count: number;
}

export interface UnifiedChoice {
  uri: string;
  label: string;
  adapter_name: string | null;
  score: number | null;
  role: 'match' | 'refine' | 'create';
  tags: string[];
  next_action: string;
  adapter_version: string | null;
  activation_patterns?: string[];
  /** Display name of the space where the adapter is stored (match rows only). */
  space_name: string | null;
  /** Stored adapter routing slug when present; null for refine/create or adapters without slug. */
  slug: string | null;
}

const PUBLIC_SCORE_PIVOT = 0.5;

export function normalizePublicSearchScore(score: number | null | undefined): number {
  if (typeof score !== 'number' || !Number.isFinite(score) || score <= 0) {
    return 0;
  }
  return score / (score + PUBLIC_SCORE_PIVOT);
}

export function createResults(
  headCandidates: Array<{ memory: Memory; score: number }>,
  scoreThreshold: number
): Candidate[] {
  const normalizedThreshold = normalizePublicSearchScore(scoreThreshold);
  return headCandidates
    .map(({ memory, score }) => ({
      memory,
      score: normalizePublicSearchScore(score),
      uri: adapterWireUriFromMemory(memory),
      label: memory.label,
      tags: memory.tags || [],
      layer_count: getLayerCount(memory)
    }))
    .filter((result) => result.score >= normalizedThreshold);
}

export async function resolveHead(
  memory: Memory,
  qdrantService?: QdrantService
): Promise<{ uri: string; label: string }> {
  const resolved = await resolveAdapterEntry(memory, qdrantService);
  const uri = adapterWireUriFromMemory(memory);
  if (resolved) {
    return { uri, label: resolved.label };
  }
  return { uri, label: memory.label };
}

export interface GenerateUnifiedOutputOpts {
  refiningUri: string;
  refiningNextAction: string;
  createUri: string;
  createNextAction: string;
  /** Stored adapter version for refine protocol (from Qdrant), when resolvable. */
  refiningProtocolVersion?: string | null;
  /** Stored adapter version for create protocol (from Qdrant), when resolvable. */
  createProtocolVersion?: string | null;
}

export async function generateUnifiedOutput(
  results: Candidate[],
  qdrantService: QdrantService | undefined,
  opts: GenerateUnifiedOutputOpts
): Promise<{ must_obey: boolean; message: string; next_action: string; choices: UnifiedChoice[] }> {
  const {
    refiningUri,
    refiningNextAction,
    createUri,
    createNextAction,
    refiningProtocolVersion = null,
    createProtocolVersion = null
  } = opts;
  const choices: UnifiedChoice[] = [];
  const spaceNamesById = getSpaceContextFromStorage().spaceNamesById;

  for (const result of results) {
    const head = await resolveHead(result.memory, qdrantService);
    const sid = result.memory.space_id ?? KAIROS_APP_SPACE_ID;
    const slug = getAdapterSlugForSearchOutput(result.memory);
    const chainRoot = getChainRoot(result.memory);
    let choiceUri = head.uri;
    let choiceLabel = head.label || result.label;
    let choiceNextAction = `call forward with ${head.uri} and no solution to start this adapter`;

    if (chainRoot && qdrantService) {
      try {
        const rootOutcome = await qdrantService.findFirstStepMemoryUuidBySlug(chainRoot);
        if (rootOutcome.layerUuid) {
          const rootPoint = await qdrantService.getMemoryByUUID(rootOutcome.layerUuid);
          if (rootPoint) {
            const rootUri = adapterWireUriFromMemory(rootPoint);
            const rootLabel = typeof rootPoint.adapter?.name === 'string' ? rootPoint.adapter.name : (rootPoint.label || choiceLabel);
            choiceUri = rootUri;
            choiceLabel = rootLabel;
            choiceNextAction = `call forward with ${rootUri} and no solution to start this adapter`;
          }
        }
      } catch (err) {
        structuredLogger.warn(`[chain_root] Failed to resolve chain_root slug "${chainRoot}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    choices.push({
      uri: choiceUri,
      label: choiceLabel,
      adapter_name: getAdapterName(result.memory) || null,
      score: result.score,
      role: 'match',
      tags: result.tags,
      next_action: choiceNextAction,
      adapter_version: getAdapterInfo(result.memory)?.protocol_version ?? null,
      activation_patterns: getActivationPatterns(result.memory),
      space_name: spaceIdToDisplayName(sid, spaceNamesById),
      slug: chainRoot ?? slug
    });
  }

  // Deduplicate match choices that collapsed to the same chain root URI
  const seenMatchUris = new Set<string>();
  const deduplicatedChoices: UnifiedChoice[] = [];
  for (const choice of choices) {
    if (choice.role === 'match') {
      if (seenMatchUris.has(choice.uri)) continue;
      seenMatchUris.add(choice.uri);
    }
    deduplicatedChoices.push(choice);
  }
  choices.length = 0;
  choices.push(...deduplicatedChoices);

  const includeMetaFooter = true;
  if (includeMetaFooter) {
    choices.push(
      {
        uri: refiningUri,
        label: KAIROS_REFINING_FOOTER_LABEL,
        adapter_name: KAIROS_REFINING_FOOTER_LABEL,
        score: null,
        role: 'refine',
        tags: ['meta', 'refine'],
        next_action: refiningNextAction,
        adapter_version: refiningProtocolVersion,
        space_name: null,
        slug: KAIROS_REFINING_PROTOCOL_SLUG
      },
      {
        uri: createUri,
        label: KAIROS_CREATION_FOOTER_LABEL,
        adapter_name: KAIROS_CREATION_FOOTER_LABEL,
        score: null,
        role: 'create',
        tags: ['meta', 'creation'],
        next_action: createNextAction,
        adapter_version: createProtocolVersion,
        space_name: null,
        slug: KAIROS_CREATION_PROTOCOL_SLUG
      }
    );
  }

  const matchCount = choices.filter(c => c.role === 'match').length;

  let message: string;
  let nextAction: string;
  if (matchCount === 0) {
    message = 'No existing adapter/protocol matched your query. Refine your search or create a new one.';
    nextAction = "Pick one choice and follow that choice's next_action.";
  } else if (matchCount === 1 && includeMetaFooter) {
    message = 'Found 1 match. You can run it, refine your search, or create a new adapter/protocol.';
    nextAction = "Pick one choice and follow that choice's next_action.";
  } else if (matchCount === 1) {
    message = 'Found 1 match.';
    nextAction = "Follow the choice's next_action.";
  } else {
    const topMatch = choices[0]!;
    const confidencePercent = Math.round((topMatch.score || 0) * 100);
    message = `Found ${matchCount} matches (top confidence: ${confidencePercent}%). Choose one, refine your search, or create a new adapter/protocol.`;
    nextAction = "Pick one choice and follow that choice's next_action.";
  }
  return { must_obey: true, message, next_action: nextAction, choices };
}
