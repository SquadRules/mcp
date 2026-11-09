import { z } from 'zod';

const layerUriSchema = z
  .string()
  .regex(
    /^squadrules:\/\/layer\/[0-9a-f-]{36}(?:\?execution_id=[0-9a-f-]{36})?$/i,
    'must match squadrules://layer/{uuid}[?execution_id={uuid}]'
  );

export const rewardInputSchema = z.object({
  uri: layerUriSchema.describe('URI of the final layer in the adapter execution'),
  outcome: z.enum(['success', 'failure']).describe('Execution outcome'),
  score: z.number().min(0).max(1).optional().describe('Optional normalized reward score'),
  feedback: z.string().min(1).optional().describe('Optional evaluator feedback'),
  rater: z.string().optional().describe('Human evaluator identifier. Combined with llm_model_id provides evaluator identity — omitting both blocks exportable_for_sft and exportable_for_preference.'),
  rubric_version: z.string().optional().describe('Rubric or policy version tag (e.g. "v1"). Required for SFT and preference export eligibility — omitting blocks exportable_for_sft and exportable_for_preference.'),
  llm_model_id: z.string().optional().describe('LLM model identifier for evaluator attribution. Required for evaluator identity — omitting blocks exportable_for_sft and exportable_for_preference.'),
  proposal: z
    .string()
    .regex(/^proposal:[a-f0-9]{32}$/, 'must be a proposal:<32 hex> key returned by a previous reward')
    .optional()
    .describe('Evolution proposal to confirm or reject. Never mutates the target adapter; an accepted proposal returns an apply plan for normal train/tune.'),
  proposal_decision: z.enum(['confirm', 'reject']).optional().describe('Decision on `proposal`'),
  proposal_actor_kind: z
    .enum(['agent', 'human_expert'])
    .optional()
    .describe('Claimed actor kind. `human_expert` only counts when the server resolved an authenticated subject.'),
  proposal_evidence: z
    .record(z.string(), z.any())
    .optional()
    .describe('Empirical evidence for this decision (test output, logs, examples). Evidence outranks authority and votes.')
});

const rewardEligibilityBlockerSchema = z.enum([
  'missing_rubric_version',
  'missing_evaluator_identity',
  'outcome_not_success',
  'score_below_sft_threshold',
  'score_below_preference_threshold'
]);

const evolutionReportSchema = z.object({
  proposal: z.string().nullable(),
  status: z.string().nullable(),
  decision: z.string().nullable(),
  decided_by: z.string().nullable(),
  required_confirmations: z.number().nullable(),
  distinct_children: z.number().nullable(),
  anomaly: z.string().nullable(),
  apply_plan: z
    .object({
      target_uri: z.string(),
      target_key: z.string(),
      target_space: z.string().min(1),
      expected_version: z.string().min(1).describe('Observed stored target version bound to this apply plan'),
      field: z.string(),
      from_value: z.string().nullable(),
      to_value: z.string(),
      instructions: z.string()
    })
    .nullable(),
  diagnostic: z.object({
    code: z.string(),
    recovery_action: z.string()
  }).nullable().optional(),
  next_action: z.string()
});

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
  /** Proposal-only evolution record for this reward. Never a parent-adapter write. */
  evolution: evolutionReportSchema.optional(),
  next_call: z.null()
}).strict();

export type RewardInput = z.infer<typeof rewardInputSchema>;
export type RewardOutput = z.infer<typeof rewardOutputSchema>;

