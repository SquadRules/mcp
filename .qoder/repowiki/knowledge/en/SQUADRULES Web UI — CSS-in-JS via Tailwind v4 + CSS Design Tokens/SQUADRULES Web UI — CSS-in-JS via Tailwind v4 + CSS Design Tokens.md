---
kind: frontend_style
name: SQUADRULES Web UI — CSS-in-JS via Tailwind v4 + CSS Design Tokens
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
    - src/ui/components/Layout.tsx
    - src/ui/App.tsx
---

## Approach

The SQUADRULES web UI (`src/ui/`) is a React/Vite single-page application styled with **Tailwind CSS v4** (imported via `@import "tailwindcss"` in `src/ui/index.css`) layered on top of a **CSS custom-properties design-token system**. There is no SCSS, Sass, PostCSS plugin chain, or external component library; styling is composed from Tailwind utility classes that reference semantic CSS variables defined under `src/ui/theme/`.

## Key files

- `src/ui/index.css` — root stylesheet: imports tokens, then `@import "tailwindcss"`, then maps every token into Tailwind's `@theme inline` block so components use `text-[var(--color-primary)]`, `bg-[var(--color-surface)]`, etc.
- `src/ui/theme/tokens.css` — aggregator that `@import`s shared tokens and both theme variants; comments declare it as the source of truth for colors, spacing, typography, radius.
- `src/ui/theme/tokens-shared.css` — theme-agnostic structural tokens (`--space-*`, `--font-size-*`, `--radius-*`, layout max widths, `--layout-sidebar-width`, `--layout-touch-target`).
- `src/ui/theme/tokens-theme-light.css` — light palette on `:root`.
- `src/ui/theme/tokens-theme-dark.css` — dark palette scoped to `html[data-theme="dark"]`.
- `src/ui/hooks/useThemePreference.tsx` — React context hook that persists `squadrules:ui:theme-preference` in `localStorage`, resolves `light | dark | system`, applies `data-theme` and `colorScheme` to `document.documentElement`, and listens for `prefers-color-scheme` changes.
- `src/ui/components/Layout.tsx` — shell using sidebar width, touch target, and padding tokens throughout.
- `src/ui/App.tsx` — route tree with lazy-loaded pages (comment states each page is code-split to keep initial chunk under 500 kB).

## Architecture and conventions

1. **Single source of truth**: All visual values live as CSS custom properties. The comment in `tokens.css` says "Source of truth for colors, spacing, typography, radius." New themes are added by creating `tokens-theme-*.css` and importing it from `tokens.css`.
2. **Tailwind bridge**: `index.css` uses Tailwind v4's `@theme inline` directive to re-export every CSS variable as a Tailwind theme value (`--color-primary`, `--spacing-4`, `--font-size-base`, badge-specific tokens like `--badge-shell-bg`, status tokens like `--status-success-bg`). Components never hard-code hex values; they read through Tailwind's mapped names.
3. **Theming model**: Two built-in themes (`light`, `dark`) plus a `system` preference. The effective theme is computed in `useThemePreference.tsx` and applied by setting `html[data-theme]`. Dark theme selectors are explicitly scoped to `html[data-theme="dark"]` in `tokens-theme-dark.css`; light theme defaults to `:root`.
4. **Accessibility-first baseline**: `index.css` defines `.skip-link`, `.sr-only`, a global `:focus-visible` rule (2px outline, 2px offset, contrast ≥ 3:1 per the comment), and a `prefers-reduced-motion` media query that collapses all animations/transitions to 0.01ms.
5. **Responsive strategy**: No breakpoint utilities are used directly in components. Instead, `tokens-shared.css` exposes layout tokens (`--layout-main-max`, `--layout-main-narrow`, `--layout-main-wide`, `--layout-sidebar-width`, `--layout-main-padding-x/y`) and one `@media (min-width: 1024px)` block that adjusts `--layout-main-padding-x`. Components compose these tokens (e.g. `Layout.tsx` picks narrow vs wide based on route path).
6. **Component composition style**: JSX uses Tailwind utility classes referencing CSS variables via arbitrary-value syntax (`text-[var(--color-text)]`, `border-[var(--color-border)]`, `bg-[var(--color-surface-elevated)]`). No BEM, no CSS modules, no styled-components.
7. **Widget/UI resources outside the SPA**: Server-side MCP Apps widgets (`src/mcp-apps/`) ship separate HTML/CSS/JS bundles for activate, forward, and spaces tools (files named `*-widget-html.ts`, `*-widget-inline-css.ts`, `*-widget-inline-script.ts`); these are distinct from the main SPA and served as sandboxed iframe resources.
8. **i18n integration**: Text content goes through `react-i18next` (`useTranslation()`) with locale files under `src/ui/i18n/en.json`; this is presentation-layer localization, not theming.

## Conventions and constraints

- **Add a new color or spacing value only as a CSS variable** in `tokens-shared.css` (structural) or a `tokens-theme-*.css` file (semantic color), then expose it via `@theme inline` in `index.css`. This is enforced by the comment in `tokens.css` declaring the theme directory as the source of truth and by the fact that components reference values exclusively through Tailwind-mapped variables.
- **New themes must be added by creating a `tokens-theme-*.css` file and importing it from `tokens.css`**, as documented in the header comment of `tokens.css`.
- **Theme choices are constrained to `light | dark | system`**: `UI_THEME_CHOICES = ["light", "dark"]` in `useThemePreference.tsx` and `isThemePreference()` rejects any other string, so invalid preferences fall back to `system`.
- **Dark mode is toggled via `html[data-theme="dark"]`**: Both the hook (`applyThemeToDocument`) and the dark theme stylesheet scope rely on this attribute; adding a third theme would require updating both sides.
- **Touch targets are uniform**: `--layout-touch-target: 44px` is referenced by nav links and logo area in `Layout.tsx`, ensuring minimum interactive sizing across the app.
- **Reduced motion is respected globally**: The `prefers-reduced-motion` rule in `index.css` applies to `*`, `*::before`, `*::after` with `!important`, overriding any animation/transition set elsewhere.
- **Route-level code splitting is mandatory for pages**: `App.tsx` lazy-loads every page module and wraps each in `<Suspense fallback={<RouteFallback />} />`; the comment states the goal is keeping the initial chunk under 500 kB.