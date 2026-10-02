import { useState } from "react";
import { useParams, Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useProtocol, parseProtocolMarkdown } from "@/hooks/useProtocol";
import { fetchSkillZipBundle, suggestedSkillZipFilename, triggerFileDownload } from "@/lib/export-skill-zip";
import { RichTextEditor } from "@/components/RichTextEditor";
import { SurfaceCard } from "@/components/SurfaceCard";

function chipClass(active: boolean) {
  return `min-h-[44px] rounded-full px-4 text-sm font-medium ${
    active
      ? "bg-[var(--color-primary)] text-white"
      : "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
  }`;
}

export function SkillBundlePage() {
  const { t } = useTranslation();
  const { uri } = useParams<{ uri: string }>();
  const decodedUri = uri ? decodeURIComponent(uri) : undefined;
  const { data, isLoading, isError, error } = useProtocol(decodedUri, true);
  const [skillName, setSkillName] = useState("");
  const [description, setDescription] = useState("");
  const [whenToUse, setWhenToUse] = useState("");
  const [includeReferences, setIncludeReferences] = useState(true);
  const [zipBusy, setZipBusy] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);

  if (isLoading && !data) {
    return <p className="text-[var(--color-text-muted)]">{t("protocol.loading")}</p>;
  }
  if (isError || !data) {
    return (
      <div role="alert" className="rounded-[var(--radius-md)] bg-[var(--color-error-bg)] p-4 text-[var(--color-error)]">
        {error instanceof Error ? error.message : t("protocol.notFound")}
        <Link
          to="/"
          className="mt-2 block text-[var(--color-primary)] underline hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
        >
          {t("notFound.goHome")}
        </Link>
      </div>
    );
  }

  const { title } = parseProtocolMarkdown(data.content);
  const displayName = skillName.trim() || title;
  const safeName = displayName.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "skill";
  const folderSlug = `${safeName}-skill`;

  const handleDownload = async () => {
    setZipError(null);
    setZipBusy(true);
    try {
      const { blob, skill_bundle_manifest } = await fetchSkillZipBundle(data.uri);
      const name = suggestedSkillZipFilename(skill_bundle_manifest, safeName);
      triggerFileDownload(blob, name);
    } catch (e) {
      setZipError(e instanceof Error ? e.message : String(e));
    } finally {
      setZipBusy(false);
    }
  };

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-[var(--color-text-heading)]">{t("skill.title")}</h1>
      <p className="mb-6 text-sm text-[var(--color-text-muted)]">{t("skill.subtitle")}</p>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          <div>
            <label htmlFor="skill-name" className="mb-2 block font-medium text-[var(--color-text-heading)]">
              {t("skill.skillName")}
            </label>
            <input
              id="skill-name"
              type="text"
              value={skillName}
              onChange={(e) => setSkillName(e.target.value)}
              placeholder={title}
              className="min-h-[44px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
            />
          </div>

          <RichTextEditor
            label={t("skill.description")}
            hint={t("skill.descriptionHint")}
            value={description}
            onChange={setDescription}
            contentKey="skill-desc"
          />

          <RichTextEditor
            label={t("skill.whenToUse")}
            value={whenToUse}
            onChange={setWhenToUse}
            contentKey="skill-when"
          />

          <SurfaceCard title={t("skill.bundleContentsTitle")} subtitle={t("skill.bundleContentsSubtitle")}>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={includeReferences}
                onClick={() => setIncludeReferences((v) => !v)}
                className={chipClass(includeReferences)}
              >
                {t("skill.includeReferences")}
              </button>
              <button type="button" disabled className={`${chipClass(false)} cursor-not-allowed opacity-50`} title={t("skill.comingSoon")}>
                {t("skill.chipReadme")}
              </button>
              <button type="button" disabled className={`${chipClass(false)} cursor-not-allowed opacity-50`} title={t("skill.comingSoon")}>
                {t("skill.chipPrompts")}
              </button>
            </div>
          </SurfaceCard>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleDownload()}
              disabled={zipBusy}
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 py-2 font-medium text-white hover:bg-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2 disabled:opacity-60"
            >
              {t("skill.downloadAsSkill")}
            </button>
            {zipError ? (
              <p className="m-0 text-sm text-[var(--color-error)]" role="alert">
                {zipError}
              </p>
            ) : null}
            <Link
              to={`/protocols/${encodeURIComponent(data.uri)}`}
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 font-medium text-[var(--color-text)] no-underline hover:bg-[var(--color-surface-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
            >
              {t("skill.backToProtocol")}
            </Link>
          </div>
        </div>

        <div className="space-y-4">
          <SurfaceCard title={t("skill.bundlePreviewTitle")} subtitle={t("skill.bundlePreviewSubtitle")}>
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 font-mono text-sm text-[var(--color-text)]">
              {folderSlug}.zip
              <br />
              └── {folderSlug}/
              <br />
              &nbsp;&nbsp;&nbsp;&nbsp;├── Skill.md
              <br />
              {includeReferences ? (
                <>
                  &nbsp;&nbsp;&nbsp;&nbsp;└── references/
                  <br />
                  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;└── SQUADRULES.md
                </>
              ) : (
                <>&nbsp;&nbsp;&nbsp;&nbsp;└── (no references/)</>
              )}
            </div>
          </SurfaceCard>

          <SurfaceCard title={t("skill.whyExportTitle")} subtitle={t("skill.whyExportSubtitle")}>
            <p className="m-0 text-sm text-[var(--color-text-muted)]">{t("skill.whyExportBody")}</p>
          </SurfaceCard>
        </div>
      </div>
    </div>
  );
}
