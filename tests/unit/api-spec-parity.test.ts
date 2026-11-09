/**
 * API spec parity — the canonical input vocabulary survives every transport.
 *
 * The HTTP routes, the MCP tool registrations and the CLI all validate with the same
 * Zod schemas in `src/tools/*_schema.ts` and hand `parse().data` to the same `execute*`
 * handler. This suite pins the part that a schema identity check cannot: every field
 * that a newer contract added (`expected_version`, `export.version`, the reward
 * evolution inputs, the activation `context`) must survive parsing unchanged, and any
 * field outside the canonical object must be stripped so a transport cannot smuggle a
 * parallel option through.
 *
 * End-to-end field flow (parsed value -> response) is proven over real HTTP in
 * `tests/integration/http-api-graph-api.test.ts`, not here: activate `context` reaches
 * `ontology_context.context`, `export.version` reaches the historical snapshot, and the
 * reward proposal fields reach `evolution`.
 */
import { describe, expect, test } from '@jest/globals';

import { activateInputSchema } from '../../src/tools/activate_schema.js';
import { exportInputSchema } from '../../src/tools/export_schema.js';
import { rewardInputSchema, rewardOutputSchema } from '../../src/tools/reward_schema.js';
import { trainInputSchema } from '../../src/tools/train_schema.js';
import { tuneInputSchema } from '../../src/tools/tune_schema.js';

const PROPOSAL = `proposal:${'a'.repeat(32)}`;
const LAYER_URI = 'squadrules://layer/3f2504e0-4f89-11d3-9a0c-0305e82c3301';

describe('canonical input fields survive parse unchanged', () => {
  test('activate keeps the explicit retrieval context', () => {
    const parsed = activateInputSchema.parse({
      query: 'review implementation plan',
      context: { task: 'create_adapter', domain: 'python' }
    });
    expect(parsed.context).toEqual({ task: 'create_adapter', domain: 'python' });
  });

  test('export keeps the historical version selector', () => {
    const parsed = exportInputSchema.parse({
      uri: 'squadrules://adapter/critic-loop',
      format: 'markdown',
      version: '3'
    });
    expect(parsed.version).toBe('3');
  });

  test('train keeps the compare-and-swap guard', () => {
    // Fork trains are the real exemption from `review_evidence` (executeTrain's isForkTrain),
    // so this stays a legitimate request rather than a fabricated critic verdict.
    const parsed = trainInputSchema.parse({
      content: '# Adapter\n',
      llm_model_id: 'unit',
      source_adapter_uri: 'squadrules://adapter/critic-loop',
      expected_version: '2.1.0'
    });
    expect(parsed.expected_version).toBe('2.1.0');
  });

  test('tune keeps the compare-and-swap guard next to an update', () => {
    const parsed = tuneInputSchema.parse({
      uris: ['squadrules://adapter/critic-loop'],
      updates: { tags: ['review'] },
      expected_version: '2.1.0'
    });
    expect(parsed.expected_version).toBe('2.1.0');
  });

  test('reward keeps the evolution proposal inputs and its evidence', () => {
    const parsed = rewardInputSchema.parse({
      uri: LAYER_URI,
      outcome: 'failure',
      feedback: 'retry limit differs',
      proposal: PROPOSAL,
      proposal_decision: 'confirm',
      proposal_actor_kind: 'agent',
      proposal_evidence: { observed: 'retry_limit=5', expected: '3' }
    });
    expect(parsed.proposal).toBe(PROPOSAL);
    expect(parsed.proposal_decision).toBe('confirm');
    expect(parsed.proposal_actor_kind).toBe('agent');
    expect(parsed.proposal_evidence).toEqual({ observed: 'retry_limit=5', expected: '3' });
  });
});

describe('the canonical vocabulary is closed', () => {
  test('a transport-local field is stripped instead of reaching the shared handler', () => {
    const parsed = rewardInputSchema.parse({
      uri: LAYER_URI,
      outcome: 'success',
      transport_only_option: 'ignored'
    });
    expect(Object.keys(parsed)).not.toContain('transport_only_option');
  });

  test('a malformed proposal key fails closed at the schema', () => {
    const result = rewardInputSchema.safeParse({
      uri: LAYER_URI,
      outcome: 'failure',
      proposal: 'proposal-not-a-key'
    });
    expect(result.success).toBe(false);
  });

  test('a malformed layer URI fails closed at the schema', () => {
    const result = rewardInputSchema.safeParse({ uri: 'squadrules://adapter/x', outcome: 'success' });
    expect(result.success).toBe(false);
  });

  test('an empty expected_version is rejected rather than silently ignored', () => {
    const result = tuneInputSchema.safeParse({
      uris: ['squadrules://adapter/critic-loop'],
      updates: { tags: ['review'] },
      expected_version: ''
    });
    expect(result.success).toBe(false);
  });
});

describe('the reward output carries the evolution report shape', () => {
  test('an accepted proposal round-trips through the output schema', () => {
    const ratedAt = new Date().toISOString();
    const output = {
      results: [
        {
          uri: LAYER_URI,
          outcome: 'failure',
          score: 0,
          feedback: null,
          rater: null,
          rubric_version: 'v1',
          llm_model_id: 'unit',
          grader_kind: 'model',
          evaluation_label: 'rejected',
          exportable_for_sft: false,
          exportable_for_preference: false,
          sft_blockers: ['outcome_not_success'],
          preference_blockers: ['outcome_not_success'],
          rated_at: ratedAt
        }
      ],
      total_rated: 1,
      total_failed: 1,
      evolution: {
        proposal: PROPOSAL,
        status: 'accepted',
        decision: 'accept',
        decided_by: 'evidence',
        required_confirmations: 3,
        distinct_children: 0,
        anomaly: 'anomaly:00000000-0000-0000-0000-000000000000',
        apply_plan: {
          target_uri: 'squadrules://adapter/http-parent-adapter',
          target_key: 'adapter:space:personal:http-parent-adapter',
          target_space: 'personal',
          expected_version: '1.0.0',
          field: 'reward_failure',
          from_value: null,
          to_value: 'retry_limit=3',
          instructions: 'apply through normal tune'
        },
        next_action: 'accepted: apply the proposal with normal tune and the expected version.'
      },
      next_call: null
    };
    expect(rewardOutputSchema.parse(output)).toEqual(output);
  });
});
