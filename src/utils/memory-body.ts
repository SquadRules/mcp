// squadrules-compat-surface: writes the KAIROS:BODY start/end delimiters into stored artifact bodies that must keep parsing
const BODY_MARKER_PREFIX = 'KAIROS:BODY';
const BODY_START_RE = new RegExp(`<!--\\s*${BODY_MARKER_PREFIX}-START\\s*-->`, 'i');
const BODY_END_RE = new RegExp(`<!--\\s*${BODY_MARKER_PREFIX}-END\\s*-->`, 'i');

export function hasMemoryBodyMarkers(text?: string | null): boolean {
  return typeof text === 'string' && BODY_START_RE.test(text) && BODY_END_RE.test(text);
}

/**
 * Extracts the markdown body stored between SQUADRULES BODY markers.
 * Falls back to the original text if markers are missing.
 */
export function extractMemoryBody(text?: string | null): string {
  if (!text) return '';

  const startMatch = text.match(BODY_START_RE);
  const endIndex = text.search(BODY_END_RE);
  if (!startMatch || endIndex === -1) {
    return text.trim();
  }

  const startIndex = (startMatch.index ?? 0) + startMatch[0].length;
  if (endIndex <= startIndex) {
    return text.trim();
  }

  return text.slice(startIndex, endIndex).trim();
}

