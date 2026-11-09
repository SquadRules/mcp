/**
 * Deterministic anomaly detection (ADR 0046).
 *
 * Detection here is deliberately narrow: it compares **primitive** domain
 * properties (booleans and numbers) and exact normalized Must Always / Must Never
 * statements. It never claims semantic understanding of free text — a hash of a
 * sentence proves which bytes were hashed, not what they mean, so anything that
 * needs judgement is left to an agent or human confirmation instead of being
 * reported as machine-verified.
 */
import { parseFrontmatter } from '../../../utils/frontmatter.js';

/** A domain property value that can be compared without interpretation. */
export type PrimitiveValue = string | number | boolean | null;

/** The facts detection needs from one adapter document. */
export interface AdapterFacts {
  fields: Record<string, string>;
  body: string;
}

/** One deterministic contradiction between a child adapter and its parent. */
export interface DetectedContradiction {
  kind: 'property' | 'rule';
  /** Property name, or `must_always` / `must_never` for a rule contradiction. */
  field: string;
  /** Parent-side value the child contradicts. */
  parent_value: string;
  /** Child-side value that contradicts the parent. */
  child_value: string;
  /** One-line human-readable summary, safe to store as proposal evidence. */
  summary: string;
}

/**
 * Frontmatter keys that are identity, topology, or bookkeeping — never domain
 * properties. A differing `version` is not a contradiction.
 */
const NON_DOMAIN_FIELDS = new Set([
  'slug',
  'version',
  'title',
  'description',
  'inherits',
  'chain_root',
  'chainroot',
  'override',
  'protocol_version',
  'tags',
  'metadata',
  'space',
  'layer_count',
  'contract_types',
  'anomaly',
  'anomaly_type',
  'anomaly_severity',
  'anomaly_reason',
  'anomaly_field',
  'anomaly_observed',
  'anomaly_expected'
]);

/** Parse a frontmatter scalar into a comparable primitive; `undefined` when not one. */
export function parsePrimitive(raw: string): PrimitiveValue | undefined {
  const value = raw.trim();
  if (value.length === 0) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return undefined;
}

/** Primitive domain properties of a document, excluding identity/topology keys. */
export function domainPrimitives(fields: Record<string, string>): Record<string, PrimitiveValue> {
  const primitives: Record<string, PrimitiveValue> = {};
  for (const [key, raw] of Object.entries(fields)) {
    if (NON_DOMAIN_FIELDS.has(key)) continue;
    const value = parsePrimitive(raw);
    if (value !== undefined) primitives[key] = value;
  }
  return primitives;
}

/** Build the detection input from a markdown document. */
export function factsFromMarkdown(markdown: string): AdapterFacts {
  const parsed = parseFrontmatter(markdown);
  return { fields: parsed.fields, body: parsed.body };
}

/** Lowercase, trim, drop trailing punctuation, collapse whitespace. */
export function normalizeStatement(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.;:,]+$/, '')
    .replace(/\s+/g, ' ');
}

const BULLET = /^\s*[-*]\s+(.*)$/;

/**
 * Bullet items under a bold rule heading (`**Must Always:**` / `**Must Never:**`).
 *
 * The block ends at a blank line followed by a non-bullet line, at another bold
 * heading, or at a markdown heading. Ordered-list markers are intentionally not
 * read as rules: numbered steps are procedure, not policy.
 */
export function parseRuleSection(body: string, heading: 'Must Always' | 'Must Never'): string[] {
  const lines = body.split(/\r?\n/);
  const marker = new RegExp(`^\\s*\\**\\s*${heading}\\s*:?\\s*\\**\\s*$`, 'i');
  const start = lines.findIndex((line) => marker.test(line.trim()));
  if (start === -1) return [];

  const rules: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const bullet = BULLET.exec(line);
    if (bullet) {
      const statement = normalizeStatement(bullet[1] ?? '');
      if (statement.length > 0) rules.push(statement);
      continue;
    }
    if (line.trim().length === 0) continue;
    break;
  }
  return rules;
}

function propertyContradictions(
  child: Record<string, PrimitiveValue>,
  parent: Record<string, PrimitiveValue>
): DetectedContradiction[] {
  const found: DetectedContradiction[] = [];
  for (const [field, parentValue] of Object.entries(parent)) {
    if (!(field in child)) continue;
    const childValue = child[field];
    if (typeof parentValue === 'boolean' && typeof childValue === 'boolean' && parentValue !== childValue) {
      found.push({
        kind: 'property',
        field,
        parent_value: String(parentValue),
        child_value: String(childValue),
        summary: `${field}: parent declares ${String(parentValue)}, child declares ${String(childValue)}`
      });
    }
    if (typeof parentValue === 'number' && typeof childValue === 'number' && parentValue !== childValue) {
      found.push({
        kind: 'property',
        field,
        parent_value: String(parentValue),
        child_value: String(childValue),
        summary: `${field}: parent declares ${String(parentValue)}, child declares ${String(childValue)}`
      });
    }
  }
  return found;
}

function ruleContradictions(child: AdapterFacts, parent: AdapterFacts): DetectedContradiction[] {
  const found: DetectedContradiction[] = [];
  const childAlways = parseRuleSection(child.body, 'Must Always');
  const childNever = parseRuleSection(child.body, 'Must Never');
  const parentAlways = parseRuleSection(parent.body, 'Must Always');
  const parentNever = parseRuleSection(parent.body, 'Must Never');

  for (const statement of childNever) {
    if (!parentAlways.includes(statement)) continue;
    found.push({
      kind: 'rule',
      field: 'must_always',
      parent_value: `must always: ${statement}`,
      child_value: `must never: ${statement}`,
      summary: `child forbids what the parent requires (${statement})`
    });
  }
  for (const statement of childAlways) {
    if (!parentNever.includes(statement)) continue;
    found.push({
      kind: 'rule',
      field: 'must_never',
      parent_value: `must never: ${statement}`,
      child_value: `must always: ${statement}`,
      summary: `child requires what the parent forbids (${statement})`
    });
  }
  return found;
}

/**
 * Deterministic child/parent contradictions. Order is stable so a proposal key
 * derived from the result is stable too.
 */
export function detectContradictions(child: AdapterFacts, parent: AdapterFacts): DetectedContradiction[] {
  const properties = propertyContradictions(domainPrimitives(child.fields), domainPrimitives(parent.fields));
  const rules = ruleContradictions(child, parent);
  const seen = new Set<string>();
  return [...properties, ...rules].filter((item) => {
    const id = `${item.kind}|${item.field}|${item.parent_value}|${item.child_value}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
