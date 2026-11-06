/**
 * Parse YAML-like frontmatter at the start of a markdown document.
 * Content between first --- and second --- is parsed for key: value lines.
 * Returns extracted metadata and the body (rest of document after closing ---).
 */

export interface ParsedFrontmatter {
  version?: string;
  title?: string;
  /** Present when the document had a `slug:` key in frontmatter (value may be empty). */
  slugRaw?: string;
  /** Present when the document had a `chain_root:` key in frontmatter (slug of the chain entry-point adapter). */
  chainRoot?: string;
  /** Present when the document had an `inherits:` key (parent adapter slug). */
  inherits?: string;
  /** Present when the document had an `override:` key (list of overridden fields). Raw string value. */
  overrideRaw?: string;
  body: string;
}

const FRONTMATTER_DELIM = '---';

/**
 * Parse frontmatter from the start of text. If no closing --- is found,
 * returns body as the original text and no metadata.
 */
export function parseFrontmatter(text: string): ParsedFrontmatter {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith(FRONTMATTER_DELIM)) {
    return { body: text };
  }

  const afterFirst = trimmed.slice(FRONTMATTER_DELIM.length);
  const secondIndex = afterFirst.indexOf('\n' + FRONTMATTER_DELIM);
  if (secondIndex === -1) {
    return { body: text };
  }

  const fmLines = afterFirst.slice(0, secondIndex).trim().split(/\r?\n/);
  const body = afterFirst.slice(secondIndex + FRONTMATTER_DELIM.length + 1).trimStart();

  const result: ParsedFrontmatter = { body };
  for (const line of fmLines) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key === 'version' && value) result.version = value;
    if (key === 'title' && value) result.title = value;
    if (key === 'slug') {
      result.slugRaw = value;
    }
    if ((key === 'chain_root' || key === 'chainroot') && value) {
      result.chainRoot = value;
    }
    if (key === 'inherits' && value) {
      result.inherits = value;
    }
    if (key === 'override' && value) {
      result.overrideRaw = value;
    }
  }
  return result;
}
