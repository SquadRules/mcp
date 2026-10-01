import { z } from 'zod';

const layerUriSchema = z
  .string()
  .regex(
    /^(?:kairos|squadrules):\/\/layer\/[0-9a-f-]{36}(?:\?execution_id=[0-9a-f-]{36})?$/i,
    'must match kairos://layer/{uuid}[?execution_id={uuid}] (squadrules:// also accepted)'
  );

export const rewardInputSchema = z.object({
  uri: layerUriSchema.describe('URI of the final layer in the adapter execution'),
  outcome: z.enum(['success', 'failure']).describe('Execution outcome'),
  score: z.number().min(0).max(1).optional().describe('Optional normalized reward score'),
  feedback: z.string().min(1).optional().describe('Optional evaluator feedback'),
  rater: z.string().optional().describe('Human evaluator identifier. Combined with llm_model_id provides evaluator identity — omitting both blocks exportable_for_sft and exportable_for_preference.'),
  rubric_version: z.string().optional().describe('Rubric or policy version tag (e.g. "v1"). Required for SFT and preference export eligibility — omitting blocks exportable_for_sft and exportable_for_preference.'),
  llm_model_id: z.string().optional().describe('LLM model identifier for evaluator attribution. Required for evaluator identity — omitting blocks exportable_for_sft and exportable_for_preference.')
});

const rewardEligibilityBlockerSchema = z.enum([
  'missing_rubric_version',
  'missing_evaluator_identity',
  'outcome_not_success',
  'score_below_sft_threshold',
  'score_below_preference_threshold'
]);

export const rewardOutputSchema = z.object({
  results: z.array(z.object({
    uri: layerUriSchema,
    outcome: z.enum(['success', 'failure']),
    score: z.number().nullable(),
    feedback: z.string().nullable(),
    rater: z.string().nullable(),
    rubric_version: z.string().nullable(),
    llm_model_id: z.string().nullable(),
    grader_kind: z.enum(['human', 'model', 'unknown']),
    evaluation_label: z.enum(['gold', 'silver', 'bronze', 'rejected']),
    exportable_for_sft: z.boolean(),
    exportable_for_preference: z.boolean(),
    sft_blockers: z.array(rewardEligibilityBlockerSchema),
    preference_blockers: z.array(rewardEligibilityBlockerSchema),
    rated_at: z.string()
  })),
  total_rated: z.number(),
  total_failed: z.number(),
  next_call: z.null()
}).strict();

export type RewardInput = z.infer<typeof rewardInputSchema>;
export type RewardOutput = z.infer<typeof rewardOutputSchema>;

