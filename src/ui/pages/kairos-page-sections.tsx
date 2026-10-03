import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { TFunction } from "i18next";
import { SpaceTypeBadge } from "@/components/SpaceSelect";
import type { AdapterBrowseRow } from "@/utils/browse-adapters";
import { BROWSE_LETTERS } from "@/utils/browse-adapters";
import { toConfidencePercent } from "@/utils/confidence";
import type { ActivateOutput } from "../../tools/activate_schema.js";

type Choice = ActivateOutput["choices"][number];

/** Default Browse view: A–Z letter blocks with counts; expand to list protocols for that letter. */
export function SquadrulesBrowseByLabelSection(props: {
  t: TFunction;
  spacesLoading: boolean;
  browseAdapters: AdapterBrowseRow[];
  countsByLetter: Record<string, number>;
}) {
  const { t, spacesLoading, browseAdapters, countsByLetter } = props;
  const [expandedLetter, setExpandedLetter] = useState<string | null>(null);

  const adaptersForLetter = useMemo(() => {
    if (!expandedLetter) return [];
    return browseAdapters
      .filter((a) => {
        const first = (a.title ?? "").trim().charAt(0).toUpperCase();
        return first === expandedLetter;
      })
      .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? "", undefined, { sensitivity: "base" }));
  }, [browseAdapters, expandedLetter]);

  const hasAnyAdapter = browseAdapters.length > 0;

  return (
    <section aria-labelledby="browse-by-label-heading">
      <h2 id="browse-by-label-heading" className="text-lg font-semibold text-[var(--color-text-heading)] mb-3">
        {t("squadrules.browseByLabel")}
      </h2>
      <p className="text-sm text-[var(--color-text-muted)] mb-4">{t("squadrules.browseByLetterHint")}</p>
      {!spacesLoading && !hasAnyAdapter ? (
        <p className="text-sm text-[var(--color-text-muted)]">{t("squadrules.browseEmpty")}</p>
      ) : null}
      {!spacesLoading && hasAnyAdapter ? (
        <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label={t("squadrules.browseByLabel")}>
          {BROWSE_LETTERS.map((letter) => {
            const count = countsByLetter[letter] ?? 0;
            return (
              <button
                key={letter}
                type="button"
                onClick={() => setExpandedLetter((prev) => (prev === letter ? null : letter))}
                aria-expanded={expandedLetter === letter}
                aria-controls={`browse-letter-panel-${letter}`}
                aria-pressed={expandedLetter === letter}
                aria-label={t("squadrules.letterCount", { letter, count })}
                className={`min-h-[var(--layout-touch-target)] min-w-[var(--layout-touch-target)] inline-flex items-center justify-center rounded-[var(--radius-md)] border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2 ${
                  expandedLetter === letter
                    ? "border-[var(--color-primary)] bg-[var(--color-surface-elevated)] text-[var(--color-primary)]"
                    : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)]"
                }`}
              >
                {letter}: {count}
              </button>
            );
          })}
        </div>
      ) : null}
      {expandedLetter && !spacesLoading && hasAnyAdapter ? (
        <div
          id={`browse-letter-panel-${expandedLetter}`}
          role="region"
          aria-labelledby="browse-letter-panel-heading"
          aria-live="polite"
          className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-5"
        >
          <h3 id="browse-letter-panel-heading" className="text-base font-semibold text-[var(--color-text-heading)] mb-3">
            {t("squadrules.labelsStartingWith", { letter: expandedLetter })}
          </h3>
          {adaptersForLetter.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">{t("squadrules.noLabelsForLetter")}</p>
          ) : (
            <ul
              className="m-0 list-none space-y-2 p-0"
              role="list"
              aria-label={t("squadrules.labelsStartingWith", { letter: expandedLetter })}
            >
              {adaptersForLetter.map((adapter) => {
                return (
                  <li
                    key={adapter.adapter_id}
                    className="flex flex-col gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex flex-col gap-1">
                      <span className="font-medium text-[var(--color-text-heading)]">{adapter.title}</span>
                      <div className="flex flex-wrap items-center gap-2">
                        <SpaceTypeBadge type={adapter.space_type} />
                        <span className="text-xs text-[var(--color-text-muted)]">{adapter.space_name}</span>
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      <Link
                        to={`/protocols/${encodeURIComponent(adapter.uri)}`}
                        aria-label={t("squadrules.viewProtocol", { title: adapter.title })}
                        className="min-h-[var(--layout-touch-target)] min-w-[var(--layout-touch-target)] inline-flex items-center justify-center px-4 py-2 rounded-[var(--radius-md)] font-medium bg-[var(--color-primary)] text-white no-underline hover:bg-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
                      >
                        {t("squadrules.view")}
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function SquadrulesActivateResultsSection(props: {
  t: TFunction;
  choices: Choice[];
  topScore: number | null;
  roleBadgeClass: Record<string, string>;
}) {
  const { t, choices, topScore, roleBadgeClass } = props;

  return (
    <>
      {choices.length > 0 && (
        <p
          id="squadrules-results-summary"
          className="text-sm text-[var(--color-text-muted)] mb-4"
          aria-live="polite"
          role="status"
        >
          {t("squadrules.foundMatches", {
            count: choices.length,
            top: topScore != null ? Math.round(topScore) : 0,
          })}
        </p>
      )}
      <ul className="list-none p-0 m-0 space-y-2" role="list" aria-label={t("squadrules.resultsLabel")}>
        {choices.map((choice) => (
          <li
            key={choice.uri}
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-5 flex justify-between items-start gap-4"
          >
            <div className="flex-1 min-w-0">
              <span className="font-medium text-[var(--color-text-heading)] block">{choice.label}</span>
              <div className="text-sm text-[var(--color-text-muted)] mt-1">
                {choice.adapter_name ??
                  (choice.role === "refine"
                    ? t("squadrules.refineMeta")
                    : choice.role === "create"
                      ? t("squadrules.createMeta")
                      : "")}
                {choice.role === "match" && choice.space_name != null && choice.space_name.length > 0 && (
                  <>
                    {" "}
                    · {t("squadrules.spaceLabel")}: {choice.space_name}
                  </>
                )}
                {choice.activation_score != null && ` · ${t("squadrules.score")}: ${toConfidencePercent(choice.activation_score)}%`}
                {choice.adapter_version && ` · ${t("squadrules.version")}: ${choice.adapter_version}`}
              </div>
              <span
                className={`inline-block mt-1 text-xs uppercase tracking-wide px-2 py-0.5 rounded ${roleBadgeClass[choice.role] ?? "bg-[var(--color-surface)] text-[var(--color-text-muted)]"}`}
                aria-label={`Role: ${choice.role}`}
              >
                {choice.role}
              </span>
              {choice.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2" aria-label={t("squadrules.tagsLabel")}>
                  {choice.tags.slice(0, 8).map((tag) => (
                    <span
                      key={tag}
                      className="inline-block text-xs px-2 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex-shrink-0">
              {choice.role === "match" && (
                <Link
                  to={`/protocols/${encodeURIComponent(choice.uri)}`}
                  aria-label={t("squadrules.viewProtocol", { title: choice.label })}
                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-4 py-2 rounded-[var(--radius-md)] font-medium bg-[var(--color-primary)] text-white no-underline hover:bg-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
                >
                  {t("squadrules.view")}
                </Link>
              )}
              {choice.role === "refine" && (
                <Link
                  to={`/protocols/${encodeURIComponent(choice.uri)}`}
                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-4 py-2 rounded-[var(--radius-md)] font-medium bg-[var(--color-primary)] text-white no-underline hover:bg-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
                >
                  {t("squadrules.refineSearch")}
                </Link>
              )}
              {choice.role === "create" && (
                <Link
                  to="/protocols/new"
                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-4 py-2 rounded-[var(--radius-md)] font-medium bg-[var(--color-primary)] text-white no-underline hover:bg-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
                >
                  {t("squadrules.createNew")}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
