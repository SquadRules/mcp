import type { QdrantService } from '../services/qdrant/service.js';
import { resolveToolDoc } from '../utils/mcp-tool-doc-runtime.js';
import { getTenantId, getSpaceContextFromStorage } from '../utils/tenant-context.js';
import { mcpToolCalls, mcpToolDuration, mcpToolErrors, mcpToolInputSize, mcpToolOutputSize } from '../services/metrics/mcp-metrics.js';
import { applyRewardMetrics, type RewardMetricsResult } from '../services/reward-metrics.js';
import { rewardInputSchema, rewardOutputSchema, type RewardInput, type RewardOutput } from './reward_schema.js';
import { buildLayerUri, parseSquadrulesUriOrThrow } from './squadrules-uri.js';
import { executionTraceStore } from '../services/execution-trace-store.js';
import { evaluateReward } from '../services/reward-evals.js';
import { SquadrulesError } from '../types/index.js';
import { mcpLooseToolInput } from './mcp-loose-input-schema.js';
import { mcpToolInputValidationErrorResult } from './mcp-tool-input-teaching.js';

interface RegisterRewardOptions {
  toolName?: string;
}

function buildRewardPersistenceError(uri: string, error: unknown): SquadrulesError {
  return new SquadrulesError(
    `Failed to record reward for ${uri}. No reward was stored. Retry the same reward call once reward storage is healthy.`,
    'REWARD_FAILED',
    503,
    error instanceof Error ? { cause: error.message } : undefined
  );
}

export async function executeReward(
  qdrantService: QdrantService,
  input: RewardInput
): Promise<RewardOutput> {
  const parsed = parseSquadrulesUriOrThrow(input.uri);
  if (parsed.kind !== 'layer') {
    throw new SquadrulesError('reward requires a layer URI', 'INVALID_URI', 400);
  }

  const evaluation = evaluateReward({
    outcome: input.outcome,
    ...(input.score !== undefined ? { score: input.score } : {}),
    ...(input.rater !== undefined ? { rater: input.rater } : {}),
    ...(input.rubric_version !== undefined ? { rubricVersion: input.rubric_version } : {}),
    ...(input.llm_model_id !== undefined ? { llmModelId: input.llm_model_id } : {})
  });

  const rewardMetricsInput: Parameters<typeof applyRewardMetrics>[1] = {
    uri: buildLayerUri(parsed.id, parsed.executionId),
    outcome: input.outcome,
    feedback: input.feedback ?? `${input.outcome} reward`,
    qualityBonus: evaluation.qualityBonus
  };
  const evaluatorId = input.llm_model_id ?? input.rater;
  if (evaluatorId) {
    rewardMetricsInput.evaluatorId = evaluatorId;
  }
  let rewardMetricsResult: RewardMetricsResult;
  try {
    rewardMetricsResult = await applyRewardMetrics(qdrantService, rewardMetricsInput);
  } catch (error) {
    if (error instanceof SquadrulesError) {
      throw error;
    }
    throw buildRewardPersistenceError(input.uri, error);
  }

  const ratedAt = new Date().toISOString();
  if (parsed.executionId) {
    try {
      await executionTraceStore.setReward(parsed.executionId, {
        outcome: input.outcome,
        score: evaluation.normalizedScore,
        signed_score: evaluation.signedScore,
        quality_bonus: evaluation.qualityBonus,
        ...(input.feedback !== undefined && { feedback: input.feedback }),
        ...(input.rater !== undefined && { rater: input.rater }),
        ...(input.rubric_version !== undefined && { rubric_version: input.rubric_version }),
        ...(input.llm_model_id !== undefined && { llm_model_id: input.llm_model_id }),
        grader_kind: evaluation.graderKind,
        evaluation_label: evaluation.label,
        exportable_for_sft: evaluation.exportableForSft,
        exportable_for_preference: evaluation.exportableForPreference,
        sft_blockers: evaluation.sftEligibility.blockers,
        preference_blockers: evaluation.preferenceEligibility.blockers,
        rated_at: ratedAt
      });
    } catch (error) {
      throw buildRewardPersistenceError(input.uri, error);
    }
  }

  return {
    results: rewardMetricsResult.results.map((result) => ({
      uri: input.uri,
      outcome: result.outcome as 'success' | 'failure',
      score: evaluation.normalizedScore,
      feedback: input.feedback ?? null,
      rater: input.rater ?? null,
      rubric_version: input.rubric_version ?? null,
      llm_model_id: input.llm_model_id ?? null,
      grader_kind: evaluation.graderKind,
      evaluation_label: evaluation.label,
      exportable_for_sft: evaluation.exportableForSft,
      exportable_for_preference: evaluation.exportableForPreference,
      sft_blockers: evaluation.sftEligibility.blockers,
      preference_blockers: evaluation.preferenceEligibility.blockers,
      rated_at: ratedAt
    })),
    total_rated: rewardMetricsResult.total_rated,
    total_failed: rewardMetricsResult.total_failed,
    next_call: null
  };
}

export function registerRewardTool(server: any, qdrantService: QdrantService, options: RegisterRewardOptions = {}) {
  const toolName = options.toolName || 'reward';
  server.registerTool(
    toolName,
    {
      title: 'Record adapter reward',
      description: resolveToolDoc('reward') || 'Attach a reward signal after adapter execution completes.',
      inputSchema: mcpLooseToolInput(rewardInputSchema),
      outputSchema: rewardOutputSchema
    },
    async (params: unknown) => {
      const tenantId = getTenantId();
      const spaceId = getSpaceContextFromStorage()?.defaultWriteSpaceId ?? 'default';
      void spaceId;
      mcpToolInputSize.observe({ tool: toolName, tenant_id: tenantId }, JSON.stringify(params).length);
      const timer = mcpToolDuration.startTimer({ tool: toolName, tenant_id: tenantId });

      const parsedInput = rewardInputSchema.safeParse(params);
      if (!parsedInput.success) {
        mcpToolCalls.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        mcpToolErrors.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        timer({ tool: toolName, status: 'error', tenant_id: tenantId });
        return mcpToolInputValidationErrorResult('reward', parsedInput.error, params);
      }
      const input = parsedInput.data;

      try {
        const output = await executeReward(qdrantService, input);
        mcpToolCalls.inc({ tool: toolName, status: 'success', tenant_id: tenantId });
        mcpToolOutputSize.observe({ tool: toolName, tenant_id: tenantId }, JSON.stringify(output).length);
        timer({ tool: toolName, status: 'success', tenant_id: tenantId });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(output) }],
          structuredContent: output
        };
      } catch (error) {
        mcpToolCalls.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        mcpToolErrors.inc({ tool: toolName, status: 'error', tenant_id: tenantId });
        timer({ tool: toolName, status: 'error', tenant_id: tenantId });
        throw error;
      }
    }
  );
}
