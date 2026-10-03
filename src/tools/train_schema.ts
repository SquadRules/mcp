// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import { z } from 'zod';
import { normalizeArtifactRelativePath } from './artifact-relative-path.js';
import { ADAPTER_SLUG_URI_INPUT_REGEX } from './kairos-uri.js';
import { inferArtifactMimeFromName } from './artifact-mime.js';

function refineTrainRelativePath(
  value: {
    mime?: string | undefined;
    relative_path?: string | undefined;
    artifact_name?: string | undefined;
    adapter_uri?: string | undefined;
  },
  ctx: z.RefinementCtx
): void {
  const mime = typeof value.mime === 'string' ? value.mime.trim() : '';
  const artifactName = typeof value.artifact_name === 'string' ? value.artifact_name.trim() : '';
  const adapterUri = typeof value.adapter_uri === 'string' ? value.adapter_uri.trim() : '';
  const inferredMime = mime.length === 0 ? inferArtifactMimeFromName(artifactName) : null;
  const artifactMode =
    (mime.length > 0 && mime !== 'text/markdown') ||
    (mime.length === 0 && artifactName.length > 0 && adapterUri.length > 0 && typeof inferredMime === 'string');
  const rawRp = typeof value.relative_path === 'string' ? value.relative_path.trim() : '';
  if (!rawRp) {
    return;
  }
  if (!artifactMode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['relative_path'],
      message:
        'relative_path is only allowed for artifact train rows (non-markdown mime or inferable artifact_name extension)'
    });
    return;
  }
  if (!normalizeArtifactRelativePath(rawRp)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['relative_path'],
      message:
        'relative_path must be a skill-root-relative path without .. segments (use forward slashes)'
    });
  }
}

const adapterUriSchema = z
  .string()
  .regex(ADAPTER_SLUG_URI_INPUT_REGEX, 'must match kairos://adapter/{slug}');

const sourceAdapterUriSchema = z
  .string()
  .regex(ADAPTER_SLUG_URI_INPUT_REGEX, 'must match kairos://adapter/{slug}')
  .describe('Optional fork source: export markdown from this adapter, then train into target space');

export const trainInputSchema = z
  .object({
    content: z
      .string()
      .optional()
      .describe(
        'Content to store. For adapters: protocol markdown. For artifacts: script/config source. Format determined by mime parameter.'
      ),
    llm_model_id: z.string().min(1).describe('LLM model ID'),
    force_update: z.boolean().optional().default(false).describe('Overwrite an existing adapter with the same label'),
    protocol_version: z.string().optional().describe('Adapter version (for example, semver)'),
    space: z.union([z.literal('personal'), z.string()]).optional().describe('Target space: "personal" or a group name'),
    source_adapter_uri: sourceAdapterUriSchema.optional().describe(
      'Fork from an existing adapter (personal/group copy); optional content overrides exported body'
    ),
    mime: z
      .string()
      .optional()
      .describe(
        'Content MIME type. Omit or set "text/markdown" for adapters. For artifacts this is optional when artifact_name has a recognized extension (.py, .sh, .js, .toml, .yaml, .yml, .txt).'
      ),
    artifact_name: z
      .string()
      .optional()
      .describe('Artifact file name. Required for artifact mode and MIME inference.')
    ,
    adapter_uri: adapterUriSchema
      .optional()
      .describe('Attach artifact to an existing adapter. Required when mime is non-markdown.'),
    relative_path: z
      .string()
      .optional()
      .describe(
        'Optional path relative to the skill root for this artifact (preserved on skill export). Forward slashes; no .. segments.'
      ),
    review_evidence: z.object({
      verdict_file: z.string().describe('Absolute path to the phase-critic verdict file'),
      exit_code: z.number().describe('Shell exit code (must be 0)'),
      stdout: z.string().describe('Shell stdout (line 1 must be PASS)')
    }).optional().describe(
      'Phase-critic review evidence. Required for adapter (markdown) train calls. '
      + 'Provide the verdict file path and shell proof that phase-critic returned PASS.'
    )
  })
  .superRefine((value, ctx) => {
    const md = typeof value.content === 'string' ? value.content.trim() : '';
    const src = typeof value.source_adapter_uri === 'string' ? value.source_adapter_uri.trim() : '';
    if (md.length === 0 && !src) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: 'Provide content and/or source_adapter_uri'
      });
    }

    const mime = typeof value.mime === 'string' ? value.mime.trim() : '';
    const artifactName = typeof value.artifact_name === 'string' ? value.artifact_name.trim() : '';
    const adapterUri = typeof value.adapter_uri === 'string' ? value.adapter_uri.trim() : '';

    if (mime.length > 0 && mime !== 'text/markdown') {
      if (!value.artifact_name?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['artifact_name'],
          message: 'artifact_name is required when mime is non-markdown'
        });
      }
      if (!value.adapter_uri?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['adapter_uri'],
          message: 'adapter_uri is required when mime is non-markdown'
        });
      }
    } else if (mime.length === 0 && (artifactName.length > 0 || adapterUri.length > 0)) {
      if (artifactName.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['artifact_name'],
          message: 'artifact_name is required for artifact inference when adapter_uri is provided'
        });
      }
      if (adapterUri.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['adapter_uri'],
          message: 'adapter_uri is required when training an artifact'
        });
      }
      if (artifactName.length > 0 && adapterUri.length > 0) {
        const inferred = inferArtifactMimeFromName(artifactName);
        if (!inferred) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['mime'],
            message:
              'mime is required when artifact_name extension is unknown (for example use .py, .sh, .js, .toml, .yaml, .yml, .txt)'
          });
        }
      }
    } else if (mime === 'text/markdown' && (artifactName.length > 0 || adapterUri.length > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mime'],
        message: 'artifact fields are only valid when mime is a non-markdown artifact type'
      });
    }

    refineTrainRelativePath(value, ctx);

    // review_evidence is required for adapter (markdown) trains, not for artifacts or forks
    const hasArtifactFields = artifactName.length > 0 && adapterUri.length > 0;
    const isArtifact = (mime.length > 0 && mime !== 'text/markdown') || hasArtifactFields;
    if (!isArtifact && value.content && !value.review_evidence) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['review_evidence'],
        message: 'review_evidence is required for adapter (markdown) train calls. Run phase-critic first and provide the verdict file as proof.'
      });
    }
  });

export const trainOutputSchema = z.object({
  items: z.array(z.object({
    uri: z.string(),
    layer_uuid: z.string().optional(),
    artifact_uuid: z.string().optional(),
    adapter_uri: adapterUriSchema.optional(),
    label: z.string(),
    tags: z.array(z.string()),
    content_type: z.string().optional()
  })),
  status: z.literal('stored')
}).strict();

export type TrainInput = z.infer<typeof trainInputSchema>;
export type TrainOutput = z.infer<typeof trainOutputSchema>;

/** Internal: validated markdown + model for the low-level store step (after fork resolution). */
const memoryUriSchema = z
  .string()
  .regex(/^(?:kairos|squadrules):\/\/(layer|artifact)\/[0-9a-f-]{36}$/i, 'must match kairos://layer/{uuid} or kairos://artifact/{uuid} (squadrules:// also accepted)');

export const trainStoreInputSchema = z.object({
  content: z.string().min(1).describe('Content to store'),
  llm_model_id: z.string().min(1).describe('LLM model ID'),
  force_update: z.boolean().optional().default(false).describe('Overwrite an existing adapter with the same label'),
  protocol_version: z.string().optional().describe('Protocol version (e.g. semver). Overrides or supplies version when document has no frontmatter.'),
  space: z.union([z.literal('personal'), z.string()]).optional().describe('Target space: "personal" (default) or group name to train into that group space'),
  mime: z.string().optional().describe('MIME type for content'),
  artifact_name: z.string().optional().describe('Artifact name for non-markdown content'),
  adapter_uri: adapterUriSchema.optional().describe('Target adapter URI for attached artifacts'),
  fork_new_adapter: z
    .boolean()
    .optional()
    .describe('Internal: allocate new adapter id (train fork from source_adapter_uri)'),
  relative_path: z
    .string()
    .optional()
    .describe('Normalized skill-root-relative path for artifact storage (internal)')
})
  .superRefine((value, ctx) => {
    refineTrainRelativePath(value, ctx);
  });

export const trainStoreOutputSchema = z.object({
  items: z.array(
    z.object({
      uri: memoryUriSchema,
      memory_uuid: z.string().optional(),
      layer_uuid: z.string().optional(),
      artifact_uuid: z.string().optional(),
      adapter_uri: adapterUriSchema.optional(),
      label: z.string(),
      tags: z.array(z.string()),
      content_type: z.string().optional()
    })
  ),
  status: z.literal('stored')
});

export type TrainStoreInput = z.infer<typeof trainStoreInputSchema>;
export type TrainStoreOutput = z.infer<typeof trainStoreOutputSchema>;
