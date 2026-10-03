// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RunGuidedContent } from "@/components/run/RunGuidedContent";
import type { RunSession } from "@/hooks/useRunSession";

const baseRun: RunSession = {
  id: "run-1",
  adapter_uri: "kairos://adapter/foo",
  started_at: "2024-01-01T00:00:00.000Z",
  updated_at: "2024-01-01T00:00:00.000Z",
  status: "running",
  current_layer: { uri: "kairos://layer/11111111-1111-1111-1111-111111111111", content: "Step content", mimeType: "text/plain" },
  contract: { type: "comment", comment: { min_length: 5 } },
  history: [],
};

const defaultProps = {
  rewardOutcome: "success" as const,
  setRewardOutcome: vi.fn(),
  rewardFeedback: "",
  setRewardFeedback: vi.fn(),
  copyStatus: null as string | null,
  onCopy: vi.fn(),
  onSubmitStep: vi.fn(),
  onReward: vi.fn(),
  isForwardStepPending: false,
  isForwardStartPending: false,
  isRewardPending: false,
};

describe("RunGuidedContent", () => {
  it("running state shows progress, step, challenge, and solution form", () => {
    render(<RunGuidedContent {...defaultProps} run={baseRun} />);
    expect(screen.getByRole("heading", { name: "run.progressHeading" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "run.currentStepHeading" })).toBeInTheDocument();
    expect(screen.getByText("kairos://layer/11111111-1111-1111-1111-111111111111")).toBeInTheDocument();
    expect(screen.getByText("Step content")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "run.challengeHeading" })).toBeInTheDocument();
    expect(screen.getByText("Comment")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "run.solutionFormLabel" })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "run.reward.outcomeLabel" })).not.toBeInTheDocument();
  });

  it("ready_to_reward state shows reward form and no solution form", () => {
    const run: RunSession = {
      ...baseRun,
      status: "ready_to_reward",
    };
    render(<RunGuidedContent {...defaultProps} run={run} />);
    expect(screen.getByRole("heading", { name: "run.reward.title" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "run.reward.outcomeLabel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "run.reward.submit" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "run.solutionFormLabel" })).not.toBeInTheDocument();
  });

  it("completed state shows success banner", () => {
    const run: RunSession = {
      ...baseRun,
      status: "completed",
      last_message: "Done.",
    };
    render(<RunGuidedContent {...defaultProps} run={run} />);
    expect(screen.getByText("run.completed")).toBeInTheDocument();
    expect(screen.getAllByText("Done.").length).toBeGreaterThanOrEqual(1);
  });

  it("renders history when run has history items", () => {
    const run: RunSession = {
      ...baseRun,
      history: [
        {
          layer: { uri: "kairos://layer/00000000-0000-0000-0000-000000000000", content: "", mimeType: "text/plain" },
          contract: { type: "comment" },
          solution: { type: "comment", comment: { text: "done" } },
          submitted_at: "2024-01-01T00:01:00.000Z",
          server_message: "OK",
        },
      ],
    };
    render(<RunGuidedContent {...defaultProps} run={run} />);
    expect(screen.getByRole("heading", { name: "run.history" })).toBeInTheDocument();
    expect(screen.getByLabelText("run.historyLabel")).toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();
  });

  it("reward outcome change calls setRewardOutcome", () => {
    const setRewardOutcome = vi.fn();
    const run: RunSession = { ...baseRun, status: "ready_to_reward" };
    render(
      <RunGuidedContent
        {...defaultProps}
        run={run}
        setRewardOutcome={setRewardOutcome}
      />
    );
    const failureRadio = screen.getByRole("radio", { name: "run.reward.failure" });
    fireEvent.click(failureRadio);
    expect(setRewardOutcome).toHaveBeenCalledWith("failure");
  });

  it("reward submit button calls onReward", () => {
    const onReward = vi.fn();
    const run: RunSession = { ...baseRun, status: "ready_to_reward" };
    render(<RunGuidedContent {...defaultProps} run={run} onReward={onReward} />);
    fireEvent.click(screen.getByRole("button", { name: "run.reward.submit" }));
    expect(onReward).toHaveBeenCalled();
  });
});
