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
import { buildAdapterUri } from './squadrules-uri.js';
import { spaceIdToDisplayName } from '../utils/space-display.js';
import { getSpaceContextFromStorage } from '../utils/tenant-context.js';
import { SQUADRULES_APP_SPACE_ID } from '../config.js';
import {
  SQUADRULES_CREATION_PROTOCOL_SLUG,
  SQUADRULES_CREATION_FOOTER_LABEL,
  SQUADRULES_REFINING_PROTOCOL_SLUG,
  SQUADRULES_REFINING_FOOTER_LABEL
} from '../constants/builtin-search-meta.js';
import { structuredLogger } from '../utils/structured-logger.js';
import { normalizeAuthorSlug, slugifyFromTitle } from '../utils/protocol-slug.js';

/** Slug-form `squadrules://adapter/{slug}` for search/activate wire (never UUID adapter segments). */
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

/** A qualified match set is only trusted from this many matches up. */
export const MIN_QUALIFIED_MATCHES = 3;
/** Upper bound on qualified matches surfaced in one answer. */
export const MAX_QUALIFIED_MATCHES = 10;
/** Size of the honest fallback set when too few matches clear the threshold. */
export const FALLBACK_MATCH_COUNT = 3;

export interface QualifiedSelection {
  /** The matches to surface — always real candidates, never synthesised. */
  results: Candidate[];
  /** How many candidates scored at or above the threshold. */
  qualified_count: number;
  /** True when the answer is the fallback set rather than a qualified set. */
  fallback: boolean;
  /** Human-readable explanation of the fallback; absent for a qualified set. */
  warning?: string;
}

/**
 * Choose which matches to surface.
 *
 * The threshold is a confidence gate, not a hard filter, because a query that genuinely
 * matches one adapter must still return that adapter rather than an empty list. The rule:
 *
 *   - `MIN_QUALIFIED_MATCHES` or more candidates clear the threshold → surface the
 *     qualified ones, capped at `MAX_QUALIFIED_MATCHES`.
 *   - Fewer than that → surface the real top `FALLBACK_MATCH_COUNT` candidates with a
 *     warning. "Real" is load-bearing: this never pads the list with fabricated rows,
 *     so a warning is the only difference between the two paths.
 *
 * Pure: same candidates and threshold always produce the same selection.
 */
export function selectQualifiedResults(
  headCandidates: Array<{ memory: Memory; score: number }>,
  scoreThreshold: number,
  options: { maxChoices?: number } = {}
): QualifiedSelection {
  if (headCandidates.length === 0) {
    return { results: [], qualified_count: 0, fallback: false };
  }

  const all = createResults(headCandidates, 0);
  const qualified = createResults(headCandidates, scoreThreshold);
  const requestedCap = options.maxChoices ?? MAX_QUALIFIED_MATCHES;
  const qualifiedCap = Math.max(1, Math.min(requestedCap, MAX_QUALIFIED_MATCHES));

  if (qualified.length >= MIN_QUALIFIED_MATCHES) {
    return {
      results: qualified.slice(0, qualifiedCap),
      qualified_count: qualified.length,
      fallback: false
    };
  }

  const fallbackResults = all.slice(0, FALLBACK_MATCH_COUNT);
  return {
    results: fallbackResults,
    qualified_count: qualified.length,
    fallback: true,
    warning:
      `Only ${qualified.length} of ${all.length} match(es) scored at or above the ${scoreThreshold} threshold; ` +
      `returning the top ${fallbackResults.length} real match(es) instead.`
  };
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
  /** Fallback explanation appended to the human-readable message. */
  matchWarning?: string | null;
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
    createProtocolVersion = null,
    matchWarning = null
  } = opts;
  const choices: UnifiedChoice[] = [];
  const spaceNamesById = getSpaceContextFromStorage().spaceNamesById;

  for (const result of results) {
    const adapterSlug = getAdapterSlugForSearchOutput(result.memory);

    const head = await resolveHead(result.memory, qdrantService);
    const sid = result.memory.space_id ?? SQUADRULES_APP_SPACE_ID;
    const slug = adapterSlug;
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
        label: SQUADRULES_REFINING_FOOTER_LABEL,
        adapter_name: SQUADRULES_REFINING_FOOTER_LABEL,
        score: null,
        role: 'refine',
        tags: ['meta', 'refine'],
        next_action: refiningNextAction,
        adapter_version: refiningProtocolVersion,
        space_name: null,
        slug: SQUADRULES_REFINING_PROTOCOL_SLUG
      },
      {
        uri: createUri,
        label: SQUADRULES_CREATION_FOOTER_LABEL,
        adapter_name: SQUADRULES_CREATION_FOOTER_LABEL,
        score: null,
        role: 'create',
        tags: ['meta', 'creation'],
        next_action: createNextAction,
        adapter_version: createProtocolVersion,
        space_name: null,
        slug: SQUADRULES_CREATION_PROTOCOL_SLUG
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
  if (matchWarning) {
    // The fallback set is honest about being a fallback: same real matches, explicit reason.
    message = `${message} ${matchWarning}`;
  }
  return { must_obey: true, message, next_action: nextAction, choices };
}
