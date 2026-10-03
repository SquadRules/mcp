import { z } from 'zod';
import {
  ADAPTER_SLUG_URI_INPUT_REGEX,
  ARTIFACT_URI_INPUT_REGEX,
  LAYER_URI_INPUT_REGEX
} from './squadrules-uri.js';

const adapterUriSchema = z
  .string()
  .regex(ADAPTER_SLUG_URI_INPUT_REGEX, 'must match squadrules://adapter/{slug}');

const layerUriSchema = z
  .string()
  .regex(LAYER_URI_INPUT_REGEX, 'must match squadrules://layer/{uuid}[?execution_id={uuid}]');

const artifactUriSchema = z
  .string()
  .regex(ARTIFACT_URI_INPUT_REGEX, 'must match squadrules://artifact/{uuid|slug}');

const adapterOrLayerUriSchema = z.union([adapterUriSchema, layerUriSchema, artifactUriSchema]);

export const EXPORT_MAX_ADAPTERS = 256;

export const exportFormatSchema = z.enum([
  'markdown',
  'trace_jsonl',
  'reward_jsonl',
  'sft_jsonl',
  'preference_jsonl',
  'source',
  'skill_tree',
  'skill_zip'
]);

export const exportDeliverySchema = z.enum(['download_ref', 'inline_base64']);

const TRAINING_FORMATS = new Set([
  'trace_jsonl',
  'reward_jsonl',
  'sft_jsonl',
  'preference_jsonl'
]);

export const exportInputSchema = z
  .object({
    uri: adapterOrLayerUriSchema.optional(),
    adapters: z.array(z.string().min(1)).max(EXPORT_MAX_ADAPTERS).optional(),
    all_adapters: z.boolean().optional(),
    space_name: z.string().optional(),
    format: exportFormatSchema.optional().default('skill_zip'),
    delivery: exportDeliverySchema.optional(),
    include_reward: z.boolean().optional().default(true)
  })
  .superRefine((data, ctx) => {
    const uriTrim = typeof data.uri === 'string' ? data.uri.trim() : '';
    const hasUri = uriTrim.length > 0;
    const hasList = Boolean(data.adapters && data.adapters.length > 0);
    const hasAll = data.all_adapters === true;
    const modes = (hasUri ? 1 : 0) + (hasList ? 1 : 0) + (hasAll ? 1 : 0);

    if (modes !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Exactly one selection mode: `uri`, or non-empty `adapters`, or `all_adapters: true` with `space_name`.'
      });
      return;
    }

    if (hasAll) {
      const sn = typeof data.space_name === 'string' ? data.space_name.trim() : '';
      if (!sn) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '`space_name` is required when `all_adapters` is true.'
        });
      }
    }

    if (data.format === 'markdown' && (hasList || hasAll)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          '`format: markdown` (flat adapter Markdown, single file) requires a single `uri` selection. Use `skill_tree` or `skill_zip` for multi-adapter bundles.'
      });
    }

    const singleUriFormats = TRAINING_FORMATS.has(data.format) || data.format === 'source';
    if (singleUriFormats) {
      if (!hasUri || hasList || hasAll) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `format "${data.format}" requires a single adapter or layer \`uri\` (not adapters list or all_adapters).`
        });
      }
    }

    if (hasList && data.adapters) {
      if (data.adapters.length > EXPORT_MAX_ADAPTERS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `At most ${EXPORT_MAX_ADAPTERS} adapters per export.`
        });
      }
    }

    if (data.delivery !== undefined && data.format !== 'skill_zip') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '`delivery` is only valid with `format: skill_zip`.'
      });
    }
  });

const spaceTypeSchema = z.enum(['personal', 'group', 'app', 'other']);

export const exportDownloadRefSchema = z.object({
  url: z.string(),
  expires_at: z.string(),
  filename: z.string().optional(),
  content_type: z.string().optional()
});

export const exportOutputSchema = z.object({
  uri: z.string(),
  format: exportFormatSchema,
  content_type: z.string(),
  content: z.string(),
  item_count: z.number().optional(),
  adapter_name: z.string().nullable().optional(),
  adapter_version: z.string().nullable().optional(),
  /** Present for markdown adapter exports when the layer payload includes space_id. */
  space_id: z.string().nullable().optional(),
  space_name: z.string().nullable().optional(),
  space_type: spaceTypeSchema.optional(),
  /** When set, `content` is base64-encoded (for example ZIP bytes). */
  content_encoding: z.enum(['base64']).optional(),
  /** SHA-256 of decoded export bytes when applicable (for example ZIP). */
  bundle_sha256: z.string().optional(),
  /** Number of adapters included in a multi-export bundle. */
  export_adapter_count: z.number().optional(),
  /** Optional compact manifest JSON string for skill bundles. */
  skill_bundle_manifest: z.string().optional(),
  /** Short-lived capability URL for downloading ZIP bytes outside `/api`. */
  download_ref: exportDownloadRefSchema.optional()
});

export type ExportInput = z.infer<typeof exportInputSchema>;
export type ExportOutput = z.infer<typeof exportOutputSchema>;
