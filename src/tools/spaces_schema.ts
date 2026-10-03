// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import { z } from 'zod';

export const spacesInputSchema = z.object({
  include_adapter_titles: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true, include for each space a list of adapters with title and layer_count'),
  include_widget_html: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'If true, append an HTML table (second content part) with space types and expandable adapter rows; implies adapter titles are loaded'
    ),
  include_artifacts: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true, include artifact metadata per adapter (implies include_adapter_titles)')
});

const artifactInfoSchema = z.object({
  name: z.string(),
  slug: z.string(),
  uri: z.string(),
  uuid_uri: z.string(),
  content_type: z.string(),
  sha256: z.string(),
  relative_path: z.string().nullable()
});

const adapterInfoSchema = z.object({
  adapter_id: z.string(),
  title: z.string(),
  layer_count: z.number(),
  slug: z.string().nullable(),
  uri: z.string().describe('Ready-to-use kairos://adapter/{slug} URI for export, forward, etc.'),
  artifacts: z.array(artifactInfoSchema).optional()
});

const spaceInfoSchema = z.object({
  name: z.string(),
  space_id: z.string(),
  type: z.enum(['personal', 'group', 'app', 'other']),
  adapter_count: z.number(),
  adapters: z.array(adapterInfoSchema).optional()
});

export const spacesOutputSchema = z.object({
  spaces: z.array(spaceInfoSchema)
}).strict();
