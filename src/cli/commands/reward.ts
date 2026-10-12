/**
 * reward command — record a reward signal for an adapter execution.
 */

import { Command } from 'commander';
import { handleApiError, isBrowserDisabled } from '../auth-error.js';
import { emitResult, writeError } from '../output.js';
import { resolveOutputFormat } from '../format.js';
import { renderRewardPretty, renderRewardText } from '../render.js';
import { createBackendFromProgram } from '../backend/resolve-backend.js';
import type { RewardOptions } from '../backend/action-backend.js';

export function rewardCommand(program: Command): void {
    program
        .command('reward')
        .description('Record a reward signal for a SQUADRULES adapter execution')
        .argument('<uri>', 'SQUADRULES layer URI (squadrules://layer/...)')
        .argument('<outcome>', 'Outcome: success or failure')
        .argument('<feedback>', 'Reward feedback describing the completion or failure')
        .option('--score <number>', 'Normalized reward score in the 0..1 range')
        .option('--rater <rater>', 'Evaluator identifier used for export gating')
        .option('--rubric-version <version>', 'Rubric or policy version used for evaluation')
        .option('--model <model>', 'LLM model ID for attribution (e.g., "gpt-4", "claude-3")')
        .action(async (
            uri: string,
            outcome: string,
            feedback: string,
            options: { score?: string; rater?: string; rubricVersion?: string; model?: string }
        ) => {
            try {
                if (outcome !== 'success' && outcome !== 'failure') {
                    writeError('outcome must be "success" or "failure"');
                    process.exit(1);
                    return;
                }

                const score = options.score !== undefined ? parseFloat(options.score) : undefined;
                if (score !== undefined && isNaN(score)) {
                    writeError('--score must be a number');
                    process.exit(1);
                    return;
                }

                const backend = await createBackendFromProgram(program);

                const rewardOptions: RewardOptions = {};
                if (score !== undefined) rewardOptions.score = score;
                if (options.rater) rewardOptions.rater = options.rater;
                if (options.rubricVersion) rewardOptions.rubricVersion = options.rubricVersion;
                if (options.model) rewardOptions.llmModelId = options.model;

                const response = await backend.reward(
                    uri,
                    outcome as 'success' | 'failure',
                    feedback,
                    rewardOptions
                );
                emitResult(resolveOutputFormat(program), response, {
                    pretty: renderRewardPretty,
                    text: renderRewardText
                });
            } catch (error) {
                handleApiError(error, !isBrowserDisabled());
            }
        });
}
