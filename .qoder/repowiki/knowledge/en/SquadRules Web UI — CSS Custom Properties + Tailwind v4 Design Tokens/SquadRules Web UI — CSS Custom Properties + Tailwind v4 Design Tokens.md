---
kind: frontend_style
name: SquadRules Web UI — CSS Custom Properties + Tailwind v4 Design Tokens
category: frontend_style
scope:
    - '**'
source_files:
    - src/ui/index.css
    - src/ui/theme/tokens.css
    - src/ui/theme/tokens-shared.css
    - src/ui/theme/tokens-theme-light.css
    - src/ui/theme/tokens-theme-dark.css
    - src/ui/hooks/useThemePreference.tsx
    - src/ui/App.tsx
---

## What system/approach is used

The SquadRules web UI (under `src/ui/`) is a React SPA built with **Tailwind CSS v4** (`@import "tailwindcss"` in `index.css`, using the new `@theme inline` directive). There is no separate Tailwind config file; all design tokens live as native CSS custom properties and are mapped into Tailwind's theme via `@theme inline`. Components use Tailwind utility classes directly rather than a component library.

Theming is driven by **CSS custom properties** (design tokens) organized under `src/ui/theme/`, with two concrete themes — light (default, applied on `:root`) and dark (applied when `html[data-theme="dark"]`). Theme switching is implemented in a React hook (`useThemePreference.tsx`) that persists a `squadrules:ui:theme-preference` key in `localStorage` and supports a `system` mode that follows `prefers-color-scheme: dark`.

There is no SCSS, Sass, PostCSS plugin chain, or external UI kit (no shadcn, MUI, Radix primitives, etc.). The only third-party styling dependency is Tailwind v4.

## Key files and packages

- `src/ui/index.css` — entry stylesheet; imports tokens, then Tailwind, then maps every token into Tailwind's `@theme inline` block.
- `src/ui/theme/tokens.css` — aggregator that `@import`s shared tokens and both theme sheets.
- `src/ui/theme/tokens-shared.css` — structural tokens (spacing scale, typography scale, radii, layout max widths, touch target size, focus-visible defaults).
- `src/ui/theme/tokens-theme-light.css` — semantic color tokens on `:root` (primary, secondary, accent, text, surface, border, error, success, warning, badge variants, status variants).
- `src/ui/theme/tokens-theme-dark.css` — overrides of the same tokens under `html[data-theme="dark"]`.
- `src/ui/hooks/useThemePreference.tsx` — React context/hook for theme preference, persistence, and system preference detection.
- `src/ui/App.tsx` — route tree; documents the intent to keep initial chunk under 500 kB via lazy-loaded pages.
- `src/mcp-apps/` — server-side HTML/CSS/JS assets for MCP Apps widgets (separate from the SPA; uses its own inline CSS/HTML strings).

## Architecture and conventions

1. **Single source of truth for tokens**: `tokens-shared.css` defines spacing, typography, radius, and layout constants; `tokens-theme-*.css` define colors. Adding a new theme means adding a new `tokens-theme-*.css` file and importing it from `tokens.css` (the comment in `tokens.css` explicitly instructs this).
2. **Token → Tailwind mapping layer**: `index.css` contains an explicit `@theme inline { ... }` block that re-declares each token as a Tailwind theme variable (e.g. `--color-primary: var(--color-primary)`). This keeps Tailwind utilities consuming semantic names while the actual values stay in CSS variables.
3. **Semantic token naming**: Colors use `--color-*`, badges use `--badge-<type>-bg/--fg` (shell, mcp, user-input, comment, match, refine, create, personal, group, app, other), statuses use `--status-success-bg/--fg`. Spacing uses `--space-N` following an 8px base grid. Typography uses `--font-size-*` and `--font-weight-*`.
4. **Responsive strategy**: No media queries inside components. A single breakpoint at `min-width: 1024px` adjusts `--layout-main-padding-x` in `tokens-shared.css`; layout constraints are expressed via `--layout-main-max`, `--layout-main-narrow`, `--layout-main-wide`, and `--layout-sidebar-width` tokens consumed by components.
5. **Accessibility baseline**: `tokens-shared.css` sets a global `:focus-visible` rule (2px outline, 2px offset, contrast ≥ 3:1 per the comment), a `.skip-link` utility, a `.sr-only` utility, and a `prefers-reduced-motion` rule that zeroes animation/transition durations.
6. **Dark mode mechanism**: `useThemePreference.tsx` writes `data-theme="light|dark"` onto `document.documentElement` and also sets `documentElement.style.colorScheme`. Dark theme selectors in `tokens-theme-dark.css` target `html[data-theme="dark"]`. The hook exposes `UI_THEME_CHOICES = ["light", "dark"]` typed as a const array, and validates stored preferences against it.
7. **Component styling**: Components under `src/ui/components/` and `src/ui/pages/` compose their appearance with Tailwind utility classes referencing the mapped tokens (e.g. `text-[var(--color-text-muted)]`, `bg-[var(--color-surface)]`). There is no BEM, CSS Modules, or styled-components usage observed.
8. **MCP Apps widget assets**: Separate from the SPA, served via `src/http/http-ui-static.ts` and assembled in `src/mcp-apps/`. These widgets ship inline CSS/HTML/JS strings (e.g. `activate-widget-inline-css.ts`, `mcp-widget-chrome-inline-css.ts`) and are not part of the Tailwind build pipeline.

## Conventions and constraints

- **Design tokens are the single source of truth for colors, spacing, typography, and radius.** New visual values must be added as CSS custom properties in `tokens-shared.css` or `tokens-theme-*.css`, then mirrored into the `@theme inline` block in `index.css` so they are usable as Tailwind utilities. The comment in `tokens.css` states this is the "Source of truth for colors, spacing, typography, radius."
- **New themes are added by creating a new `tokens-theme-*.css` file and importing it from `tokens.css`.** The `tokens.css` header explicitly says: "Theme colors: tokens-theme-light.css, tokens-theme-dark.css (add tokens-theme-*.css + import for new themes)."
- **Theme choices are constrained to the literal union `["light", "dark"]`.** `useThemePreference.tsx` declares `UI_THEME_CHOICES` as a `readonly string[]` and validates persisted preferences against it; invalid values fall back to `"system"`.
- **Dark theme activation requires `html[data-theme="dark"]`.** Both the hook (`applyThemeToDocument`) and the dark theme CSS selector (`html[data-theme="dark"]`) enforce this contract.
- **System preference storage key is fixed:** `THEME_PREFERENCE_STORAGE_KEY = "squadrules:ui:theme-preference"`. Cross-tab synchronization uses the `storage` event on this exact key.
- **Focus accessibility is enforced globally:** `tokens-shared.css` applies a `:focus-visible` rule with a 2px solid outline using `--color-focus-ring`, and a dedicated `.skip-link` utility plus `.sr-only` utility are provided.
- **Reduced motion is respected globally:** `index.css` includes a `prefers-reduced-motion: reduce` media query that forces animation-duration and transition-duration to `0.01ms !important` on all elements.
- **Layout breakpoints are token-driven, not ad-hoc:** Width constraints go through `--layout-main-max`, `--layout-main-narrow`, `--layout-main-wide`, and `--layout-sidebar-width`; the only hard breakpoint in tokens is `1024px` for padding adjustment.
- **Route-level code splitting targets < 500 kB initial bundle.** `App.tsx` documents this goal and implements it via `React.lazy` + `Suspense` for every page.
- **No Tailwind config file exists.** All configuration is done via the `@theme inline` directive in `index.css` and the CSS custom property layer.