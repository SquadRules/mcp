// URI scheme: canonical squadrules:// for adapter/layer/artifact URIs.
// All build/emit functions produce squadrules:// as the stored form.
import { SquadrulesError } from '../types/index.js';
import { normalizeAuthorSlug } from '../utils/protocol-slug.js';

const UUID_PATTERN = '[0-9a-f-]{36}';
const SLUG_PATTERN = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
/** Input URI scheme: canonical squadrules://. */
const SCHEME_PATTERN = 'squadrules';

const UUID_REGEX = new RegExp(`^${UUID_PATTERN}$`, 'i');
const ADAPTER_URI_BODY_REGEX = /^squadrules:\/\/adapter\/([^/?#]+)$/i;
const ARTIFACT_URI_BODY_REGEX = /^squadrules:\/\/artifact\/([^/?#]+)$/i;
export const ADAPTER_SLUG_URI_INPUT_REGEX = new RegExp(
  `^${SCHEME_PATTERN}://adapter/(${UUID_PATTERN}|${SLUG_PATTERN})$`,
  'i'
);
export const ARTIFACT_URI_INPUT_REGEX = new RegExp(
  `^${SCHEME_PATTERN}://artifact/(${UUID_PATTERN}|${SLUG_PATTERN})$`,
  'i'
);
export const LAYER_URI_INPUT_REGEX = new RegExp(
  `^${SCHEME_PATTERN}://layer/(${UUID_PATTERN})(?:\\?execution_id=([0-9a-f-]{36}))?$`,
  'i'
);

export type ParsedSquadrulesUri =
  | { kind: 'adapter'; id: string; idKind: 'uuid' | 'slug'; raw: string }
  | { kind: 'artifact'; id: string; idKind: 'uuid' | 'slug'; raw: string }
  | { kind: 'layer'; id: string; executionId?: string; raw: string };

export function buildAdapterUri(adapterId: string): string {
  return `squadrules://adapter/${adapterId}`;
}

export function buildLayerUri(layerId: string, executionId?: string): string {
  return executionId
    ? `squadrules://layer/${layerId}?execution_id=${executionId}`
    : `squadrules://layer/${layerId}`;
}

export function parseSquadrulesUri(value: string): ParsedSquadrulesUri {
  const normalized = (value || '').trim();

  const adapterMatch = normalized.match(ADAPTER_URI_BODY_REGEX);
  if (adapterMatch?.[1]) {
    if (UUID_REGEX.test(adapterMatch[1])) {
      return {
        kind: 'adapter',
        id: adapterMatch[1],
        idKind: 'uuid',
        raw: normalized
      };
    }

    const normalizedSlug = normalizeAuthorSlug(adapterMatch[1]);
    if (normalizedSlug) {
      return {
        kind: 'adapter',
        id: normalizedSlug,
        idKind: 'slug',
        raw: normalized
      };
    }
  }

  const layerMatch = normalized.match(LAYER_URI_INPUT_REGEX);
  if (layerMatch?.[1]) {
    return {
      kind: 'layer',
      id: layerMatch[1],
      ...(layerMatch[2] ? { executionId: layerMatch[2] } : {}),
      raw: normalized
    };
  }

  const artifactMatch = normalized.match(ARTIFACT_URI_BODY_REGEX);
  if (artifactMatch?.[1]) {
    if (UUID_REGEX.test(artifactMatch[1])) {
      return {
        kind: 'artifact',
        id: artifactMatch[1],
        idKind: 'uuid',
        raw: normalized
      };
    }

    const normalizedSlug = normalizeAuthorSlug(artifactMatch[1]);
    if (normalizedSlug) {
      return {
        kind: 'artifact',
        id: normalizedSlug,
        idKind: 'slug',
        raw: normalized
      };
    }
  }

  throw new Error(
    'Invalid SquadRules URI. Expected squadrules://adapter/{uuid|slug}, squadrules://artifact/{uuid|slug}, or squadrules://layer/{uuid}[?execution_id=…]'
  );
}

export function parseSquadrulesUriOrThrow(value: string): ParsedSquadrulesUri {
  try {
    return parseSquadrulesUri(value);
  } catch (error) {
    throw new SquadrulesError(
      error instanceof Error ? error.message : 'Invalid SquadRules URI.',
      'INVALID_URI',
      400
    );
  }
}

/**
 * Wire contract guard for public tool inputs: validates adapter URI format.
 */
export function assertWireAdapterUri(value: string): string {
  const parsed = parseSquadrulesUri(value);
  if (parsed.kind !== 'adapter') {
    throw new SquadrulesError(
      'Invalid adapter URI. Expected squadrules://adapter/{slug}.',
      'INVALID_URI',
      400
    );
  }
  return buildAdapterUri(parsed.id);
}
