// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import { z } from 'zod';
import { KAIROS_SEARCH_LIMIT_CAP, KAIROS_SEARCH_LIMIT_MIN } from '../config.js';
import { ADAPTER_SLUG_URI_INPUT_REGEX } from './kairos-uri.js';

const adapterSlugUriSchema = z
  .string()
  .regex(ADAPTER_SLUG_URI_INPUT_REGEX, 'must match kairos://adapter/{slug}');

const choiceUriSchema = adapterSlugUriSchema;

export const searchInputSchema = z.object({
  query: z.string().min(1).describe('Search query for adapter matches'),
  space: z
    .string()
    .optional()
    .describe('Scope results to this space: "personal", a group name, "Group: …", or your space id'),
  space_id: z.string().optional().describe('Alias for space'),
  max_choices: z
    .number()
    .int()
    .min(KAIROS_SEARCH_LIMIT_MIN)
    .max(KAIROS_SEARCH_LIMIT_CAP)
    .optional()
    .describe('Max match choices to return. Omit for server default; use higher for broad/vague queries.')
});

export const searchOutputSchema = z.object({
  must_obey: z.boolean().describe('Always true. Follow next_action.'),
  message: z.string().describe('Human-readable summary'),
  next_action: z.string().describe("Global directive: pick one choice and follow that choice's next_action."),
  choices: z.array(z.object({
    uri: choiceUriSchema,
    label: z.string(),
    adapter_name: z.string().nullable(),
    score: z.number().min(0).max(1).nullable().describe('Normalized 0.0-1.0 confidence for matches, null for refine/create'),
    role: z.enum(['match', 'refine', 'create']).describe('match = search result, refine = search again, create = system action'),
    tags: z.array(z.string()),
    next_action: z.string().describe('Instruction for this choice.'),
    adapter_version: z.string().nullable().describe('Stored adapter version (for example, semver) for match choices; null for refine/create. Compare with bundled adapter metadata to decide if re-training is needed.'),
    activation_patterns: z.array(z.string()).optional().describe('Activation phrases associated with this adapter'),
    space_name: z
      .string()
      .nullable()
      .describe('Human-readable space for stored adapters (Personal, Group: …, Squadrules app); null for refine/create'),
    slug: z
      .string()
      .nullable()
      .describe(
        'Adapter routing slug when stored (use with kairos://adapter/{slug} in forward); null for refine/create or when absent'
      )
  })).describe('Options: match(es) first, then refine (if present), then create (if present).')
}).strict();

export type SearchInput = z.infer<typeof searchInputSchema>;
export type SearchOutput = z.infer<typeof searchOutputSchema>;
