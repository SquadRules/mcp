/**
 * Adapter documents for the real-HTTP graph suites.
 *
 * Documents are authored WITHOUT `slug:` on purpose. A fork train
 * (`source_adapter_uri`) preserves the submitted markdown verbatim when the author
 * omitted the slug, so `inherits:` / `override:` reach the writer and the routing
 * slug derives from the H1 — which is exactly the author experience the API exposes.
 * With an explicit `slug:` the fork would take the slug from frontmatter instead, and
 * the assertions below would stop proving the frontmatter path.
 *
 * Shared by every suite in this directory so one document shape backs every case.
 */

export interface HttpDocSpec {
  title: string;
  inherits?: string;
  override?: string[];
  /** Arbitrary author-declared frontmatter properties (domain data). */
  extra?: Record<string, string>;
  /** Body sections between `Activation Patterns` and the contract fence. */
  sections: Array<{ heading: string; body: string }>;
  /** The `contract` object placed in the single ```json fence. */
  contract: Record<string, unknown>;
}

/** A structurally valid adapter document with exactly one contract fence. */
export function httpAdapterDoc(spec: HttpDocSpec): string {
  const frontmatter = ['version: 1.0.0'];
  if (spec.inherits) frontmatter.push(`inherits: ${spec.inherits}`);
  if (spec.override && spec.override.length > 0) frontmatter.push(`override: [${spec.override.join(', ')}]`);
  for (const [key, value] of Object.entries(spec.extra ?? {})) frontmatter.push(`${key}: ${value}`);

  const lines = [
    '---',
    ...frontmatter,
    '---',
    '',
    `# ${spec.title}`,
    '',
    '## Activation Patterns',
    '',
    `- ${spec.title}`
  ];
  for (const section of spec.sections) lines.push('', `## ${section.heading}`, '', section.body);
  lines.push(
    '',
    '```json',
    JSON.stringify({ contract: spec.contract }),
    '```',
    '',
    '## Reward Signal',
    '',
    'Done.'
  );
  return lines.join('\n');
}

/** An empirical shell contract (a command whose exit code is the proof). */
export function shellContract(cmd: string): Record<string, unknown> {
  return { type: 'shell', shell: { cmd, interpreter: 'bash' } };
}
