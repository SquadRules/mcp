import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { useSpaces } from "@/hooks/useSpaces";
import { SpaceTypeBadge } from "@/components/SpaceSelect";
import { SurfaceCard } from "@/components/SurfaceCard";

/**
 * Home: lightweight orientation (Protocol UX target) — find protocols, jump to Browse / Create / Test Run, space stats.
 */
export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useSpaces();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const q = (form.querySelector('input[name="q"]') as HTMLInputElement)?.value?.trim() ?? "";
    navigate(q ? `/squadrules?q=${encodeURIComponent(q)}` : "/squadrules");
  };

  const spaces = data?.spaces ?? [];
  const showPlaceholder = isLoading || isError || spaces.length === 0;

  return (
    <div>
      <h1 className="text-[var(--color-text-heading)] text-2xl font-semibold mb-1">{t("home.title")}</h1>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">{t("home.tagline")}</p>

      <SurfaceCard title={t("home.findCardTitle")} subtitle={t("home.findCardSubtitle")} className="mb-6">
        <form onSubmit={handleSubmit} className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end" aria-label={t("home.searchLabel")}>
          <div>
            <label htmlFor="home-search-query" className="block font-medium text-[var(--color-text-heading)] mb-2">
              {t("home.searchLabel")}
            </label>
            <input
              id="home-search-query"
              name="q"
              type="search"
              autoComplete="off"
              placeholder={t("home.searchPlaceholder")}
              aria-describedby="home-search-hint"
              className="w-full min-h-[44px] px-4 py-2 border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--color-text)] bg-[var(--color-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
            />
            <p id="home-search-hint" className="text-sm text-[var(--color-text-muted)] mt-2">
              {t("home.searchHint")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 md:flex-col md:items-stretch">
            <button
              type="submit"
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-4 py-2 rounded-[var(--radius-md)] font-medium bg-[var(--color-primary)] text-white border-0 cursor-pointer hover:bg-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
            >
              {t("squadrules.search")}
            </button>
            <Link
              to="/squadrules"
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-4 py-2 rounded-[var(--radius-md)] font-medium border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] no-underline hover:bg-[var(--color-surface-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
            >
              {t("home.goToBrowse")}
            </Link>
          </div>
        </form>
      </SurfaceCard>

      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <SurfaceCard title={t("home.cardBrowseTitle")} subtitle={t("home.cardBrowseSubtitle")}>
          <Link
            to="/squadrules"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-4 py-2 rounded-[var(--radius-md)] font-medium bg-[var(--color-primary)] text-white no-underline hover:bg-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
          >
            {t("home.cardBrowseCta")}
          </Link>
        </SurfaceCard>
        <SurfaceCard title={t("home.cardCreateTitle")} subtitle={t("home.cardCreateSubtitle")}>
          <Link
            to="/protocols/new"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-4 py-2 rounded-[var(--radius-md)] font-medium border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] no-underline hover:bg-[var(--color-surface-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
          >
            {t("home.cardCreateCta")}
          </Link>
        </SurfaceCard>
        <SurfaceCard title={t("home.cardRunsTitle")} subtitle={t("home.cardRunsSubtitle")}>
          <Link
            to="/runs"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-4 py-2 rounded-[var(--radius-md)] font-medium border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] no-underline hover:bg-[var(--color-surface-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
          >
            {t("home.cardRunsCta")}
          </Link>
        </SurfaceCard>
      </div>

      <section aria-labelledby="home-stats-heading">
        <h2 id="home-stats-heading" className="text-lg font-semibold text-[var(--color-text-heading)] mb-2">
          {t("home.spacesHeading")}
        </h2>
        <div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-label={t("home.statsLabel")}
        >
          {showPlaceholder && spaces.length === 0 ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-4">
              <span className="text-2xl font-semibold text-[var(--color-text-heading)]">—</span>
              <span className="block text-xs uppercase tracking-wide text-[var(--color-text-muted)] mt-1">
                {t("home.stats.spacesLabel")}
              </span>
              <span className="block text-sm text-[var(--color-text-muted)] mt-2">{t("home.stats.protocolCount", { count: 0 })}</span>
            </div>
          ) : null}
          {spaces.map((space) => (
            <div
              key={space.space_id}
              className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-4"
            >
              <div className="text-2xl font-semibold text-[var(--color-text-heading)]">
                {isLoading ? "—" : space.adapter_count}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{space.name}</span>
                <SpaceTypeBadge type={space.type} />
              </div>
              <div className="mt-2 text-sm text-[var(--color-text-muted)]">
                {isLoading ? "—" : t("home.stats.protocolCount", { count: space.adapter_count })}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
