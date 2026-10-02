// squadrules-compat-surface: reads the stored "# kairos-artifact:" metadata delimiter written into existing artifacts
const ARTIFACT_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export interface ArtifactMetadata {
  slug: string;
  version: string;
  slug_source: 'header' | 'name';
}

function normalizeArtifactSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

function deriveSlugFromArtifactName(artifactName: string): string {
  const normalized = artifactName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  if (!normalized) {
    throw new Error(`Could not derive artifact slug from artifact_name "${artifactName}"`);
  }
  if (!ARTIFACT_SLUG_REGEX.test(normalized)) {
    throw new Error(`Derived artifact slug "${normalized}" is invalid`);
  }
  return normalized;
}

function parseTopHeader(content: string): { slug?: string; version?: string } {
  const lines = content.split(/\r?\n/);
  let index = 0;

  if (lines[index]?.startsWith('#!')) {
    index += 1;
  }
  while (index < lines.length && lines[index]?.trim() === '') {
    index += 1;
  }

  if (!lines[index]?.trim().startsWith('# kairos-artifact:')) {
    return {};
  }

  index += 1;
  const output: { slug?: string; version?: string } = {};
  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith('#')) break;

    const body = trimmed.slice(1).trim();
    const sep = body.indexOf(':');
    if (sep <= 0) continue;
    const key = body.slice(0, sep).trim();
    const value = body.slice(sep + 1).trim();
    if (!value) continue;
    if (key === 'slug') output.slug = value;
    if (key === 'version') output.version = value;
  }
  return output;
}

export function extractArtifactMetadata(content: string, artifactName: string): ArtifactMetadata {
  const parsed = parseTopHeader(content);
  const slugSource = parsed.slug ? 'header' : 'name';
  const slug = normalizeArtifactSlug(parsed.slug ?? deriveSlugFromArtifactName(artifactName));
  if (!ARTIFACT_SLUG_REGEX.test(slug)) {
    throw new Error(`Invalid artifact slug "${slug}". Use lowercase letters, numbers, and hyphens.`);
  }
  const version = parsed.version && parsed.version.trim().length > 0 ? parsed.version.trim() : '1';
  return {
    slug,
    version,
    slug_source: slugSource
  };
}
