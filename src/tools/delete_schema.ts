// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import { z } from 'zod';
import { ADAPTER_SLUG_URI_INPUT_REGEX, LAYER_URI_INPUT_REGEX } from './kairos-uri.js';

const adapterUriSchema = z
  .string()
  .regex(ADAPTER_SLUG_URI_INPUT_REGEX, 'must match kairos://adapter/{slug}');

const layerUriSchema = z
  .string()
  .regex(LAYER_URI_INPUT_REGEX, 'must match kairos://layer/{uuid}[?execution_id={uuid}]');

const deleteUriSchema = z.union([adapterUriSchema, layerUriSchema]);

export const deleteInputSchema = z.object({
  uris: z
    .array(deleteUriSchema)
    .nonempty()
    .describe('Non-empty array of adapter or layer URIs to delete')
});

export const deleteOutputSchema = z.object({
  results: z.array(z.object({
    uri: deleteUriSchema,
    status: z.enum(['deleted', 'error']),
    message: z.string()
  })),
  total_deleted: z.number(),
  total_failed: z.number()
}).strict();

export type DeleteInput = z.infer<typeof deleteInputSchema>;
export type DeleteOutput = z.infer<typeof deleteOutputSchema>;
