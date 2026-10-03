import { useState } from "react";
import { Link } from "react-router";
import type { TFunction } from "i18next";
import { CHALLENGE_TYPE_LABEL } from "@/components/ChallengeCard";
import { SurfaceCard } from "@/components/SurfaceCard";
import { fetchSkillZipBundle, suggestedSkillZipFilename, triggerFileDownload } from "@/lib/export-skill-zip";

export type ProtocolPreviewModel = {
  title: string;
  steps: { label: string; type: string }[];
  triggers: string;
  completion: string;
};

type ProtocolEditPreviewColumnProps = {
  t: TFunction;
  preview: ProtocolPreviewModel;
  skillFolderSlug: string;
  isNew: boolean;
  decodedUri: string | undefined;
};

export function ProtocolEditPreviewColumn({
  t,
  preview,
  skillFolderSlug,
  isNew,
  decodedUri,
}: ProtocolEditPreviewColumnProps) {
  const [zipBusy, setZipBusy] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);

  return (
    <div className="space-y-4" aria-label={t("protocolEdit.previewLabel")}>
      <SurfaceCard title={t("protocolEdit.previewRenderedTitle")} subtitle={t("protocolEdit.previewRenderedSubtitle")}>
        <div className="text-lg font-semibold text-[var(--color-text-heading)]">{preview.title}</div>
        <div className="mt-3 space-y-3">
          {preview.steps.length === 0 ? (
            <div className="text-sm text-[var(--color-text-muted)]">{t("protocolEdit.previewNoSteps")}</div>
          ) : (
            preview.steps.slice(0, 20).map((s, idx) => (
              <div
                key={`${s.label}:${idx}`}
                className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
              >
                <div className="font-medium text-[var(--color-text-heading)]">
                  {t("protocolEdit.previewStepLine", { n: idx + 1, label: s.label })}
                </div>
                <div className="mt-1 text-sm text-[var(--color-text-muted)]">
                  {CHALLENGE_TYPE_LABEL[s.type] ?? s.type}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="mt-4 border-t border-[var(--color-border)] pt-4 text-sm text-[var(--color-text-muted)]">
          <div>
            <strong className="text-[var(--color-text-heading)]">{t("protocol.triggers")}:</strong>{" "}
            {preview.triggers ? t("protocolEdit.present") : t("protocolEdit.missing")}
          </div>
          <div className="mt-1">
            <strong className="text-[var(--color-text-heading)]">{t("protocol.completion")}:</strong>{" "}
            {preview.completion ? t("protocolEdit.present") : t("protocolEdit.missing")}
          </div>
        </div>
      </SurfaceCard>

      {!isNew && decodedUri ? (
        <SurfaceCard title={t("protocolEdit.skillShortcutTitle")} subtitle={t("protocolEdit.skillShortcutSubtitle")}>
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div className="font-medium text-[var(--color-text-heading)]">{skillFolderSlug}-skill/</div>
            <div className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
              Skill.md
              <br />
              references/
              <br />
              &nbsp;&nbsp;SQUADRULES.md
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              to={`/protocols/${encodeURIComponent(decodedUri)}/skill`}
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text)] no-underline hover:bg-[var(--color-surface-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
            >
              {t("protocol.editAsSkill")}
            </Link>
            <button
              type="button"
              disabled={zipBusy}
              onClick={() => {
                void (async () => {
                  if (!decodedUri) return;
                  setZipError(null);
                  setZipBusy(true);
                  try {
                    const { blob, skill_bundle_manifest } = await fetchSkillZipBundle(decodedUri);
                    const name = suggestedSkillZipFilename(skill_bundle_manifest, skillFolderSlug);
                    triggerFileDownload(blob, name);
                  } catch (e) {
                    setZipError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setZipBusy(false);
                  }
                })();
              }}
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2 disabled:opacity-60"
            >
              {t("protocol.downloadAsSkill")}
            </button>
            {zipError ? (
              <p className="mt-2 m-0 text-xs text-[var(--color-error)]" role="alert">
                {zipError}
              </p>
            ) : null}
          </div>
        </SurfaceCard>
      ) : null}
    </div>
  );
}
