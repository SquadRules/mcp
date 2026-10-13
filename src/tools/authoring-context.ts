import { z } from 'zod';
import { ADAPTER_SLUG_URI_INPUT_REGEX } from './squadrules-uri.js';

/** Intent supplied by the caller, not a grant of permission to mutate a target. */
export const authoringContextSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('create') }).strict(),
  z.object({
    operation: z.enum(['review', 'update']),
    target_adapter_uri: z.string().regex(ADAPTER_SLUG_URI_INPUT_REGEX, 'Use an existing squadrules://adapter/{slug|uuid}')
  }).strict()
]);

export type AuthoringContext = z.infer<typeof authoringContextSchema>;
