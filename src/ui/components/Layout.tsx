// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import React from "react";
import { Outlet, NavLink, useLocation } from "react-router";
import { useTranslation } from "react-i18next";

/** Emitted as `/ui/assets/*.svg` — `build.assetsInlineLimit: 0` so Helmet `img-src 'self'` allows it. */
import logoSvg from "../../../logo/kairos-mcp.svg";

const isWideContentRoute = (path: string) =>
  path.startsWith("/protocols") || path.startsWith("/runs");

export function Layout() {
  const { t } = useTranslation();
  const location = useLocation();
  const path = location.pathname;

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `min-h-[var(--layout-touch-target)] flex items-center px-4 py-3 text-[var(--color-text)] no-underline border-l-[3px] border-transparent outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text-heading)] ${
      isActive
        ? "font-semibold text-[var(--color-primary)] border-l-[var(--color-primary)] bg-[var(--color-surface)]"
        : ""
    }`;

  const mainMaxWidth = isWideContentRoute(path)
    ? "min(100%, var(--layout-main-max), var(--layout-main-wide))"
    : "min(100%, var(--layout-main-max), var(--layout-main-narrow))";

  const kairosVersion = import.meta.env.VITE_KAIROS_VERSION ?? "";

  return (
    <>
      <a href="#main" className="skip-link">
        {t("skipToMain")}
      </a>
      <div className="flex min-h-screen">
        <aside
          className="flex min-h-screen w-[var(--layout-sidebar-width)] flex-shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface-elevated)] py-4"
          aria-label="Main navigation"
        >
          <div className="px-4 pb-4">
            <NavLink
              to="/"
              end
              className="flex min-h-[var(--layout-touch-target)] min-w-[var(--layout-touch-target)] items-center gap-3 rounded-md outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)]"
            >
              <img
                src={logoSvg}
                alt=""
                className="h-10 w-10 flex-shrink-0 rounded-lg object-contain"
                width="40"
                height="40"
              />
              <span className="flex flex-col leading-tight">
                <span className="font-bold text-[var(--color-text-heading)] text-lg">Squadrules</span>
                <span className="font-bold text-[var(--color-text-muted)] text-xs uppercase tracking-wide">MCP</span>
              </span>
            </NavLink>
          </div>
          <nav className="flex min-h-0 flex-1 flex-col gap-0.5">
            <NavLink to="/" end aria-current={path === "/" ? "page" : undefined} className={navLinkClass}>
              {t("nav.home")}
            </NavLink>
            <NavLink
              to="/kairos"
              aria-current={path === "/kairos" ? "page" : undefined}
              className={navLinkClass}
            >
              {t("nav.kairos")}
            </NavLink>
            <NavLink
              to="/protocols/new"
              aria-current={path === "/protocols/new" ? "page" : undefined}
              className={navLinkClass}
            >
              {t("nav.create")}
            </NavLink>
            <NavLink
              to="/runs"
              aria-current={path === "/runs" ? "page" : undefined}
              className={navLinkClass}
            >
              {t("nav.runs")}
            </NavLink>
            <NavLink
              to="/account"
              aria-current={path === "/account" ? "page" : undefined}
              className={navLinkClass}
            >
              {t("nav.account")}
            </NavLink>
          </nav>
          <div className="mt-auto border-t border-[var(--color-border)] px-4 pt-3">
            <p className="m-0 text-xs text-[var(--color-text-muted)]">
              {t("layout.kairosVersion", { version: kairosVersion || "—" })}
            </p>
          </div>
        </aside>
        <main
          id="main"
          className="flex-1 mx-auto w-full py-[var(--layout-main-padding-y)] px-[var(--layout-main-padding-x)]"
          style={{ maxWidth: mainMaxWidth }}
          tabIndex={-1}
        >
          <Outlet />
        </main>
      </div>
    </>
  );
}
