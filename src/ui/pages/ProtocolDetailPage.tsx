import { useState } from "react";
import { useParams, Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useProtocol, parseProtocolMarkdown, type ParsedStep } from "@/hooks/useProtocol";
import { fetchSkillZipBundle, suggestedSkillZipFilename, triggerFileDownload } from "@/lib/export-skill-zip";
import { ChallengeCard } from "@/components/ChallengeCard";
import { CopyButton } from "@/components/CopyButton";
import { RenderedMarkdown } from "@/components/RenderedMarkdown";
import { StepFlowGraph } from "@/components/StepFlowGraph";
import { SurfaceCard } from "@/components/SurfaceCard";

function stepProseMarkdown(step: ParsedStep) {
  return step.body.replace(/\n```json\s*[\s\S]*?```\s*$/g, "").trim();
}

export function ProtocolDetailPage() {
  const { t } = useTranslation();
  const { uri } = useParams<{ uri: string }>();
  const decodedUri = uri ? decodeURIComponent(uri) : undefined;
  const { data, isLoading, isError, error } = useProtocol(decodedUri, true);
  const [skillDownloadBusy, setSkillDownloadBusy] = useState(false);
  const [skillDownloadError, setSkillDownloadError] = useState<string | null>(null);

  if (isLoading && !data) {
    return <p className="text-[var(--color-text-muted)]">{t("protocol.loading")}</p>;
  }
  if (isError || !data) {
    return (
      <div role="alert" className="p-4 rounded-[var(--radius-md)] bg-[var(--color-error-bg)] text-[var(--color-error)]">
        {error instanceof Error ? error.message : t("protocol.notFound")}
        <Link
          to="/"
          className="block mt-2 text-[var(--color-primary)] underline hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
        >
          {t("notFound.goHome")}
        </Link>
      </div>
    );
  }

  const { title, steps, triggers, completion } = parseProtocolMarkdown(data.content);
  const safeName = title.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "protocol";

  const handleDownloadMarkdown = () => {
    const blob = new Blob([data.content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadSkill = async () => {
    if (!data?.uri) return;
    setSkillDownloadError(null);
    setSkillDownloadBusy(true);
    try {
      const { blob, skill_bundle_manifest } = await fetchSkillZipBundle(data.uri);
      const name = suggestedSkillZipFilename(skill_bundle_manifest, safeName);
      triggerFileDownload(blob, name);
    } catch (e) {
      setSkillDownloadError(e instanceof Error ? e.message : String(e));
    } finally {
      setSkillDownloadBusy(false);
    }
  };

  const secondaryBtn =
    "min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-4 py-2 rounded-[var(--radius-md)] font-medium border border-[var(--color-border)] text-[var(--color-text)] bg-[var(--color-surface)] no-underline hover:bg-[var(--color-surface-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2";

  return (
    <div>
      <h1 className="text-[var(--color-text-heading)] text-2xl font-semibold mb-1">{title}</h1>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="text-sm text-[var(--color-text-muted)] m-0">
          <span className="sr-only">{t("protocol.uri")}: </span>
          <code className="break-all rounded bg-[var(--color-surface-elevated)] px-2 py-0.5 text-xs">{data.uri}</code>
          <span className="ml-2">· {t("protocol.readOnly")}</span>
          {data.space_name != null && data.space_name.length > 0 ? (
            <span className="ml-2 block w-full sm:inline sm:w-auto">
              · {t("protocol.spaceLabel")}: {data.space_name}
            </span>
          ) : null}
        </p>
        <CopyButton
          value={data.uri}
          label={t("protocol.copyUri")}
          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-3 py-1.5 text-sm font-medium rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--color-text)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
        />
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <Link
          to={`/protocols/${encodeURIComponent(data.uri)}/run`}
          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-4 py-2 rounded-[var(--radius-md)] font-medium bg-[var(--color-primary)] text-white no-underline hover:bg-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
        >
          {t("protocol.runGuided")}
        </Link>
        <Link to={`/protocols/${encodeURIComponent(data.uri)}/edit`} className={secondaryBtn}>
          {t("protocol.edit")}
        </Link>
        <Link to="/protocols/new" className={secondaryBtn}>
          {t("protocol.duplicate")}
        </Link>
      </div>

      <div className="mb-6 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <SurfaceCard title={t("protocol.howToUse")} subtitle={t("protocol.howToUseInProduct")}>
          <p className="text-sm text-[var(--color-text-muted)] m-0">
            {t("protocol.howToUseCopy")}{" "}
            <a
              href="https://github.com/SquadRules/mcp#readme"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-primary)] underline hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
            >
              {t("protocol.docsLink")}
            </a>
          </p>
        </SurfaceCard>
        <SurfaceCard title={t("protocol.exportCardTitle")} subtitle={t("protocol.exportCardSubtitle")}>
          <div className="w-full max-w-[22rem] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div className="mb-2 text-sm font-medium text-[var(--color-text-heading)]">{t("protocol.download")}</div>
            <button
              type="button"
              onClick={handleDownloadMarkdown}
              className="flex min-h-[44px] w-full items-center justify-between rounded-[var(--radius-md)] px-3 text-left text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)]"
            >
              <span>{t("protocol.downloadAsMarkdown")}</span>
              <span className="text-[var(--color-text-muted)]">.md</span>
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadSkill()}
              disabled={skillDownloadBusy}
              className="mt-1 flex min-h-[44px] w-full items-center justify-between rounded-[var(--radius-md)] px-3 text-left text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)] disabled:opacity-60"
            >
              <span>{t("protocol.downloadAsSkill")}</span>
              <span className="text-[var(--color-text-muted)]">.zip</span>
            </button>
            {skillDownloadError ? (
              <p className="mt-2 text-xs text-[var(--color-error)] m-0" role="alert">
                {skillDownloadError}
              </p>
            ) : null}
            <Link
              to={`/protocols/${encodeURIComponent(data.uri)}/skill`}
              className="mt-1 flex min-h-[44px] w-full items-center justify-between rounded-[var(--radius-md)] px-3 text-left text-sm text-[var(--color-text)] no-underline hover:bg-[var(--color-surface-elevated)]"
            >
              <span>{t("protocol.editAsSkill")}</span>
              <span className="text-[var(--color-text-muted)]">bundle</span>
            </Link>
            <p className="mt-3 text-xs leading-5 text-[var(--color-text-muted)] m-0">{t("protocol.exportFooter")}</p>
          </div>
        </SurfaceCard>
      </div>

      <section className="mb-6" aria-labelledby="flow-heading">
        <h2 id="flow-heading" className="mb-2 text-lg font-semibold text-[var(--color-text-heading)]">
          {t("protocol.stepFlow")}
        </h2>
        <StepFlowGraph steps={steps.map((s) => ({ label: s.label }))} />
      </section>

      <section aria-labelledby="steps-heading" className="mb-6">
        <h2 id="steps-heading" className="mb-2 text-lg font-semibold text-[var(--color-text-heading)]">
          {t("protocol.steps")}
        </h2>
        <ul className="m-0 list-none divide-y divide-[var(--color-border)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-0">
          {steps.map((step, i) => {
            const prose = stepProseMarkdown(step);
            return (
              <li key={i} className="p-4">
                <strong className="block text-[var(--color-text-heading)]">
                  {i + 1}. {step.label}
                </strong>
                <div className="mt-1 text-sm text-[var(--color-text-muted)] break-words">{step.summary}</div>
                <div className="mt-3">
                  <ChallengeCard type={step.type} payload={step.challengePayload} />
                </div>
                {prose ? (
                  <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                    <RenderedMarkdown content={prose} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {(triggers || completion) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {triggers ? (
            <SurfaceCard title={t("protocol.triggers")}>
              <div className="max-w-none text-sm text-[var(--color-text)]">
                <RenderedMarkdown content={triggers} />
              </div>
            </SurfaceCard>
          ) : null}
          {completion ? (
            <SurfaceCard title={t("protocol.completion")}>
              <div className="max-w-none text-sm text-[var(--color-text)]">
                <RenderedMarkdown content={completion} />
              </div>
            </SurfaceCard>
          ) : null}
        </div>
      )}
    </div>
  );
}
