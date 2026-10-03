// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import { z } from 'zod';

const CANONICAL_LAYER_URI = /^(?:kairos|squadrules):\/\/layer\/[0-9a-f-]{36}(?:\?execution_id=[0-9a-f-]{36})?$/i;
/** Transitional ingest: older ambiguous surface that still meant a layer row UUID. */
const OLDER_LAYER_ROW_URI = new RegExp(
  `^${['kairos', '://', 'me', 'm', '/'].join('')}[0-9a-f-]{36}$`,
  'i'
);

const layerUriSchema = z
  .string()
  .refine((s) => CANONICAL_LAYER_URI.test(s) || OLDER_LAYER_ROW_URI.test(s), {
    message:
      'must be kairos://layer/{layer-uuid} (squadrules:// also accepted) with optional ?execution_id=, or the transitional older layer-row URI form'
  });

export const updateInputSchema = z.object({
  uris: z.array(layerUriSchema).nonempty().describe('Non-empty array of layer URIs (stored layer rows) to update'),
  content: z.array(z.string().min(1)).optional().describe('Array of content bodies to store for each URI'),
  updates: z.record(z.string(), z.any()).optional().describe('Advanced field updates; prefer content for body changes')
});

export const updateOutputSchema = z.object({
  results: z.array(
    z.object({
      uri: layerUriSchema,
      status: z.enum(['updated', 'error']),
      message: z.string()
    })
  ),
  total_updated: z.number(),
  total_failed: z.number()
});

export type UpdateInput = z.infer<typeof updateInputSchema>;
export type UpdateOutput = z.infer<typeof updateOutputSchema>;
