// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import { z } from 'zod';
import { KAIROS_SEARCH_LIMIT_CAP, KAIROS_SEARCH_LIMIT_MIN } from '../config.js';

const adapterUriSchema = z
  .string()
  .regex(
    /^(?:kairos|squadrules):\/\/adapter\/([0-9a-f-]{36}|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/i,
    'must match kairos://adapter/{slug} (squadrules:// also accepted)'
  );
const adapterSlugUriSchema = z
  .string()
  .regex(
    /^(?:kairos|squadrules):\/\/adapter\/([0-9a-f-]{36}|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/i,
    'must match kairos://adapter/{slug} (squadrules:// also accepted)'
  );
const forwardFirstCallSchema = z
  .object({
    uri: adapterSlugUriSchema
  })
  .strict();
const executionIdSchema = z
  .string()
  .regex(/^[0-9a-f-]{36}$/i, 'must be a UUID');
const linkedArtifactSchema = z
  .object({
    slug: z.string(),
    filename: z.string(),
    relative_path: z.string().nullable(),
    download_url: z.string(),
    sha256: z.string(),
    content_type: z.string(),
    materialize: z.string().describe('Shell command to download + verify this artifact into $KAIROS_LOCAL_ARTIFACT_DIR')
  })
  .strict();
const activateChoiceCommonSchema = z.object({
  uri: adapterUriSchema,
  label: z.string().describe('Display label for the adapter choice'),
  adapter_name: z.string().nullable().describe('Adapter title when this choice maps to a stored adapter'),
  activation_score: z.number().min(0).max(1).nullable().describe('Normalized 0.0-1.0 confidence for matches, null for refine/create'),
  tags: z.array(z.string()),
  next_action: z.string().describe('Instruction for this choice, typically a forward call'),
  adapter_version: z.string().nullable().describe('Stored adapter version when present'),
  activation_patterns: z.array(z.string()).optional().describe('Activation phrases associated with this adapter'),
  space_name: z
    .string()
    .nullable()
    .describe('Human-readable space where the adapter is stored; null for refine/create choices'),
  slug: z
    .string()
    .nullable()
    .describe(
      'Adapter routing slug when stored (use with kairos://adapter/{slug} in forward); null for refine/create or when absent'
    )
});
const activateMatchChoiceSchema = activateChoiceCommonSchema.extend({
  role: z.literal('match'),
  forward_first_call: forwardFirstCallSchema,
  linked_artifacts: z.array(linkedArtifactSchema).optional()
});
const activateRefineChoiceSchema = activateChoiceCommonSchema.extend({
  role: z.literal('refine'),
  forward_first_call: forwardFirstCallSchema
});
const activateCreateChoiceSchema = activateChoiceCommonSchema.extend({
  role: z.literal('create'),
  forward_first_call: z.null()
});

export const activateInputSchema = z.object({
  query: z.string().min(1).describe('Activation query used to find the best matching adapter'),
  execution_id: executionIdSchema
    .optional()
    .describe(
      'Server-issued execution id for a refinement sequence. Echo this back when re-running activate to refine the query for the same user request.'
    ),
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
    .describe('Maximum adapter choices to return')
});

export const activateOutputSchema = z.object({
  must_obey: z.boolean().describe('Always true. Pick one adapter and follow next_action.'),
  message: z.string(),
  next_action: z.string().describe("Global directive: pick one choice and follow that choice's next_action."),
  execution_id: executionIdSchema
    .optional()
    .describe(
      'Server-issued execution id for this activation run. Echo this id back when re-running activate with a refined query.'
    ),
  /** Echo of the request query for MCP App / HTTP clients (human-facing headers). */
  query: z.string().describe('Same string as the activate input query.'),
  choices: z.array(
    z.discriminatedUnion('role', [
      activateMatchChoiceSchema,
      activateRefineChoiceSchema,
      activateCreateChoiceSchema
    ])
  ),
  /**
   * Ordered URI hints (preferred first) for the run's local handoff dir. Resolve **on the client**:
   * `project://<rel>` → `<client project root>/<rel>`; `user://<rel>` → `<client home or $XDG_CONFIG_HOME>/<rel>`.
   * Use `project://` when you have exactly one project context; fall through to `user://` when your session
   * spans multiple projects. Export the resolved absolute path as `KAIROS_LOCAL_ARTIFACT_DIR` for shell
   * challenges. The server never resolves these to a path on its own filesystem.
   */
  kairos_local_artifact_dir: z.array(z.string()).optional(),
  /** Compatibility alias for kairos_local_artifact_dir (same value). */
  squadrules_local_artifact_dir: z.array(z.string()).optional()
}).strict();

export type ActivateInput = z.infer<typeof activateInputSchema>;
export type ActivateOutput = z.infer<typeof activateOutputSchema>;
