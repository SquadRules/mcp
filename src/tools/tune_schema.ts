// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import { z } from 'zod';
import { ADAPTER_SLUG_URI_INPUT_REGEX, LAYER_URI_INPUT_REGEX } from './kairos-uri.js';

const adapterUriSchema = z
  .string()
  .regex(ADAPTER_SLUG_URI_INPUT_REGEX, 'must match kairos://adapter/{slug}');

const layerUriSchema = z
  .string()
  .regex(LAYER_URI_INPUT_REGEX, 'must match kairos://layer/{uuid}[?execution_id={uuid}]');

const tuneUriSchema = z.union([adapterUriSchema, layerUriSchema]);

export const tuneInputSchema = z
  .object({
    uris: z.array(tuneUriSchema).nonempty().describe('Non-empty array of adapter or layer URIs to update'),
    content: z.array(z.string().min(1)).optional().describe('Updated content bodies (one per URI)'),
    updates: z.record(z.string(), z.any()).optional().describe('Advanced field updates; prefer content for body changes'),
    space: z
      .union([z.literal('personal'), z.string()])
      .optional()
      .describe('Move all layers of each target adapter to this space ("personal" or group name), optionally after content updates'),
    review_evidence: z.object({
      verdict_file: z.string().describe('Absolute path to the phase-critic verdict file'),
      exit_code: z.number().describe('Shell exit code (must be 0)'),
      stdout: z.string().describe('Shell stdout (line 1 must be PASS)')
    }).optional().describe(
      'Phase-critic review evidence. Required when content is provided (adapter body edits). '
      + 'One PASS covers all URIs in the tune call.'
    )
  })
  .superRefine((value, ctx) => {
    if (value.content && value.content.length !== value.uris.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: 'content must have the same number of entries as uris'
      });
    }
    const hasSpace = typeof value.space === 'string' && value.space.trim().length > 0;
    if (!value.content && !value.updates && !hasSpace) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: 'Provide content, updates, or space'
      });
    }
    // review_evidence is required when content is provided (adapter body edits)
    const hasContent = Array.isArray(value.content) && value.content.some(s => typeof s === 'string' && s.trim().length > 0);
    if (hasContent && !value.review_evidence) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['review_evidence'],
        message: 'review_evidence is required when tune includes content updates. Run phase-critic first and provide the verdict file as proof.'
      });
    }
  });

export const tuneOutputSchema = z.object({
  results: z.array(z.object({
    uri: tuneUriSchema,
    status: z.enum(['updated', 'error']),
    message: z.string()
  })),
  total_updated: z.number(),
  total_failed: z.number()
}).strict();

export type TuneInput = z.infer<typeof tuneInputSchema>;
export type TuneOutput = z.infer<typeof tuneOutputSchema>;

