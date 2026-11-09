/**
 * Additive + selective markdown merge for adapter inheritance.
 *
 * WHY A SEPARATE PURE MODULE
 * `forward` must execute exactly what `activate` showed. Both call the same resolver,
 * but the merge itself is a pure string transformation: keeping it here (no store, no
 * graph, no I/O) is what makes it unit-testable and what keeps the two touchpoints from
 * drifting in opposite directions.
 *
 * SEMANTICS (chosen behaviour, ADR 0043)
 *   - The child is the spine. Its sections keep their order and its preamble stays.
 *   - An ancestor section is inherited when the child (or a nearer ancestor) has no
 *     section with the same keyed heading. The heading is the key.
 *   - A section with the same keyed heading in a nearer level is the explicit
 *     override. It replaces the inherited section, and the override is recorded by
 *     heading so the lineage stays auditable.
 *   - A child-only section is an addition and is never dropped.
 *   - Structural identity (slug/version/adapter/work envelope) is not in the body and
 *     is never touched here; it stays with the child as the caller set it.
 *
 * CONTRACTS
 * A stored adapter layer does NOT keep its contract fence in `text`: the writer slices
 * layers on `json` contract fences and stores the parsed contract on the record
 * (`adapter.inference_contract`). The merge therefore takes each level's carried
 * contract as the primary source, nearest level first, and only then falls back to
 * fences that a hand-written body still contains. `effective_contracts[0]` is the
 * contract the caller must execute, so a child's own contract always precedes an
 * ancestor's.
 */
import type { InferenceContractDefinition } from '../../types/memory.js';

/** One level of the ancestry, nearest-parent-last (`root → … → parent → child`). */
export interface AdapterContentLevel {
  /** Adapter slug that supplied this level. */
  slug: string;
  /** Markdown body without BODY markers. */
  body: string;
  /** The level's `override:` list (fields/sections it explicitly claims). */
  overrides?: string[];
  /**
   * The executable contract carried on this level's stored layer record. Authoritative:
   * the writer strips the fence from the body when it builds the layer.
   */
  contract?: InferenceContractDefinition;
}

export interface EffectiveSection {
  /** Heading key: lowercased, whitespace-collapsed heading text. */
  key: string;
  /** Original heading text without the `##`. */
  heading: string;
  /** Slug whose section text won. */
  source: string;
  /** Full section text, heading line included, with no trailing blank noise. */
  text: string;
}

export interface EffectiveContract {
  /** Slug of the level that supplied the winning section. */
  source: string;
  /** Section heading the fence lives in. */
  heading: string;
  contract: InferenceContractDefinition;
  /** The raw `contract` value as parsed, for audit. */
  raw: unknown;
}

export interface MergedAdapterMarkdown {
  /** Merged markdown the agent executes. */
  content: string;
  /** Root-first slugs of every contributing level, child last. */
  lineage: string[];
  /** `heading -> overriding slug` for every section a nearer level replaced. */
  overrides: Record<string, string>;
  /** Winning sections in output order (child order first, then inherited). */
  sections: EffectiveSection[];
  /**
   * Effective contracts, nearest level first. Level-carried contracts precede
   * contracts still present as fences in the winning sections.
   */
  effective_contracts: EffectiveContract[];
}

interface ParsedBody {
  preamble: string;
  sections: Array<{ key: string; heading: string; text: string }>;
}

/** Heading key for matching: case- and whitespace-insensitive, never the raw text. */
export function sectionKey(heading: string): string {
  return heading.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Split a markdown body into a preamble plus `##` sections.
 *
 * Only column-0 `##` headings split. Fenced code blocks are honoured, so a `##` line
 * inside a contract fence never becomes a section (that would let a parent's example
 * markdown masquerade as an inheritable section).
 */
export function splitMarkdownSections(body: string): ParsedBody {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const preamble: string[] = [];
  const sections: Array<{ key: string; heading: string; text: string[] }> = [];
  let inFence = false;
  let current: { key: string; heading: string; text: string[] } | null = null;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
    }
    const headingMatch = !inFence ? /^##\s+(.+?)\s*$/.exec(line) : null;
    if (headingMatch) {
      current = { key: sectionKey(headingMatch[1]!), heading: headingMatch[1]!.trim(), text: [line] };
      sections.push(current);
      continue;
    }
    if (current) current.text.push(line);
    else preamble.push(line);
  }

  return {
    preamble: preamble.join('\n').trim(),
    sections: sections.map((section) => ({
      key: section.key,
      heading: section.heading,
      text: section.text.join('\n').trim()
    }))
  };
}

const FENCE_RE = /```json[^\n]*\n([\s\S]*?)```/g;

/**
 * Harvest contract fences from one section.
 *
 * A fence counts only when its JSON has a top-level `contract` key — the same rule the
 * real parser uses. Unparseable fences are skipped rather than guessed at: a broken
 * example in a parent must not become an executed contract.
 */
function contractsInSection(
  section: EffectiveSection
): Array<{ contract: InferenceContractDefinition; raw: unknown }> {
  const found: Array<{ contract: InferenceContractDefinition; raw: unknown }> = [];
  const re = new RegExp(FENCE_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(section.text)) !== null) {
    const bodyText = match[1]!.trim();
    if (bodyText.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || !('contract' in parsed)) continue;
    const contract = (parsed as { contract: unknown }).contract;
    if (!contract || typeof contract !== 'object') continue;
    found.push({ contract: contract as InferenceContractDefinition, raw: contract });
  }
  return found;
}

/** Heading of the last `##` section in a level body; `''` when the body has none. */
function lastSectionHeading(body: string): string {
  const sections = splitMarkdownSections(body).sections;
  return sections.length > 0 ? sections[sections.length - 1]!.heading : '';
}

/**
 * Merge ancestry levels into one executable markdown body.
 *
 * @param levels root first, child last. An empty list returns an empty merge.
 */
export function mergeAdapterMarkdown(levels: AdapterContentLevel[]): MergedAdapterMarkdown {
  if (levels.length === 0) {
    return { content: '', lineage: [], overrides: {}, sections: [], effective_contracts: [] };
  }

  const childIndex = levels.length - 1;
  const child = levels[childIndex]!;
  const childParsed = splitMarkdownSections(child.body);
  const lineage = levels.map((level) => level.slug);

  // Winning sections keyed by heading. Child first so its order is the output order.
  const winners = new Map<string, EffectiveSection>();
  const overrides: Record<string, string> = {};

  const claim = (level: AdapterContentLevel, parsed: ParsedBody, isChild: boolean): void => {
    for (const section of parsed.sections) {
      const existing = winners.get(section.key);
      if (existing && existing.source !== level.slug) {
        overrides[section.key] = level.slug;
      }
      if (isChild || !existing) {
        winners.set(section.key, { ...section, source: level.slug });
      }
    }
  };

  // Child spine first (order + preamble).
  claim(child, childParsed, true);

  // Nearest ancestors next: an ancestor only fills a heading the child did not claim;
  // a nearer ancestor wins over a farther one. When an ancestor heading is already
  // claimed by a nearer level, that nearer level is the explicit override — record it.
  for (let index = childIndex - 1; index >= 0; index--) {
    const level = levels[index]!;
    const parsed = splitMarkdownSections(level.body);
    for (const section of parsed.sections) {
      const claimed = winners.get(section.key);
      if (claimed) {
        overrides[section.key] = claimed.source;
        continue;
      }
      winners.set(section.key, { ...section, source: level.slug });
    }
  }

  // Output: child preamble, then every winning section (child order first).
  const ordered: EffectiveSection[] = [...winners.values()];
  const pieces: string[] = [];
  if (childParsed.preamble.length > 0) pieces.push(childParsed.preamble);
  for (const section of ordered) pieces.push(section.text);

  // Level-carried contracts, nearest level first. This is the authoritative source: a
  // stored layer keeps its contract on the record, not as a fence in `text`.
  const effectiveContracts: EffectiveContract[] = [];
  const seenContracts = new Set<string>();
  for (let index = childIndex; index >= 0; index--) {
    const level = levels[index]!;
    if (!level.contract) continue;
    const fingerprint = `${level.slug}\u0000${JSON.stringify(level.contract)}`;
    if (seenContracts.has(fingerprint)) continue;
    seenContracts.add(fingerprint);
    effectiveContracts.push({
      source: level.slug,
      heading: lastSectionHeading(level.body),
      contract: level.contract,
      raw: level.contract
    });
  }

  // Secondary source: fences still present in the winning sections (hand-written bodies).
  const fenceContracts: EffectiveContract[] = [];
  for (const section of ordered) {
    for (const found of contractsInSection(section)) {
      fenceContracts.push({
        source: section.source,
        heading: section.heading,
        contract: found.contract,
        raw: found.raw
      });
    }
  }
  // Nearest level first within the fence set too, so ordering never mixes ancestors up.
  fenceContracts.sort((left, right) => {
    const leftIndex = levels.findIndex((level) => level.slug === left.source);
    const rightIndex = levels.findIndex((level) => level.slug === right.source);
    return rightIndex - leftIndex;
  });
  for (const fenceContract of fenceContracts) {
    const fingerprint = `${fenceContract.source}\u0000${JSON.stringify(fenceContract.contract)}`;
    if (seenContracts.has(fingerprint)) continue;
    seenContracts.add(fingerprint);
    effectiveContracts.push(fenceContract);
  }

  return {
    content: pieces.join('\n\n').trim() + '\n',
    lineage,
    overrides,
    sections: ordered,
    effective_contracts: effectiveContracts
  };
}
