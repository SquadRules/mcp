/**
 * Derive skill frontmatter name, description, and directory slug from protocol markdown and labels.
 */

import { slugifyFromTitle } from '../../utils/protocol-slug.js';

const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

function parseYamlLineValue(block: string, key: string): string | undefined {
  const re = new RegExp(`^${key}\\s*:\\s*(.*)$`, 'im');
  const m = block.match(re);
  if (!m?.[1]) return undefined;
  const v = m[1].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1).trim();
  }
  return v || undefined;
}

function firstParagraphAfterH1(markdown: string): string {
  const body = markdown.replace(FRONTMATTER_BLOCK, '').trim();
  const lines = body.split(/\r?\n/);
  let i = 0;
  if (lines[0]?.match(/^#\s+/)) {
    i = 1;
  }
  while (i < lines.length && lines[i]?.trim() === '') i++;
  const para: string[] = [];
  for (; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '') break;
    if (/^#{1,6}\s/.test(line.trim())) break;
    para.push(line);
  }
  const t = para.join(' ').trim();
  return t.length > 500 ? `${t.slice(0, 497)}...` : t;
}

export interface DeriveMetadataInput {
  /** Full protocol markdown (may include frontmatter). */
  protocolMarkdown: string;
  /** Memory / adapter label fallback. */
  label: string;
  /** Persisted slug when present. */
  memorySlug?: string | null;
  /** Adapter name from memory. */
  adapterName?: string | null;
  /** Canonical adapter URI for echo. */
  squadrulesUri: string;
}

export interface DerivedSkillMetadata {
  slug: string;
  name: string;
  description: string;
}

/**
 * Derive exported skill metadata per architecture doc (name, description, slug priority).
 */
export function deriveSkillMetadata(input: DeriveMetadataInput): DerivedSkillMetadata {
  const raw = input.protocolMarkdown;
  const fmMatch = raw.match(FRONTMATTER_BLOCK);
  const fm = fmMatch?.[1] ?? '';

  const nameFromFm = parseYamlLineValue(fm, 'name');
  const slugFromFm = parseYamlLineValue(fm, 'slug');
  const descFromFm = parseYamlLineValue(fm, 'description');

  const bodyForH1 = raw.replace(FRONTMATTER_BLOCK, '').trim();
  const h1 = bodyForH1.match(/^#\s+(.+)$/m);
  const titleFromH1 = h1?.[1]?.trim();

  const name =
    nameFromFm ||
    slugFromFm ||
    (input.memorySlug && input.memorySlug.trim()) ||
    (input.adapterName && input.adapterName.trim()) ||
    titleFromH1 ||
    input.label.trim() ||
    'protocol';

  let slug =
    (input.memorySlug && input.memorySlug.trim()) ||
    slugFromFm ||
    slugifyFromTitle(nameFromFm || titleFromH1 || input.adapterName || input.label || 'protocol');

  slug = slugifyFromTitle(slug);

  const description =
    descFromFm ||
    firstParagraphAfterH1(raw) ||
    (input.adapterName && input.adapterName.trim()) ||
    input.label.trim() ||
    name;

  return { slug, name, description };
}

/**
 * Strip leading YAML frontmatter from protocol text for SKILL body (frontmatter regenerated for skill shape).
 */
export function stripLeadingFrontmatter(markdown: string): string {
  const t = markdown.trim();
  if (!t.startsWith('---')) return markdown;
  const m = t.match(FRONTMATTER_BLOCK);
  if (!m) return markdown;
  return t.slice(m[0].length).trim();
}

