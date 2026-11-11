/**
 * Reconstruct the durable stored adapter document from its stored layer records.
 *
 * WHY THIS EXISTS
 * History has to record the state a restore is supposed to recover. Recording the
 * bytes the caller *submitted* records an intention, not a state: `tune` preserves
 * the stored `inference_contract` on purpose (a prose edit may not replace the
 * executable gate), so a submitted document that changes the contract produces a
 * snapshot claiming a gate the adapter never had. Exporting that snapshot and
 * restoring it would then activate behaviour the original write never activated.
 *
 * WHAT IT RECONSTRUCTS
 * The exact inverse of the write path's own decomposition
 * (`buildHeaderMemoryAdapter`, `src/services/memory/adapter-builder.ts`):
 *
 *   stored head frontmatter      ->  the `---` block
 *   head adapter name            ->  the `# H1` line
 *   each layer's `text`          ->  that layer's prose, in `layer_index` order
 *   each layer's `inference_contract` ->  that layer's ```json contract fence
 *   adapter `reward_signal`      ->  the trailing `## Reward Signal` section
 *
 * THE CONTRACT FENCE IS NOT OPTIONAL
 * Layer boundaries are defined by fenced contract blocks, not by `##` headings: the
 * converter stores the text *before* each fence as that layer's `text` and the parsed
 * fence as that layer's `inference_contract`. A reconstruction that emitted only `text`
 * would therefore collapse an n-layer adapter into fewer layers and lose every
 * executable gate — and since a restore goes back through `buildHeaderMemoryAdapter`,
 * it would silently activate an adapter that is not the one snapshotted. That includes
 * the gate `tune` deliberately preserved instead of the one the caller submitted.
 *
 * WHAT IS NOT PERFECTLY LOSSLESS
 * Two limits are reported rather than hidden, through `boundary_complete` and
 * `contract_count` (plus `reward_signal` for whether the reward gate survived):
 *
 *   1. A layer that carries no contract and is not last has no recoverable boundary,
 *      because only a fence delimits one. `boundary_complete` is then false.
 *   2. Frontmatter is re-serialized from the normalized stored subset (the parser has no
 *      lossless YAML writer — see `toStoredAdapterFrontmatter`): scalars, one level of
 *      nested mappings, and string lists survive; YAML anchors, comments and unusual
 *      quoting inside the frontmatter block do not. A restore re-normalizes the same
 *      subset, so the round-trip is stable from the second write onward.
 */
import type { Memory } from '../../types/memory.js';
import { sha256Hex } from '../../utils/sha256.js';

/** How a snapshot's `content` was obtained. Recorded on every snapshot. */
export type SnapshotSource = 'stored-state' | 'submitted';

export interface ReconstructedStoredState {
  /** Durable adapter document rebuilt from the stored records. */
  markdown: string;
  /** SHA-256 of `markdown`. */
  digest: string;
  /** Always `stored-state`; kept as a field so a consumer never has to infer it. */
  source: SnapshotSource;
  /** Slug the document describes. */
  slug: string;
  /** Layer count the document carries. */
  layer_count: number;
  /** Contract fences re-emitted — the executable gates the document carries. */
  contract_count: number;
  /** Whether a stored `reward_signal` was re-emitted as a trailing section. */
  reward_signal: boolean;
  /**
   * False when the rebuilt document would re-parse into a different layer split than
   * the records it was built from: a non-final layer without a fence merges into its
   * successor, and a reward section after a fence-less last layer is read back as part
   * of that layer. A restore would then see different layer text.
   */
  boundary_complete: boolean;
}

const FRONTMATTER_ORDER = ['slug', 'version', 'inherits', 'chain_root', 'override'];

/** One frontmatter value in the normalized subset the parser reads back. */
function serializeValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const items = value
      .filter((item) => item !== undefined && item !== null)
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
    return items.length > 0 ? `[${items.join(', ')}]` : null;
  }
  return null;
}

/**
 * Serialize the stored frontmatter block.
 *
 * Known keys keep a stable order so two reconstructions of the same state are
 * byte-identical (which is what makes the digest a usable identity). Remaining
 * keys are sorted for the same reason — never map-iteration order.
 */
export function serializeStoredFrontmatter(frontmatter: Record<string, unknown>): string {
  const lines: string[] = [];
  const emitted = new Set<string>();

  const emit = (key: string): void => {
    if (emitted.has(key)) return;
    emitted.add(key);
    const value = frontmatter[key];
    const scalar = serializeValue(value);
    if (scalar !== null) {
      lines.push(`${key}: ${scalar}`);
      return;
    }
    // One level of nesting: the stored record may keep a nested declaration, and
    // dropping it would make the reconstruction describe a different adapter.
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = Object.entries(value as Record<string, unknown>)
        .map(([nestedKey, nestedValue]) => [nestedKey, serializeValue(nestedValue)] as const)
        .filter((entry): entry is readonly [string, string] => entry[1] !== null)
        .sort(([a], [b]) => a.localeCompare(b));
      if (nested.length > 0) {
        lines.push(`${key}:`);
        for (const [nestedKey, nestedValue] of nested) lines.push(`  ${nestedKey}: ${nestedValue}`);
      }
    }
  };

  for (const key of FRONTMATTER_ORDER) emit(key);
  for (const key of Object.keys(frontmatter).sort()) emit(key);
  return lines.join('\n');
}

/** Layer order is the document order; a missing index sorts last, not first. */
function layerIndex(layer: Memory): number {
  return layer.adapter?.layer_index ?? Number.MAX_SAFE_INTEGER;
}

/**
 * JSON with object keys sorted at every depth.
 *
 * A contract object arrives from `JSON.parse` in author order with `required` appended by
 * a spread, so two records of the same gate can hold the same keys in different orders.
 * Key order must not leak into the document, or a re-trained copy of an unchanged gate
 * would produce a different digest and defeat the no-change guard.
 */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * The layer's executable gate as the fenced block the converter reads back.
 *
 * `null` when the layer has no gate — inventing one would make a restore enforce a
 * contract the adapter never carried.
 */
function contractFence(layer: Memory): string | null {
  const contract = layer.inference_contract;
  if (!contract || typeof contract !== 'object') return null;
  return `\`\`\`json\n${stableJson({ contract })}\n\`\`\``;
}

/**
 * Rebuild the durable adapter document from stored layers.
 *
 * Returns `null` when the records carry no adapter identity — a document that
 * cannot name its own slug is not a snapshot worth taking.
 */
export function reconstructStoredAdapterMarkdown(layers: Memory[]): ReconstructedStoredState | null {
  if (layers.length === 0) return null;
  const ordered = [...layers].sort((a, b) => layerIndex(a) - layerIndex(b));
  const head = ordered.find((layer) => (layer.adapter?.layer_index ?? 1) === 1) ?? ordered[0]!;

  const slug = (head.slug ?? head.adapter?.name ?? '').trim();
  if (!slug) return null;

  const storedFrontmatter =
    head.adapter?.frontmatter && typeof head.adapter.frontmatter === 'object'
      ? (head.adapter.frontmatter as Record<string, unknown>)
      : {};
  const version =
    head.adapter?.protocol_version?.trim() ||
    (typeof storedFrontmatter['version'] === 'string' ? storedFrontmatter['version'].trim() : '') ||
    '0.0.0';
  // The identity the reconstructor knows for certain wins over a stale stored copy:
  // a snapshot must describe the record it was built from.
  const frontmatter = serializeStoredFrontmatter({ ...storedFrontmatter, slug, version });

  const title = (head.adapter?.name ?? slug).trim();
  const sections: string[] = [];
  let contractCount = 0;
  let boundaryComplete = true;
  let lastHasFence = false;

  for (let index = 0; index < ordered.length; index++) {
    const layer = ordered[index]!;
    const body = typeof layer.text === 'string' ? layer.text.trim() : '';
    if (body.length > 0) sections.push(body);

    const fence = contractFence(layer);
    lastHasFence = fence !== null;
    if (fence) {
      sections.push(fence);
      contractCount++;
    } else if (index < ordered.length - 1) {
      // Only a fence delimits a layer. Without one this layer merges into the next, so
      // the rebuilt document would restore as a different layer split.
      boundaryComplete = false;
    }
  }

  // The reward signal lives on the adapter, not in any layer's `text`, so it has to be
  // re-emitted explicitly or a restore silently drops the reward gate.
  const rewardSignal =
    ordered
      .map((layer) => (typeof layer.adapter?.reward_signal === 'string' ? layer.adapter.reward_signal.trim() : ''))
      .find((value) => value.length > 0) ?? '';
  if (rewardSignal.length > 0) {
    sections.push(rewardSignal);
    // The converter only recognizes a reward section that trails the *last fence*. After
    // a fence-less last layer it becomes part of that layer instead.
    if (!lastHasFence) boundaryComplete = false;
  }

  const markdown = `---\n${frontmatter}\n---\n\n# ${title}${sections.map((section) => `\n\n${section}`).join('')}\n`;
  return {
    markdown,
    digest: sha256Hex(markdown),
    source: 'stored-state',
    slug,
    layer_count: ordered.length,
    contract_count: contractCount,
    reward_signal: rewardSignal.length > 0,
    boundary_complete: boundaryComplete
  };
}
