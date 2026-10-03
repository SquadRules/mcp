import { isRewardEligibleForPreference, isRewardEligibleForSft } from '../services/reward-evals.js';
import type { TrainingPair } from '../services/execution-trace-store.js';
import type { RewardRecord, TensorValue } from '../types/memory.js';
import { parseSquadrulesUri } from './squadrules-uri.js';

interface RewardJsonlItem {
  instruction: {
    activation_query: string | null;
    tensor_in: Record<string, unknown>;
    layer_instructions: string;
  };
  response: {
    tensor_out: TensorValue | null;
    trace: string | null;
    raw_solution: unknown | null;
  };
  reward: {
    outcome: RewardRecord['outcome'];
    score: number | null;
    signed_score: number | null;
    quality_bonus: number | null;
    feedback: string | null;
    rater: string | null;
    llm_model_id: string | null;
    rubric_version: string | null;
    grader_kind: NonNullable<RewardRecord['grader_kind']>;
    evaluation_label: RewardRecord['evaluation_label'] | null;
    exportable_for_sft: boolean;
    exportable_for_preference: boolean;
    sft_blockers: string[];
    preference_blockers: string[];
    rated_at: string;
  };
  metadata: {
    execution_id: string;
    adapter_uri: string;
    layer_uri: string;
    layer_index: number;
    timestamp: string;
  };
}

function canonicalLayerUri(uri: string): string {
  try {
    const parsed = parseSquadrulesUri(uri);
    return parsed.kind === 'layer' ? `squadrules://layer/${parsed.id}` : uri;
  } catch {
    return uri;
  }
}

function toRewardJsonlItem(pair: TrainingPair & { reward: RewardRecord }): RewardJsonlItem {
  return {
    instruction: {
      activation_query: pair.instruction.activation_query ?? null,
      tensor_in: pair.instruction.tensor_in,
      layer_instructions: pair.instruction.layer_instructions
    },
    response: {
      tensor_out: pair.response.tensor_out ?? null,
      trace: pair.response.trace ?? null,
      raw_solution: pair.response.raw_solution ?? null
    },
    reward: {
      outcome: pair.reward.outcome,
      score: pair.reward.score ?? null,
      signed_score: pair.reward.signed_score ?? null,
      quality_bonus: pair.reward.quality_bonus ?? null,
      feedback: pair.reward.feedback ?? null,
      rater: pair.reward.rater ?? null,
      llm_model_id: pair.reward.llm_model_id ?? null,
      rubric_version: pair.reward.rubric_version ?? null,
      grader_kind: pair.reward.grader_kind ?? 'unknown',
      evaluation_label: pair.reward.evaluation_label ?? null,
      exportable_for_sft: pair.reward.exportable_for_sft ?? isRewardEligibleForSft(pair.reward),
      exportable_for_preference:
        pair.reward.exportable_for_preference ?? isRewardEligibleForPreference(pair.reward),
      sft_blockers: pair.reward.sft_blockers ?? [],
      preference_blockers: pair.reward.preference_blockers ?? [],
      rated_at: pair.reward.rated_at
    },
    metadata: {
      execution_id: pair.execution_id,
      adapter_uri: pair.adapter_uri,
      layer_uri: canonicalLayerUri(pair.layer_uri),
      layer_index: pair.layer_index,
      timestamp: pair.timestamp
    }
  };
}

export function stringifyLines(items: unknown[]): string {
  return items.map((item) => JSON.stringify(item)).join('\n');
}

export function buildRewardJsonlItems(pairs: TrainingPair[]): RewardJsonlItem[] {
  return pairs
    .filter((pair): pair is TrainingPair & { reward: RewardRecord } => Boolean(pair.reward))
    .map((pair) => toRewardJsonlItem(pair));
}

export function buildSftJsonlItems(
  pairs: TrainingPair[],
  includeReward: boolean
): Array<{
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  metadata: { adapter_uri: string; layer_uri: string; layer_index: number; reward?: RewardRecord };
}> {
  const sftPairs = includeReward ? pairs.filter((pair) => isRewardEligibleForSft(pair.reward)) : pairs;
  return sftPairs.map((pair) => ({
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          activation_query: pair.instruction.activation_query,
          tensor_in: pair.instruction.tensor_in,
          layer_instructions: pair.instruction.layer_instructions
        })
      },
      {
        role: 'assistant',
        content: JSON.stringify({
          tensor_out: pair.response.tensor_out,
          trace: pair.response.trace,
          raw_solution: pair.response.raw_solution
        })
      }
    ],
    metadata: {
      adapter_uri: pair.adapter_uri,
      layer_uri: pair.layer_uri,
      layer_index: pair.layer_index,
      ...(pair.reward ? { reward: pair.reward } : {})
    }
  }));
}

export function buildPreferenceJsonlItems(pairs: TrainingPair[]): Array<{
  prompt: string;
  chosen: string;
  rejected: string;
  metadata: { adapter_uri: string; layer_uri: string; layer_index: number };
}> {
  const preferenceItems: Array<{
    prompt: string;
    chosen: string;
    rejected: string;
    metadata: { adapter_uri: string; layer_uri: string; layer_index: number };
  }> = [];

  const byLayer = new Map<string, TrainingPair[]>();
  for (const pair of pairs) {
    const key = `${canonicalLayerUri(pair.layer_uri)}:${pair.layer_index}`;
    byLayer.set(key, [...(byLayer.get(key) ?? []), pair]);
  }

  for (const layerPairs of byLayer.values()) {
    const eligiblePairs = layerPairs.filter((pair) => isRewardEligibleForPreference(pair.reward));
    const chosen = eligiblePairs
      .filter((pair) => pair.reward?.outcome === 'success')
      .sort((a, b) => (b.reward?.score ?? 0) - (a.reward?.score ?? 0))[0];
    const rejected = eligiblePairs
      .filter((pair) => pair.reward?.outcome === 'failure')
      .sort((a, b) => (b.reward?.score ?? 0) - (a.reward?.score ?? 0))[0];
    if (!chosen || !rejected) {
      continue;
    }
    preferenceItems.push({
      prompt: JSON.stringify(chosen.instruction),
      chosen: JSON.stringify(chosen.response),
      rejected: JSON.stringify(rejected.response),
      metadata: {
        adapter_uri: chosen.adapter_uri,
        layer_uri: canonicalLayerUri(chosen.layer_uri),
        layer_index: chosen.layer_index
      }
    });
  }

  return preferenceItems;
}
