// squadrules-compat-surface: dual-accepts canonical kairos:// URIs alongside squadrules:// so existing stored URIs keep resolving
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";

import { RunGuidedContent } from "@/components/run/RunGuidedContent";
import { SurfaceCard } from "@/components/SurfaceCard";
import { ErrorAlert } from "@/components/ErrorAlert";
import { useForwardStart } from "@/hooks/useForwardStart";
import { useForwardStep } from "@/hooks/useForwardStep";
import { useReward } from "@/hooks/useReward";
import { useRunSession, useRunSessions, type RunSession } from "@/hooks/useRunSession";
import type { RunSolutionSubmission } from "@/lib/runToolTypes";

function extractFirstMemUri(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const m = text.match(/(?:kairos|squadrules):\/\/layer\/[0-9a-fA-F-]{36}(?:\?execution_id=[0-9a-fA-F-]{36})?/);
  return m?.[0];
}

function nowIso() {
  return new Date().toISOString();
}

export function RunGuidedPage() {
  const { t } = useTranslation();
  const { uri } = useParams<{ uri: string }>();
  const [searchParams] = useSearchParams();
  const decodedUri = uri ? decodeURIComponent(uri) : undefined;

  const sessionIdFromQuery = searchParams.get("session");
  const { session: existingSession } = useRunSession(sessionIdFromQuery);
  const { upsert } = useRunSessions();

  const forwardStart = useForwardStart();
  const forwardStep = useForwardStep();
  const reward = useReward();

  const [run, setRun] = useState<RunSession | null>(null);
  const [rewardOutcome, setRewardOutcome] = useState<"success" | "failure">("success");
  const [rewardFeedback, setRewardFeedback] = useState("");
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  useEffect(() => {
    if (existingSession && !run) {
      setRun(existingSession);
      setRewardOutcome("success");
      setRewardFeedback("");
    }
  }, [existingSession, run]);

  const persist = (session: RunSession) => {
    setRun(session);
    upsert(session);
  };

  const handleStart = async () => {
    if (!decodedUri) return;
    try {
      const res = await forwardStart.mutateAsync(decodedUri);
      const startedAt = nowIso();
      const id = `${decodedUri}:${startedAt}`;
      const status: RunSession["status"] = res.next_action?.includes("reward") ? "ready_to_reward" : "running";
      const rewardUri = extractFirstMemUri(res.next_action);
      persist({
        id,
        adapter_uri: decodedUri,
        started_at: startedAt,
        updated_at: startedAt,
        status,
        current_layer: res.current_layer ?? null,
        contract: res.contract,
        next_action: res.next_action,
        last_message: res.message,
        previous_proof_hash: res.proof_hash,
        reward_uri: status === "ready_to_reward" ? rewardUri : undefined,
        history: [],
      });
    } catch (_err) {
      setRun(null);
    }
  };

  const handleCopy = async (text: string) => {
    setCopyStatus(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(t("run.copied"));
      setTimeout(() => setCopyStatus(null), 1500);
    } catch (err) {
      setCopyStatus(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSubmitStep = async (draft: Omit<RunSolutionSubmission, "nonce" | "proof_hash" | "previousProofHash">) => {
    if (!run?.current_layer) return;
    const nonce = run.contract.nonce;
    const proofHash = run.previous_proof_hash ?? run.contract.proof_hash;
    const solution: RunSolutionSubmission = {
      ...draft,
      ...(nonce ? { nonce } : {}),
      ...(proofHash ? { proof_hash: proofHash } : {}),
    };

    try {
      const res = await forwardStep.mutateAsync({ uri: run.current_layer.uri, solution });
      const updatedAt = nowIso();
      const readyToReward = res.next_action?.includes("reward") || (res.message?.toLowerCase().includes("call reward") ?? false);
      const rewardUri = extractFirstMemUri(res.next_action) ?? run.reward_uri;
      persist({
        ...run,
        updated_at: updatedAt,
        status: readyToReward ? "ready_to_reward" : "running",
        current_layer: res.current_layer ?? null,
        contract: res.contract,
        next_action: res.next_action,
        last_message: res.message,
        previous_proof_hash: res.proof_hash ?? run.previous_proof_hash,
        reward_uri: readyToReward ? rewardUri : undefined,
        history: [
          ...run.history,
          {
            layer: run.current_layer,
            contract: run.contract,
            solution,
            submitted_at: updatedAt,
            proof_hash: res.proof_hash,
            server_message: res.message,
          },
        ],
      });
    } catch (err) {
      persist({
        ...run,
        updated_at: nowIso(),
        status: "error",
        last_message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleReward = async () => {
    if (!run) return;
    const rewardUri = run.reward_uri ?? run.current_layer?.uri;
    if (!rewardUri) return;
    try {
      const res = await reward.mutateAsync({
        uri: rewardUri,
        outcome: rewardOutcome,
        feedback: rewardFeedback.trim() || t("run.reward.defaultFeedback"),
      });
      persist({
        ...run,
        updated_at: nowIso(),
        status: "completed",
        last_message: res.results[0]?.feedback ?? run.last_message,
      });
    } catch (err) {
      persist({
        ...run,
        updated_at: nowIso(),
        status: "error",
        last_message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  if (!decodedUri) {
    return <ErrorAlert message={t("run.missingUri")} showGoBack={true} />;
  }

  return (
    <div>
      <h1 className="text-[var(--color-text-heading)] text-2xl font-semibold mb-1">{t("run.title")}</h1>
      <p className="mb-4 text-sm text-[var(--color-text-muted)]">{t("run.guidedIntro")}</p>
      <p className="mb-4 text-sm text-[var(--color-text-muted)]">
        {t("run.adapterUri")}: <span className="font-mono break-all">{decodedUri}</span>
      </p>

      <div className="flex flex-wrap gap-2 mb-6">
        <Link
          to={`/protocols/${encodeURIComponent(decodedUri)}`}
          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-4 py-2 rounded-[var(--radius-md)] font-medium border border-[var(--color-border)] text-[var(--color-text)] no-underline hover:bg-[var(--color-surface-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
        >
          {t("run.backToProtocol")}
        </Link>
        {!run && (
          <button
            type="button"
            onClick={handleStart}
            disabled={forwardStart.isPending}
            className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-[var(--radius-md)] font-medium bg-[var(--color-primary)] text-white border-0 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed hover:bg-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
          >
            {forwardStart.isPending ? t("run.starting") : t("run.start")}
          </button>
        )}
      </div>

      <SurfaceCard className="mb-6" title={t("run.safety.title")}>
        <p className="m-0 text-sm text-[var(--color-text-muted)]">{t("run.safety.copy")}</p>
      </SurfaceCard>

      {forwardStart.isError && (
        <ErrorAlert
          message={forwardStart.error instanceof Error ? forwardStart.error.message : String(forwardStart.error)}
          onRetry={() => handleStart()}
          showGoBack={true}
        />
      )}

      {run?.status === "error" && run.last_message && (
        <div className="mb-6">
          <ErrorAlert
            message={run.last_message}
            onRetry={() => handleStart()}
            showGoBack={true}
          />
        </div>
      )}

      {run && run.status !== "error" && (
        <RunGuidedContent
          run={run}
          rewardOutcome={rewardOutcome}
          setRewardOutcome={setRewardOutcome}
          rewardFeedback={rewardFeedback}
          setRewardFeedback={setRewardFeedback}
          copyStatus={copyStatus}
          onCopy={handleCopy}
          onSubmitStep={handleSubmitStep}
          onReward={handleReward}
          isForwardStepPending={forwardStep.isPending}
          isForwardStartPending={forwardStart.isPending}
          isRewardPending={reward.isPending}
        />
      )}
    </div>
  );
}

