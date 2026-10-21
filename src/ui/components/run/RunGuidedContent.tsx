import { useTranslation } from "react-i18next";
import { ChallengeCard } from "@/components/ChallengeCard";
import { StepFlowGraph } from "@/components/StepFlowGraph";
import { RenderedMarkdown } from "@/components/RenderedMarkdown";
import { SolutionForm } from "@/components/run/SolutionForm";
import { runContractToChallengeCard } from "@/components/run/runContractChallenge";
import type { RunSession } from "@/hooks/useRunSession";
import type { RunSolutionSubmission } from "@/lib/runToolTypes";

export interface RunGuidedContentProps {
  run: RunSession;
  rewardOutcome: "success" | "failure";
  setRewardOutcome: (v: "success" | "failure") => void;
  rewardFeedback: string;
  setRewardFeedback: (v: string) => void;
  copyStatus: string | null;
  onCopy: (text: string) => void;
  onSubmitStep: (draft: Omit<RunSolutionSubmission, "nonce" | "proof_hash" | "previousProofHash">) => void;
  onReward: () => void;
  isForwardStepPending: boolean;
  isForwardStartPending: boolean;
  isRewardPending: boolean;
}

function runFlowModel(run: RunSession, stepLabel: (n: number) => string) {
  const completed = run.history.length;
  const isRunning = run.status === "running";
  const hasLayer = Boolean(run.current_layer);
  const pastForward =
    run.status === "ready_to_reward" || run.status === "completed" || run.status === "error";
  const segmentCount = pastForward
    ? Math.max(completed, 1)
    : Math.max(completed + (isRunning && hasLayer ? 1 : 0), isRunning ? 1 : 0) || 1;
  const flowSteps = Array.from({ length: segmentCount }, (_, i) => ({
    label: stepLabel(i + 1),
  }));
  const currentFlowIndex = isRunning && hasLayer ? completed : undefined;
  const displayCurrent =
    isRunning && hasLayer ? completed + 1 : pastForward ? segmentCount : Math.max(completed, 1);
  return { flowSteps, currentFlowIndex, displayCurrent, displayTotal: segmentCount };
}

export function RunGuidedContent({
  run,
  rewardOutcome,
  setRewardOutcome,
  rewardFeedback,
  setRewardFeedback,
  copyStatus,
  onCopy,
  onSubmitStep,
  onReward,
  isForwardStepPending,
  isForwardStartPending,
  isRewardPending,
}: RunGuidedContentProps) {
  const { t } = useTranslation();
  const { flowSteps, currentFlowIndex, displayCurrent, displayTotal } = runFlowModel(run, (n) =>
    t("run.flowStepN", { n })
  );
  const challengeProps = runContractToChallengeCard(run.contract);

  return (
    <>
      <section className="mb-6" aria-labelledby="run-flow-heading">
        <h2 id="run-flow-heading" className="mb-2 text-lg font-semibold text-[var(--color-text-heading)]">
          {t("run.progressHeading")}
        </h2>
        <StepFlowGraph steps={flowSteps} currentIndex={currentFlowIndex} />
      </section>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-muted)]" role="status">
        <span className="font-medium text-[var(--color-text-heading)]">
          {t("run.stepProgress", { current: displayCurrent, total: displayTotal })}
        </span>
        <span aria-hidden>·</span>
        <span>{t("run.sessionBadge")}</span>
      </div>

      {run.last_message && (
        <div
          className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
          role="status"
          aria-live="polite"
        >
          <div className="text-sm text-[var(--color-text-muted)]">{t("run.serverMessage")}</div>
          <div className="text-[var(--color-text)]">{run.last_message}</div>
        </div>
      )}

      <section aria-labelledby="run-current-step" className="mb-6">
        <h2 id="run-current-step" className="mb-2 text-lg font-semibold text-[var(--color-text-heading)]">
          {t("run.currentStepHeading")}
        </h2>
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-4">
          {run.current_layer ? (
            <>
              <div className="mb-2 text-sm text-[var(--color-text-muted)]">
                {t("run.layerUri")}: <span className="font-mono break-all">{run.current_layer.uri}</span>
              </div>
              {run.current_layer.content ? (
                <div className="prose prose-sm max-w-none text-[var(--color-text)]">
                  <RenderedMarkdown content={run.current_layer.content} />
                </div>
              ) : (
                <p className="m-0 text-sm text-[var(--color-text-muted)]">{t("run.noLayerContent")}</p>
              )}
            </>
          ) : (
            <p className="m-0 text-sm text-[var(--color-text-muted)]">{t("run.noLayerContent")}</p>
          )}
        </div>
      </section>

      <section aria-labelledby="run-challenge" className="mb-6">
        <h2 id="run-challenge" className="mb-2 text-lg font-semibold text-[var(--color-text-heading)]">
          {t("run.challengeHeading")}
        </h2>
        <ChallengeCard type={challengeProps.type} payload={challengeProps.payload} />

        {run.contract.type === "shell" && run.contract.shell?.cmd && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => onCopy(run.contract.shell!.cmd!)}
              className="min-h-[44px] min-w-[44px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
            >
              {t("run.copyShellCommand")}
            </button>
            {copyStatus ? <div className="mt-2 text-xs text-[var(--color-text-muted)]">{copyStatus}</div> : null}
          </div>
        )}

        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-[var(--color-primary)]">{t("run.advanced")}</summary>
          <div className="mt-2 space-y-2 text-[var(--color-text-muted)]">
            <div>
              <span className="text-[var(--color-text-muted)]">{t("run.contractType")}</span>:{" "}
              <span className="font-medium text-[var(--color-text-heading)]">{run.contract.type}</span>
            </div>
            {run.contract.description && <p className="m-0 text-sm">{run.contract.description}</p>}
            {run.contract.nonce && (
              <div>
                {t("run.nonce")}: <span className="font-mono break-all">{run.contract.nonce}</span>
              </div>
            )}
            {run.contract.proof_hash && (
              <div>
                {t("run.proofHash")}: <span className="font-mono break-all">{run.contract.proof_hash}</span>
              </div>
            )}
            {run.previous_proof_hash && (
              <div>
                {t("run.previousProofHash")}: <span className="font-mono break-all">{run.previous_proof_hash}</span>
              </div>
            )}
          </div>
        </details>

      </section>

      {run.status !== "completed" && run.status !== "ready_to_reward" && (
        <section aria-labelledby="run-solution" className="mb-6">
          <h2 id="run-solution" className="mb-2 text-lg font-semibold text-[var(--color-text-heading)]">
            {t("run.solution")}
          </h2>
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-4">
            <SolutionForm
              contract={run.contract}
              disabled={isForwardStepPending || isForwardStartPending}
              onSubmit={onSubmitStep}
            />
          </div>
        </section>
      )}

      {run.status === "ready_to_reward" && (
        <section aria-labelledby="run-reward" className="mb-6">
          <h2 id="run-reward" className="mb-2 text-lg font-semibold text-[var(--color-text-heading)]">
            {t("run.reward.title")}
          </h2>
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-4">
            <div className="mb-4 text-sm text-[var(--color-text-muted)]">{t("run.reward.subtitle")}</div>
            <div className="mb-4 flex flex-wrap gap-4" role="radiogroup" aria-label={t("run.reward.outcomeLabel")}>
              <label className="inline-flex min-h-[44px] items-center gap-2">
                <input
                  type="radio"
                  name="reward-outcome"
                  value="success"
                  checked={rewardOutcome === "success"}
                  onChange={() => setRewardOutcome("success")}
                />
                <span className="text-sm text-[var(--color-text)]">{t("run.reward.success")}</span>
              </label>
              <label className="inline-flex min-h-[44px] items-center gap-2">
                <input
                  type="radio"
                  name="reward-outcome"
                  value="failure"
                  checked={rewardOutcome === "failure"}
                  onChange={() => setRewardOutcome("failure")}
                />
                <span className="text-sm text-[var(--color-text)]">{t("run.reward.failure")}</span>
              </label>
            </div>
            <div className="mb-4">
              <label htmlFor="run-reward-feedback" className="mb-2 block font-medium text-[var(--color-text-heading)]">
                {t("run.reward.feedback")}
              </label>
              <textarea
                id="run-reward-feedback"
                value={rewardFeedback}
                onChange={(e) => setRewardFeedback(e.target.value)}
                className="min-h-[8rem] w-full resize-y rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
              />
            </div>
            <button
              type="button"
              onClick={onReward}
              disabled={isRewardPending}
              className="min-h-[44px] min-w-[44px] cursor-pointer rounded-[var(--radius-md)] border-0 bg-[var(--color-primary)] px-4 py-2 font-medium text-white hover:bg-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRewardPending ? t("run.reward.submitting") : t("run.reward.submit")}
            </button>
          </div>
        </section>
      )}

      {run.history.length > 0 && (
        <section aria-labelledby="run-history" className="mb-6">
          <h2 id="run-history" className="mb-2 text-lg font-semibold text-[var(--color-text-heading)]">
            {t("run.history")}
          </h2>
          <ul className="m-0 list-none space-y-2 p-0" aria-label={t("run.historyLabel")}>
            {run.history
              .slice()
              .reverse()
              .map((h, idx) => (
                <li
                  key={`${h.layer.uri}:${idx}`}
                  className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-4"
                >
                  <div className="text-sm text-[var(--color-text-muted)]">
                    {new Date(h.submitted_at).toLocaleString()} · {h.contract.type} ·{" "}
                    <span className="font-mono break-all">{h.layer.uri}</span>
                  </div>
                  {h.server_message && <div className="mt-1 text-sm text-[var(--color-text)]">{h.server_message}</div>}
                </li>
              ))}
          </ul>
        </section>
      )}

      {run.status === "completed" && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--status-success-bg)] p-4 text-[var(--status-success-fg)]">
          <strong className="block">{t("run.completed")}</strong>
          {run.last_message && <div className="mt-1 text-sm">{run.last_message}</div>}
        </div>
      )}
    </>
  );
}
