import { authoringContextSchema } from './authoring-context.js';
import { z } from 'zod';
import { SQUADRULES_SEARCH_LIMIT_CAP, SQUADRULES_SEARCH_LIMIT_MIN } from '../config.js';

const adapterUriSchema = z
  .string()
  .regex(
    /^squadrules:\/\/adapter\/([0-9a-f-]{36}|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/i,
    'must match squadrules://adapter/{slug}'
  );
const adapterSlugUriSchema = z
  .string()
  .regex(
    /^squadrules:\/\/adapter\/([0-9a-f-]{36}|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/i,
    'must match squadrules://adapter/{slug}'
  );
const forwardFirstCallSchema = z
  .object({
    uri: adapterSlugUriSchema,
    authoring: authoringContextSchema.optional()
  })
  .strict();
const executionIdSchema = z
  .string()
  .regex(/^[0-9a-f-]{36}$/i, 'must be a UUID');
const materializeInstructionSchema = z
  .object({
    method: z.literal('url').describe('Always `url`: `cmd` downloads the bytes from `url` on every transport'),
    url: z
      .string()
      .describe('Source URL `cmd` downloads: a file:// cache path on stdio, an http(s) capability URL on HTTP'),
    out: z.string().describe('Path where the bytes land (uses $SQUADRULES_LOCAL_ARTIFACT_DIR)'),
    sha256: z.string().describe('SHA-256 hex of the artifact bytes; `cmd` verifies it'),
    chmod: z.literal('700').describe('File permissions `cmd` sets on the verified bytes before publishing'),
    cmd: z
      .string()
      .describe('Exact POSIX shell line that downloads, verifies the digest, chmods, and atomically publishes. Run it verbatim.')
  })
  .strict();
const linkedArtifactSchema = z
  .object({
    slug: z.string(),
    filename: z.string(),
    relative_path: z.string().nullable(),
    download_url: z.string().describe('Source URL for the artifact bytes: a file:// cache path on stdio, a short-lived capability URL on HTTP. Prefer running materialize.cmd over fetching it yourself.'),
    sha256: z.string(),
    content_type: z.string(),
    materialize: materializeInstructionSchema.describe('Run `cmd` verbatim to materialize the artifact: it curls `url`, verifies the sha256 digest, and publishes atomically — no export call and no $B64')
  })
  .strict();
/**
 * Effective (inheritance-resolved) adapter content surfaced for the top match so the
 * agent sees exactly what `forward` will execute. Identity (slug/version) stays the
 * child's; `content` is the merged markdown body carrying the inherited contract blocks,
 * steps, judgment_criteria, timeout and interpreter. See Touchpoint 2b / Option A.
 */
const effectiveContractSchema = z
  .object({
    source: z.string().describe('Adapter slug that supplied the section holding this contract'),
    heading: z.string().describe('Section heading the contract fence lives in'),
    contract: z.unknown().describe('The parsed contract object exactly as it appears in the merged body')
  })
  .strict();
const mergedAdapterContentSchema = z
  .object({
    slug: z.string().describe('Child adapter slug — identity stays with the activated child'),
    version: z.string().nullable().describe('Child adapter version — identity stays with the activated child'),
    content: z.string().describe('Effective (merged) markdown body the agent executes, including inherited contract blocks and steps'),
    inheritance_chain: z.array(z.string()).describe('Inheritance chain slugs, child-to-root'),
    resolved: z.boolean().describe('False when the stored ancestry could not be fully materialised'),
    resolved_reason: z
      .string()
      .optional()
      .describe('Why resolution is incomplete (for example parent_missing); present exactly when resolved is false'),
    lineage: z.array(z.string()).describe('Contributing adapter slugs, root-first with the child last'),
    lineage_truncated: z
      .boolean()
      .describe('True when SQUADRULES_TREE_DISPLAY_DEPTH trimmed the displayed lineage; content is never trimmed'),
    overrides: z.record(z.string(), z.string()).describe('Section heading -> slug that explicitly overrode the inherited section'),
    effective_contracts: z
      .array(effectiveContractSchema)
      .describe('Contract fences in the merged body, nearest level first; the first entry is the contract forward executes')
  })
  .strict();
const activationContextSchema = z
  .object({
    task: z
      .string()
      .min(1)
      .optional()
      .describe(
        'What the caller is doing right now (for example "create_adapter"). Describes the request; it never widens the search scope.'
      ),
    domain: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Domain of the request (for example "python"). Overrides the domain declared on the stored adapter. Describes the request; it never widens the search scope.'
      )
  })
  .strict();
const ontologyEvidenceRowSchema = z.object({ key: z.string(), detail: z.string() }).strict();
const ontologyContextSchema = z
  .object({
    scope: z
      .object({
        adapter_key: z.string().describe('Scoped graph key adapter:<spaceId>:<slug>'),
        space_id: z.string().describe('Space the context was read from'),
        space_source: z.string().describe('How that space was resolved (stored-record, stored-content-policy, write-context)')
      })
      .strict(),
    context: z
      .object({
        task: z.string().nullable(),
        domain: z.string().nullable(),
        human: z.string().nullable().describe('Runtime actor identity, never a document-supplied value'),
        org: z.string().nullable().describe('A permitted group space only; never a global lookup'),
        sources: z.record(z.string(), z.string()).describe('Where each non-null context value came from')
      })
      .strict(),
    concept: z
      .object({
        key: z.string(),
        name: z.string(),
        baseline_attributes: z.record(z.string(), z.unknown())
      })
      .strict()
      .nullable(),
    relationships: z.array(
      z.object({ type: z.enum(['inherits', 'concept']), target: z.string(), depth: z.number() }).strict()
    ),
    evidence: z
      .object({
        open_anomalies: z.number(),
        pending_proposals: z.number(),
        accepted_proposals: z.number(),
        version_snapshots: z.number(),
        anomalies: z.array(ontologyEvidenceRowSchema),
        proposals: z.array(ontologyEvidenceRowSchema)
      })
      .strict(),
    evolution: z
      .object({
        current_adapter_version: z.string().nullable(),
        current_snapshot: z.string().nullable(),
        applied: z.array(
          z
            .object({
              version_number: z.string(),
              adapter_version: z.string(),
              change_type: z.enum(['created', 'updated', 'restored', 'deprecated', 'deleted']),
              changed_at: z.string(),
              changed_by: z.string(),
              reason: z.string(),
              content_digest: z.string().describe('SHA-256 of that snapshot bytes: integrity, not truth of a claim')
            })
            .strict()
        ),
        resolution_notes: z.array(z.string()),
        explanation: z.string().describe('Which snapshot is current and what accepted evolution it reflects')
      })
      .strict(),
    degraded: z.string().nullable().describe('Set when part of the projection could not be read')
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
      'Adapter routing slug when stored (use with squadrules://adapter/{slug} in forward); null for refine/create or when absent'
    )
});
const activateMatchChoiceSchema = activateChoiceCommonSchema.extend({
  role: z.literal('match'),
  forward_first_call: forwardFirstCallSchema,
  linked_artifacts: z.array(linkedArtifactSchema).optional(),
  merged_adapter_content: mergedAdapterContentSchema
    .optional()
    .describe('Effective inheritance-resolved content forward executes; present on the top match when the graph DB resolved inheritance')
});
const activateRefineChoiceSchema = activateChoiceCommonSchema.extend({
  role: z.literal('refine'),
  forward_first_call: forwardFirstCallSchema,
  linked_artifacts: z.array(linkedArtifactSchema).optional()
});
const activateCreateChoiceSchema = activateChoiceCommonSchema.extend({
  role: z.literal('create'),
  forward_first_call: z.null()
});

export const activateInputSchema = z.object({
  authoring: authoringContextSchema.optional().describe("For adapter create/review/update requests, supply the operation and existing target URI for review/update. Routes to the authoring workflow, not execution of the target."),
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
  context: activationContextSchema
    .optional()
    .describe(
      'Explicit retrieval context for graph-backed ontology retrieval. It is descriptive only and never enables a cross-space search.'
    ),
  max_choices: z
    .number()
    .int()
    .min(SQUADRULES_SEARCH_LIMIT_MIN)
    .max(SQUADRULES_SEARCH_LIMIT_CAP)
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
   * `project://<rel>` → `<client project root>/<rel>`; `user://<rel>` → `<client home>/<rel>`.
   * Use `project://` when you have exactly one project context; fall through to `user://` when your session
   * spans multiple projects. Export the resolved absolute path as `SQUADRULES_LOCAL_ARTIFACT_DIR` for shell
   * challenges. The server never resolves these to a path on its own filesystem.
   */
  squadrules_local_artifact_dir: z.array(z.string()).optional(),
  transport: z.enum(['stdio', 'http']).optional().describe('MCP transport mode. When "stdio", no HTTP listener is available; linked-artifact materialize URLs are file:// paths from the server\'s local cache, and materialize.cmd curls them like any other URL.'),
  /** Ordered list of adapter slugs from child to root. Empty when no inheritance exists. */
  inheritance_chain: z.array(z.string()).optional().describe('Inheritance chain slugs from child to root (empty if no inheritance)'),
  /** True when the graph DB resolved the inheritance chain; false on graceful degradation. */
  inheritance_resolved: z.boolean().optional().describe('Whether the graph DB resolved inheritance (false = graceful degradation)'),
  /** Scoped graph-backed ontology context: relationships, evidence and applied evolution. Absent when unavailable. */
  ontology_context: ontologyContextSchema
    .optional()
    .describe('Scoped ontology context for the top match: inheritance relationships, open anomalies, proposals and applied evolution. Read-only; no raw graph query surface.')
}).strict();

export type ActivateInput = z.infer<typeof activateInputSchema>;
export type ActivateOutput = z.infer<typeof activateOutputSchema>;
