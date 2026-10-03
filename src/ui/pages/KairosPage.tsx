// squadrules-compat-surface: imports/references a retained prior-brand-named module or path (source filenames are an explicit non-goal)
import { useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { useActivate } from "@/hooks/useActivate";
import { useSpaces } from "@/hooks/useSpaces";
import { SpaceSelect } from "@/components/SpaceSelect";
import { ErrorAlert } from "@/components/ErrorAlert";
import { SearchResultsSkeleton } from "@/components/SearchResultsSkeleton";
import { toConfidencePercent } from "@/utils/confidence";
import { browseAdaptersFromSpaces } from "@/utils/browse-adapters";
import { SquadrulesActivateResultsSection, SquadrulesBrowseByLabelSection } from "@/pages/kairos-page-sections";

/** Role badge colors matching mockup 07 (match=green, refine=blue, create=amber). */
const roleBadgeClass: Record<string, string> = {
  match: "bg-[var(--badge-match-bg)] text-[var(--badge-match-fg)]",
  refine: "bg-[var(--badge-refine-bg)] text-[var(--badge-refine-fg)]",
  create: "bg-[var(--badge-create-bg)] text-[var(--badge-create-fg)]",
};

export function KairosPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const initialSpace = searchParams.get("space") ?? "";
  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [activateSpace, setActivateSpace] = useState(initialSpace);
  const [submittedSpace, setSubmittedSpace] = useState(initialSpace);
  const activateScope = submittedSpace.trim();
  const { data, isLoading, isError, error, refetch } = useActivate(submittedQuery, !!submittedQuery, {
    ...(activateScope ? { space: activateScope } : {}),
  });
  const showBrowse = !submittedQuery;
  const {
    data: spacesData,
    isLoading: spacesLoading,
    isError: spacesError,
    error: spacesErrorDetail,
    refetch: refetchSpaces,
  } = useSpaces(true, { includeAdapterTitles: showBrowse });

  useEffect(() => {
    const q = searchParams.get("q") ?? "";
    const sp = searchParams.get("space") ?? "";
    setQuery(q);
    setSubmittedQuery(q);
    setActivateSpace(sp);
    setSubmittedSpace(sp);
  }, [searchParams]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittedQuery(query);
    setSubmittedSpace(activateSpace);
    const next: Record<string, string> = {};
    if (query.trim()) next.q = query.trim();
    if (activateSpace.trim()) next.space = activateSpace.trim();
    setSearchParams(next, { replace: true });
  };

  const choicesRaw = data?.choices ?? [];
  const roleOrder: Record<string, number> = { match: 0, refine: 1, create: 2 };
  const choices = choicesRaw
    .slice()
    .sort((a, b) => {
      const ro = (roleOrder[a.role] ?? 99) - (roleOrder[b.role] ?? 99);
      if (ro !== 0) return ro;
      const as = a.activation_score ?? -1;
      const bs = b.activation_score ?? -1;
      return bs - as;
    });
  const topScore = choices.length > 0
    ? Math.max(...choices.map((c) => toConfidencePercent(c.activation_score)))
    : null;

  const { browseAdapters, countsByLetter } = useMemo(
    () => browseAdaptersFromSpaces(spacesData?.spaces),
    [spacesData?.spaces]
  );

  return (
    <div>
      <h1 className="text-[var(--color-text-heading)] text-2xl font-semibold mb-1">
        {t("kairos.title")}
      </h1>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">
        {t("kairos.searchHint")}
      </p>

      <section className="mb-8" aria-labelledby="browse-search-label">
        <h2 id="browse-search-label" className="sr-only">
          {t("kairos.searchLabel")}
        </h2>
        <form onSubmit={handleSubmit} aria-label={t("kairos.searchLabel")}>
          <label
            htmlFor="kairos-search-query"
            className="block font-medium text-[var(--color-text-heading)] mb-2"
          >
            {t("kairos.searchLabel")}
          </label>
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end mb-4">
            <div>
              <input
                id="kairos-search-query"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("kairos.searchPlaceholder")}
                aria-describedby="kairos-search-hint"
                className="w-full min-h-[44px] px-4 py-2 border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--color-text)] bg-[var(--color-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
              />
              <p id="kairos-search-hint" className="text-sm text-[var(--color-text-muted)] mt-2">
                {t("kairos.searchHintShort")}
              </p>
            </div>
            <div className="flex md:pb-0 pb-0">
              <button
                type="submit"
                className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-[var(--radius-md)] font-medium bg-[var(--color-primary)] text-white border-0 cursor-pointer hover:bg-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
              >
                {t("kairos.search")}
              </button>
            </div>
          </div>
          <div className="max-w-md mb-6">
            <label
              htmlFor="kairos-activate-space"
              className="block text-sm font-medium text-[var(--color-text-heading)] mb-2"
            >
              {t("kairos.scopeSpaceLabel")}
            </label>
            <SpaceSelect
              id="kairos-activate-space"
              spaces={spacesData?.spaces}
              value={activateSpace}
              onChange={setActivateSpace}
              includeAllOption
              disabled={spacesLoading}
              aria-describedby="kairos-search-hint"
            />
          </div>
        </form>
      </section>

      {isError && (
        <ErrorAlert
          message={error instanceof Error ? error.message : String(error)}
          onRetry={() => refetch()}
          showGoBack={true}
        />
      )}

      {showBrowse && spacesError && (
        <ErrorAlert
          message={spacesErrorDetail instanceof Error ? spacesErrorDetail.message : String(spacesErrorDetail)}
          onRetry={() => refetchSpaces()}
          showGoBack={true}
        />
      )}

      {isLoading && submittedQuery && (
        <div className="mb-4" aria-live="polite" aria-busy="true">
          <p className="sr-only">{t("kairos.loading")}</p>
          <SearchResultsSkeleton />
        </div>
      )}

      {showBrowse && spacesLoading && (
        <div className="mb-4" aria-live="polite" aria-busy="true">
          <p className="sr-only">{t("kairos.loading")}</p>
          <SearchResultsSkeleton />
        </div>
      )}

      {!isLoading && !isError && !(showBrowse && spacesError) && (
        <>
          {!submittedQuery ? (
            <SquadrulesBrowseByLabelSection
              t={t}
              spacesLoading={spacesLoading}
              browseAdapters={browseAdapters}
              countsByLetter={countsByLetter}
            />
          ) : choices.length === 0 ? (
            <div
              className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6"
              role="status"
              aria-live="polite"
            >
              <p className="text-[var(--color-text-muted)] mb-4">{t("kairos.empty")}</p>
              <div className="flex flex-wrap gap-2">
                <Link
                  to="/kairos"
                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-4 py-2 rounded-[var(--radius-md)] font-medium border border-[var(--color-border)] text-[var(--color-text)] no-underline hover:bg-[var(--color-surface-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
                >
                  {t("kairos.refineSearch")}
                </Link>
                <Link
                  to="/protocols/new"
                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-4 py-2 rounded-[var(--radius-md)] font-medium bg-[var(--color-primary)] text-white border-0 no-underline hover:bg-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
                >
                  {t("kairos.createNew")}
                </Link>
              </div>
            </div>
          ) : submittedQuery ? (
            <SquadrulesActivateResultsSection
              t={t}
              choices={choices}
              topScore={topScore}
              roleBadgeClass={roleBadgeClass}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
