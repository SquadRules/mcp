import type { TFunction } from "i18next";
import { RichTextEditor } from "@/components/RichTextEditor";
import type { StepFormState } from "@/hooks/useProtocol";
import { CHALLENGE_TYPE_KEYS } from "./constants";
import { SHELL_INTERPRETERS, type ShellInterpreter } from "../../../tools/shell-challenge-invocation.js";

const inputClass =
  "min-h-[44px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2";

const elevatedInputClass =
  "min-h-[44px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-4 py-3 text-sm text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2";

type ProtocolEditStepCardProps = {
  t: TFunction;
  step: StepFormState;
  index: number;
  stepsLength: number;
  uploadKey: string;
  challengeTypeLabel: Record<StepFormState["type"], string>;
  setStep: (index: number, update: Partial<StepFormState> | ((s: StepFormState) => StepFormState)) => void;
  removeStep: (index: number) => void;
};

export function ProtocolEditStepCard({
  t,
  step,
  index,
  stepsLength,
  uploadKey,
  challengeTypeLabel,
  setStep,
  removeStep,
}: ProtocolEditStepCardProps) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-5 space-y-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-[var(--color-text-heading)]">
            {t("protocolEdit.stepHeading", { n: index + 1 })}
          </div>
          <div className="text-sm text-[var(--color-text-muted)]">{t("protocolEdit.stepEditorHint")}</div>
        </div>
        <button
          type="button"
          onClick={() => removeStep(index)}
          disabled={stepsLength <= 1}
          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2 disabled:opacity-50"
        >
          {t("protocolEdit.removeStep")}
        </button>
      </div>
      <div>
        <label className="mb-2 block font-medium text-[var(--color-text-heading)]">{t("protocolEdit.stepLabel")}</label>
        <input
          type="text"
          value={step.label}
          onChange={(e) => setStep(index, { label: e.target.value })}
          className={inputClass}
        />
      </div>
      <div>
        <div className="mb-2 font-medium text-[var(--color-text-heading)]">{t("protocolEdit.challengeType")}</div>
        <div className="flex flex-wrap gap-2">
          {CHALLENGE_TYPE_KEYS.map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={step.type === type}
              onClick={() =>
                setStep(index, {
                  type,
                  shell:
                    type === "shell"
                      ? {
                          cmd: step.shell?.cmd ?? "",
                          timeout_seconds: step.shell?.timeout_seconds ?? 30,
                          interpreter: step.shell?.interpreter,
                          workdir: step.shell?.workdir,
                          flags: step.shell?.flags ?? [],
                          args: step.shell?.args ?? [],
                        }
                      : undefined,
                  mcp: type === "mcp" ? { tool_name: step.mcp?.tool_name ?? "" } : undefined,
                  user_input: type === "user_input" ? { prompt: step.user_input?.prompt ?? "" } : undefined,
                  comment: type === "comment" ? { min_length: step.comment?.min_length ?? 10 } : undefined,
                })
              }
              className={`min-h-[44px] rounded-[var(--radius-md)] px-4 text-sm font-medium ${
                step.type === type
                  ? "bg-[var(--color-primary)] text-white"
                  : "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
              }`}
            >
              {challengeTypeLabel[type]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <RichTextEditor
          label={t("protocolEdit.stepContent")}
          value={step.bodyMarkdown}
          onChange={(v) => setStep(index, { bodyMarkdown: v })}
          contentKey={uploadKey}
        />
      </div>
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="mb-3 text-sm font-medium text-[var(--color-text-heading)]">Challenge fields</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {step.type === "shell" && (
            <>
              <div>
                <label className="mb-2 block text-sm font-medium text-[var(--color-text-heading)]">
                  {t("protocolEdit.shellCmd")}
                </label>
                <input
                  type="text"
                  value={step.shell?.cmd ?? ""}
                  onChange={(e) =>
                    setStep(index, {
                      shell: {
                        cmd: e.target.value,
                        timeout_seconds: step.shell?.timeout_seconds ?? 30,
                        interpreter: step.shell?.interpreter,
                        workdir: step.shell?.workdir,
                        flags: step.shell?.flags ?? [],
                        args: step.shell?.args ?? [],
                      },
                    })
                  }
                  className={elevatedInputClass}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-[var(--color-text-heading)]">
                  {t("protocolEdit.shellTimeout")}
                </label>
                <input
                  type="number"
                  min={1}
                  value={step.shell?.timeout_seconds ?? 30}
                  onChange={(e) =>
                    setStep(index, {
                      shell: {
                        cmd: step.shell?.cmd ?? "",
                        timeout_seconds: Math.max(1, Number(e.target.value) || 30),
                        interpreter: step.shell?.interpreter,
                        workdir: step.shell?.workdir,
                        flags: step.shell?.flags ?? [],
                        args: step.shell?.args ?? [],
                      },
                    })
                  }
                  className={elevatedInputClass}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-[var(--color-text-heading)]">
                  {t("protocolEdit.shellInterpreter")}
                </label>
                <select
                  required
                  value={step.shell?.interpreter ?? ""}
                  onChange={(e) =>
                    setStep(index, {
                      shell: {
                        cmd: step.shell?.cmd ?? "",
                        timeout_seconds: step.shell?.timeout_seconds ?? 30,
                        interpreter: (e.target.value || undefined) as ShellInterpreter | undefined,
                        workdir: step.shell?.workdir,
                        flags: step.shell?.flags ?? [],
                        args: step.shell?.args ?? [],
                      },
                    })
                  }
                  className={elevatedInputClass}
                >
                  <option value="">{t("protocolEdit.shellInterpreterPlaceholder")}</option>
                  {SHELL_INTERPRETERS.map((interp) => (
                    <option key={interp} value={interp}>
                      {interp}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">{t("protocolEdit.shellInterpreterHint")}</p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-[var(--color-text-heading)]">
                  {t("protocolEdit.shellWorkdir")}
                </label>
                <input
                  type="text"
                  value={step.shell?.workdir ?? ""}
                  onChange={(e) =>
                    setStep(index, {
                      shell: {
                        cmd: step.shell?.cmd ?? "",
                        timeout_seconds: step.shell?.timeout_seconds ?? 30,
                        interpreter: step.shell?.interpreter,
                        workdir: e.target.value || undefined,
                        flags: step.shell?.flags ?? [],
                        args: step.shell?.args ?? [],
                      },
                    })
                  }
                  className={elevatedInputClass}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-2 block text-sm font-medium text-[var(--color-text-heading)]">
                  {t("protocolEdit.shellFlags")}
                </label>
                <textarea
                  rows={3}
                  value={(step.shell?.flags ?? []).join("\n")}
                  onChange={(e) =>
                    setStep(index, {
                      shell: {
                        cmd: step.shell?.cmd ?? "",
                        timeout_seconds: step.shell?.timeout_seconds ?? 30,
                        interpreter: step.shell?.interpreter,
                        workdir: step.shell?.workdir,
                        flags: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean),
                        args: step.shell?.args ?? [],
                      },
                    })
                  }
                  className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-4 py-3 text-sm text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-2 block text-sm font-medium text-[var(--color-text-heading)]">
                  {t("protocolEdit.shellArgs")}
                </label>
                <textarea
                  rows={3}
                  value={(step.shell?.args ?? []).join("\n")}
                  onChange={(e) =>
                    setStep(index, {
                      shell: {
                        cmd: step.shell?.cmd ?? "",
                        timeout_seconds: step.shell?.timeout_seconds ?? 30,
                        interpreter: step.shell?.interpreter,
                        workdir: step.shell?.workdir,
                        flags: step.shell?.flags ?? [],
                        args: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean),
                      },
                    })
                  }
                  className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-4 py-3 text-sm text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
                />
              </div>
            </>
          )}
          {step.type === "mcp" && (
            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--color-text-heading)]">
                {t("protocolEdit.mcpToolName")}
              </label>
              <input
                type="text"
                value={step.mcp?.tool_name ?? ""}
                onChange={(e) => setStep(index, { mcp: { tool_name: e.target.value } })}
                className={elevatedInputClass}
              />
            </div>
          )}
          {step.type === "user_input" && (
            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--color-text-heading)]">
                {t("protocolEdit.userInputPrompt")}
              </label>
              <input
                type="text"
                value={step.user_input?.prompt ?? ""}
                onChange={(e) => setStep(index, { user_input: { prompt: e.target.value } })}
                className={elevatedInputClass}
              />
            </div>
          )}
          {step.type === "comment" && (
            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--color-text-heading)]">
                {t("protocolEdit.commentMinLength")}
              </label>
              <input
                type="number"
                min={1}
                value={step.comment?.min_length ?? 10}
                onChange={(e) =>
                  setStep(index, { comment: { min_length: Math.max(1, parseInt(e.target.value, 10) || 10) } })
                }
                className={elevatedInputClass}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
