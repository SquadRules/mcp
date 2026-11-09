/**
 * Parse YAML-like frontmatter at the start of a markdown document.
 * Content between first --- and second --- is parsed for key: value lines.
 * Returns extracted metadata and the body (rest of document after closing ---).
 *
 * `fields` keeps the top-level scalar declarations this parser understands, not only the
 * fixed keys it knows about. Inheritance needs that: an arbitrary domain property declared
 * by an author (`risk_level: high`) must survive the write so `override:` can name it
 * without tripping `override_unknown_field`. The typed fields below are derived views for
 * the common keys; `fields` carries the remainder.
 *
 * The result is a normalized subset, not general lossless YAML. Every key is lowercased,
 * one surrounding pair of quotes is stripped, `__proto__`/`constructor`/`prototype`
 * declarations are rejected, a `key:` declaration with no inline value opens a `nested`
 * block instead of becoming a field, and a repeated scalar resolves to its last occurrence.
 * Frontmatter comments are dropped (the body keeps the document text verbatim) and sub-keys
 * nested deeper than one level flatten into that one block. What reaches a stored record is
 * narrower still — see `toStoredAdapterFrontmatter` in
 * `services/memory/stored-adapter-frontmatter.ts`.
 *
 * Indented sub-keys of a key written without a value (`anomaly:` followed by
 * `  type: …`) are kept in `nested`, one level deep. That is the documented adapter form for
 * an agent-declared anomaly (docs/specs/ontological-knowledge-system.md, Decision 6) and it
 * must not flatten into `fields` where it would collide with top-level keys.
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
  /**
   * Top-level scalar declarations in the parser's normalized form: keys lowercased, one
   * surrounding pair of quotes stripped, prototype-sensitive keys dropped, valueless `key:`
   * declarations routed to `nested`, and a repeated scalar resolved to its last occurrence.
   * A subset of the document's YAML rather than a lossless copy of it — see
   * `toStoredAdapterFrontmatter` for what is actually persisted. Empty when the document has
   * no frontmatter. This is what lets an arbitrary domain property reach the stored record.
   */
  fields: Record<string, string>;
  /** Indented sub-keys grouped under their top-level key, keys lowercased. */
  nested: Record<string, Record<string, string>>;
  /** Convenience view of `nested.anomaly` — the agent-declared anomaly block. */
  anomaly?: Record<string, string>;
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
    return { body: text, fields: {}, nested: {} };
  }

  const afterFirst = trimmed.slice(FRONTMATTER_DELIM.length);
  const secondIndex = afterFirst.indexOf('\n' + FRONTMATTER_DELIM);
  if (secondIndex === -1) {
    return { body: text, fields: {}, nested: {} };
  }

  const fmLines = afterFirst.slice(0, secondIndex).trim().split(/\r?\n/);
  const body = afterFirst.slice(secondIndex + FRONTMATTER_DELIM.length + 1).trimStart();

  const fields: Record<string, string> = {};
  const nested: Record<string, Record<string, string>> = {};
  const result: ParsedFrontmatter = { body, fields, nested };
  let openBlock: Record<string, string> | null = null;

  for (const line of fmLines) {
    if (line.trim().length === 0) {
      openBlock = null;
      continue;
    }
    const colon = line.indexOf(':');
    if (colon === -1) {
      openBlock = null;
      continue;
    }
    const indented = /^[ \t]/.test(line);
    const key = line.slice(0, colon).trim().toLowerCase();
    if (key.length === 0) continue;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      if (!indented) openBlock = null;
      continue;
    }
    const value = line.slice(colon + 1).trim().replace(/^['"]|['"]$/g, '');

    if (indented && openBlock) {
      openBlock[key] = value;
      continue;
    }
    openBlock = null;

    if (value.length === 0) {
      // `key:` with no inline value opens a nested block. It is not a scalar field,
      // so it never lands in `fields` and cannot clobber a top-level key.
      openBlock = Object.prototype.hasOwnProperty.call(nested, key) ? nested[key]! : {};
      nested[key] = openBlock;
      continue;
    }

    // Keep the last occurrence, matching simple YAML duplicate-key behaviour while
    // never losing a key the fixed extractors below do not know about.
    fields[key] = value;
    if (key === 'version') result.version = value;
    if (key === 'title') result.title = value;
    if (key === 'slug') {
      result.slugRaw = value;
    }
    if (key === 'chain_root' || key === 'chainroot') {
      result.chainRoot = value;
    }
    if (key === 'inherits') {
      result.inherits = value;
    }
    if (key === 'override') {
      result.overrideRaw = value;
    }
  }

  const anomalyBlock = Object.prototype.hasOwnProperty.call(nested, 'anomaly') ? nested['anomaly'] : undefined;
  if (anomalyBlock && Object.keys(anomalyBlock).length > 0) {
    result.anomaly = anomalyBlock;
  }

  return result;
}
