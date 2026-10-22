import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SolutionForm } from "@/components/run/SolutionForm";
import type { RunContract } from "@/lib/runToolTypes";

describe("SolutionForm", () => {
  it("renders shell challenge fields and submits with exit_code, stdout, stderr", async () => {
    const onSubmit = vi.fn();
    const contract: RunContract = {
      type: "shell",
      shell: { cmd: "npm test" },
    };
    render(<SolutionForm contract={contract} onSubmit={onSubmit} />);
    expect(screen.getByLabelText("run.shell.exitCode")).toBeInTheDocument();
    expect(screen.getByLabelText("run.shell.stdout")).toBeInTheDocument();
    expect(screen.getByLabelText("run.shell.stderr")).toBeInTheDocument();

    const exitInput = screen.getByRole("spinbutton", { name: "run.shell.exitCode" });
    await userEvent.clear(exitInput);
    await userEvent.type(exitInput, "0");
    await userEvent.type(screen.getByLabelText("run.shell.stdout"), "ok");
    fireEvent.submit(screen.getByRole("form", { name: "run.solutionFormLabel" }));

    expect(onSubmit).toHaveBeenCalledWith({
      type: "shell",
      shell: { exit_code: 0, stdout: "ok" },
    });
  });

  it("renders forward challenge fields and submits target with success flag", async () => {
    const onSubmit = vi.fn();
    const contract: RunContract = {
      type: "forward",
      forward: { target: "squadrules://adapter/critic-loop" },
    };
    render(<SolutionForm contract={contract} onSubmit={onSubmit} />);
    expect(screen.getByText("run.forward.target")).toBeInTheDocument();
    expect(screen.getByText("squadrules://adapter/critic-loop")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "run.forward.success" })).toBeChecked();
    fireEvent.submit(screen.getByRole("form", { name: "run.solutionFormLabel" }));

    expect(onSubmit).toHaveBeenCalledWith({
      type: "forward",
      forward: {
        target: "squadrules://adapter/critic-loop",
        success: true,
      },
    });
  });

  it("submits success false when the forward result checkbox is cleared", async () => {
    const onSubmit = vi.fn();
    const contract: RunContract = {
      type: "forward",
      forward: { target: "squadrules://adapter/critic-loop" },
    };
    render(<SolutionForm contract={contract} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "run.forward.success" }));
    fireEvent.submit(screen.getByRole("form", { name: "run.solutionFormLabel" }));

    expect(onSubmit).toHaveBeenCalledWith({
      type: "forward",
      forward: { target: "squadrules://adapter/critic-loop", success: false },
    });
  });

  it("keeps submit disabled and shows the missing-target hint when forward.target is empty", () => {
    const contract: RunContract = { type: "forward", forward: { target: "" } };
    render(<SolutionForm contract={contract} onSubmit={vi.fn()} />);
    expect(screen.getByText("run.forward.targetMissing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "run.submitStep" })).toBeDisabled();
  });

  it("no longer renders the retired mcp result/args inputs", () => {
    const contract: RunContract = {
      type: "forward",
      forward: { target: "squadrules://adapter/critic-loop" },
    };
    render(<SolutionForm contract={contract} onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText("run.mcp.result")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("run.mcp.args")).not.toBeInTheDocument();
    expect(screen.queryByText("activate")).not.toBeInTheDocument();
  });

  it("renders user_input challenge fields and submits confirmation", async () => {
    const onSubmit = vi.fn();
    const contract: RunContract = {
      type: "user_input",
      user_input: { prompt: "Proceed?" },
    };
    render(<SolutionForm contract={contract} onSubmit={onSubmit} />);
    expect(screen.getByText("Proceed?")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("run.userInput.confirmation"), "Yes");
    fireEvent.submit(screen.getByRole("form", { name: "run.solutionFormLabel" }));

    expect(onSubmit).toHaveBeenCalledWith({
      type: "user_input",
      user_input: expect.objectContaining({
        confirmation: "Yes",
      }),
    });
  });

  it("renders comment challenge and submit disabled until min length", async () => {
    const onSubmit = vi.fn();
    const contract: RunContract = {
      type: "comment",
      comment: { min_length: 10 },
    };
    render(<SolutionForm contract={contract} onSubmit={onSubmit} />);
    expect(screen.getByLabelText("run.comment.text")).toBeInTheDocument();
    const submitBtn = screen.getByRole("button", { name: "run.submitStep" });
    expect(submitBtn).toBeDisabled();

    await userEvent.type(screen.getByLabelText("run.comment.text"), "short");
    expect(submitBtn).toBeDisabled();

    await userEvent.clear(screen.getByLabelText("run.comment.text"));
    await userEvent.type(screen.getByLabelText("run.comment.text"), "ten chars!!");
    expect(submitBtn).not.toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "run.solutionFormLabel" }));

    expect(onSubmit).toHaveBeenCalledWith({
      type: "comment",
      comment: { text: "ten chars!!" },
    });
  });

  it("submit button is disabled when disabled prop is true", () => {
    const contract: RunContract = { type: "comment", comment: { min_length: 2 } };
    render(<SolutionForm contract={contract} onSubmit={vi.fn()} disabled />);
    const textarea = screen.getByLabelText("run.comment.text");
    fireEvent.change(textarea, { target: { value: "ab" } });
    expect(screen.getByRole("button", { name: "run.submitStep" })).toBeDisabled();
  });
});
