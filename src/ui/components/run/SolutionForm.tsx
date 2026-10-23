import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RunContract, RunContractType, RunSolutionSubmission } from "@/lib/runToolTypes";

type DraftSolution = Omit<RunSolutionSubmission, "nonce" | "proof_hash" | "previousProofHash">;

export function SolutionForm({
  contract,
  disabled,
  onSubmit,
}: {
  contract: RunContract;
  disabled?: boolean;
  onSubmit: (draft: DraftSolution) => void;
}) {
  const { t } = useTranslation();
  const type: RunContractType = contract.type;

  const [exitCode, setExitCode] = useState<number>(0);
  const [stdout, setStdout] = useState("");
  const [stderr, setStderr] = useState("");

  const target = contract.forward?.target ?? "";
  const [forwardSuccess, setForwardSuccess] = useState(true);

  const prompt = contract.user_input?.prompt ?? "";
  const [confirmation, setConfirmation] = useState("");

  const minLen = contract.comment?.min_length ?? 10;
  const [comment, setComment] = useState("");

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setExitCode(0);
    setStdout("");
    setStderr("");
    setForwardSuccess(true);
    setConfirmation("");
    setComment("");
  }, [type, target, prompt, minLen]);

  const isValid = useMemo(() => {
    if (type === "shell") return Number.isFinite(exitCode);
    if (type === "forward") return target.trim().length > 0;
    if (type === "user_input") return confirmation.trim().length > 0;
    if (type === "comment") return comment.trim().length >= minLen;
    return false;
  }, [type, exitCode, target, confirmation, comment, minLen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isValid) return;

    try {
      if (type === "shell") {
        onSubmit({
          type,
          shell: {
            exit_code: exitCode,
            ...(stdout.trim() ? { stdout: stdout } : {}),
            ...(stderr.trim() ? { stderr: stderr } : {}),
          },
        });
        return;
      }

      if (type === "forward") {
        onSubmit({
          type,
          forward: {
            target,
            success: forwardSuccess,
          },
        });
        return;
      }

      if (type === "user_input") {
        onSubmit({
          type,
          user_input: {
            confirmation: confirmation.trim(),
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      if (type === "comment") {
        onSubmit({
          type,
          comment: { text: comment.trim() },
        });
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <form onSubmit={handleSubmit} aria-label={t("run.solutionFormLabel")}>
      {error && (
        <div className="mb-4 p-4 rounded-[var(--radius-md)] bg-[var(--color-error-bg)] text-[var(--color-error)]" role="alert">
          {error}
        </div>
      )}

      {type === "shell" && (
        <div className="space-y-4">
          <div>
            <label htmlFor="run-shell-exit-code" className="block font-medium text-[var(--color-text-heading)] mb-2">
              {t("run.shell.exitCode")}
            </label>
            <input
              id="run-shell-exit-code"
              type="number"
              inputMode="numeric"
              value={exitCode}
              onChange={(e) => setExitCode(Number(e.target.value))}
              className="w-full min-h-[44px] px-4 py-2 border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--color-text)] bg-[var(--color-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
              disabled={disabled}
              required
            />
          </div>
          <div>
            <label htmlFor="run-shell-stdout" className="block font-medium text-[var(--color-text-heading)] mb-2">
              {t("run.shell.stdout")}
            </label>
            <textarea
              id="run-shell-stdout"
              value={stdout}
              onChange={(e) => setStdout(e.target.value)}
              className="w-full min-h-[8rem] px-4 py-3 border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--color-text)] bg-[var(--color-surface)] font-mono text-sm resize-y"
              disabled={disabled}
            />
          </div>
          <div>
            <label htmlFor="run-shell-stderr" className="block font-medium text-[var(--color-text-heading)] mb-2">
              {t("run.shell.stderr")}
            </label>
            <textarea
              id="run-shell-stderr"
              value={stderr}
              onChange={(e) => setStderr(e.target.value)}
              className="w-full min-h-[6rem] px-4 py-3 border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--color-text)] bg-[var(--color-surface)] font-mono text-sm resize-y"
              disabled={disabled}
            />
          </div>
        </div>
      )}

      {type === "forward" && (
        <div className="space-y-4">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="text-sm text-[var(--color-text-muted)]">{t("run.forward.target")}</div>
            <div className="font-medium text-[var(--color-text-heading)] break-all">{target || t("run.forward.targetMissing")}</div>
          </div>
          <label className="inline-flex items-center gap-2 min-h-[44px]">
            <input
              type="checkbox"
              checked={forwardSuccess}
              onChange={(e) => setForwardSuccess(e.target.checked)}
              disabled={disabled}
              className="h-4 w-4"
            />
            <span className="text-sm text-[var(--color-text)]">{t("run.forward.success")}</span>
          </label>
        </div>
      )}

      {type === "user_input" && (
        <div className="space-y-4">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="text-sm text-[var(--color-text-muted)]">{t("run.userInput.prompt")}</div>
            <div className="font-medium text-[var(--color-text-heading)]">{prompt || t("run.userInput.promptMissing")}</div>
          </div>
          <div>
            <label htmlFor="run-user-confirmation" className="block font-medium text-[var(--color-text-heading)] mb-2">
              {t("run.userInput.confirmation")}
            </label>
            <textarea
              id="run-user-confirmation"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              className="w-full min-h-[6rem] px-4 py-3 border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--color-text)] bg-[var(--color-surface)] resize-y"
              disabled={disabled}
              required
            />
          </div>
        </div>
      )}

      {type === "comment" && (
        <div className="space-y-2">
          <div className="text-sm text-[var(--color-text-muted)]">
            {t("run.comment.minLength", { count: minLen })} · {t("run.comment.count", { count: comment.length })}
          </div>
          <div>
            <label htmlFor="run-comment-text" className="block font-medium text-[var(--color-text-heading)] mb-2">
              {t("run.comment.text")}
            </label>
            <textarea
              id="run-comment-text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="w-full min-h-[10rem] px-4 py-3 border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--color-text)] bg-[var(--color-surface)] resize-y"
              disabled={disabled}
              required
              aria-invalid={comment.trim().length > 0 && comment.trim().length < minLen}
            />
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={disabled || !isValid}
        className="mt-4 min-h-[44px] min-w-[44px] px-4 py-2 rounded-[var(--radius-md)] font-medium bg-[var(--color-primary)] text-white border-0 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed hover:bg-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
      >
        {t("run.submitStep")}
      </button>
    </form>
  );
}

