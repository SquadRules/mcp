---
kind: frontend_style
name: 'SquadRules UI: CSS Design Tokens + Tailwind v4 Theme System'
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
---

## What system/approach is used

The SquadRules web frontend (`src/ui/`) uses a **CSS custom properties design-token layer** composed with **Tailwind CSS v4** (via `@import "tailwindcss"` and the `@theme inline` directive). There is no SCSS, Sass, PostCSS plugin chain, or component library — styling is done in plain CSS tokens plus utility-first Tailwind classes applied directly in JSX.

Key stack:
- React SPA built with Vite (`main.tsx`, `index.html`).
- Tailwind CSS v4 imported via `@import "tailwindcss"` in `src/ui/index.css`.
- A hand-authored token layer under `src/ui/theme/` that defines spacing, typography, radii, layout constraints, semantic colors, badge/status palettes, and two themes (light/dark).
- A React `ThemeProvider` / `useThemePreference` hook that toggles `html[data-theme="light|dark"]` and persists the user choice in `localStorage` under the key `squadrules:ui:theme-preference`.
- i18n via `react-i18next` (English only at present) — not part of the style system but consumed by styled components.

## Key files and packages

- `src/ui/index.css` — single entry point; imports tokens, then Tailwind, then maps every token into Tailwind's `@theme inline` namespace so components use `text-[var(--color-text)]`, `bg-[var(--color-surface)]`, etc.
- `src/ui/theme/tokens.css` — aggregator that `@import`s shared tokens and both theme variants; header documents the source-of-truth contract and points to `docs/design/ui-design-system.md`.
- `src/ui/theme/tokens-shared.css` — theme-agnostic structural tokens: `--space-*`, `--font-*`, `--radius-*`, `--layout-*` (max widths, sidebar width, touch target), global `html/body` defaults, and a `:focus-visible` rule.
- `src/ui/theme/tokens-theme-light.css` — light theme semantic color variables on `:root` (primary, surface, text, badges, status).
- `src/ui/theme/tokens-theme-dark.css` — dark theme overrides scoped to `html[data-theme="dark"]`.
- `src/ui/hooks/useThemePreference.tsx` — typed theme state (`UI_THEME_CHOICES = ["light", "dark"]`), `resolveEffectiveTheme`, persistence to `localStorage`, `prefers-color-scheme` media query listener, and `ThemeProvider` context.
- `src/ui/components/Layout.tsx` — representative component showing the convention of referencing tokens via Tailwind arbitrary values (`text-[var(--color-text)]`, `border-l-[3px] border-transparent`, `min-h-[var(--layout-touch-target)]`) and using `--layout-*` tokens for responsive max-widths.

## Architecture and conventions

1. **Single source of truth for visual values**: All colors, spacing, typography, radii, and layout constants live as CSS custom properties in `src/ui/theme/`. Components never hard-code hex values or pixel sizes — they reference them through Tailwind's mapped `@theme` variables.
2. **Token → Tailwind mapping**: `src/ui/index.css` declares an `@theme inline { ... }` block that re-declares each token variable as a Tailwind design token (e.g. `--color-primary: var(--color-primary)`). This lets components write `text-[var(--color-text)]` while keeping one place to edit the actual value.
3. **Theme switching via `html[data-theme]`**: The dark theme is a complete override set scoped to `html[data-theme="dark"]`; the light theme is the default on `:root`. Switching happens by setting the attribute from `applyThemeToDocument()` in the theme hook.
4. **System preference support**: When the user selects `system`, the hook listens to `matchMedia("(prefers-color-scheme: dark)")` and computes the effective theme accordingly.
5. **Responsive strategy**: No breakpoints are defined in CSS. Layout responsiveness is expressed via CSS `min()` functions combining viewport width with `--layout-main-max`, `--layout-main-narrow`, and `--layout-main-wide` tokens (see `Layout.tsx`'s `mainMaxWidth` calculation). A `@media (min-width: 1024px)` rule adjusts padding in `tokens-shared.css`.
6. **Accessibility baseline**: Global `:focus-visible` rule (2px outline, 2px offset, ≥3:1 contrast per comment), `.skip-link` utility, `.sr-only` utility, and `prefers-reduced-motion` suppression of all animations/transitions are declared once in `index.css`.
7. **Badge/status palette**: A large family of `--badge-*` and `--status-*` semantic tokens (shell, mcp, user-input, comment, match, refine, create, personal, group, app, other) provides consistent coloring for adapter-type badges rendered across the UI.
8. **No Tailwind config file**: Tailwind v4 is configured implicitly via the `@theme inline` block in `index.css`; there is no `tailwind.config.*` file in the repo.
9. **Component-level styling**: Components compose Tailwind utilities with arbitrary-value references to CSS variables (e.g. `border-l-[var(--color-primary)]`, `hover:bg-[var(--color-surface)]`). There are no per-component CSS modules or CSS-in-JS libraries.

## Conventions and constraints

- **Design tokens are the single source of truth** for colors, spacing, typography, radius, and layout dimensions — documented in the header of `tokens.css` which states this file is the "Source of truth for colors, spacing, typography, radius" and points to `docs/design/ui-design-system.md`.
- **New themes require two steps**: add a new `tokens-theme-*.css` file and import it from `tokens.css` (the header explicitly instructs this pattern).
- **Theme choices are type-enforced**: `UI_THEME_CHOICES = ["light", "dark"] as const` in `useThemePreference.tsx` constrains valid values; `isThemePreference` validates stored strings against this union.
- **Dark theme scope**: Dark overrides must be scoped to `html[data-theme="dark"]` (as stated in the dark theme file header); the hook enforces this by setting `document.documentElement.setAttribute("data-theme", theme)`.
- **Token names follow a prefix convention**: `--space-*`, `--font-*`, `--radius-*`, `--layout-*`, `--color-*`, `--badge-*`, `--status-*` — observed consistently across `tokens-shared.css`, `tokens-theme-light.css`, and `tokens-theme-dark.css`.
- **Components reference tokens via Tailwind arbitrary values** rather than class names (e.g. `text-[var(--color-text)]`, `bg-[var(--color-surface)]`, `border-l-[3px] border-transparent`, `min-h-[var(--layout-touch-target)]`) — observed throughout `Layout.tsx` and other components.
- **Touch target accessibility**: `--layout-touch-target: 44px` is used as the minimum interactive element size (commented as such in `tokens-shared.css`); navigation links enforce `min-h-[var(--layout-touch-target)]`.
- **Reduced motion is respected globally**: `index.css` suppresses all `animation-*` and `transition-*` properties when `prefers-reduced-motion: reduce` is active.
- **Skip link and screen-reader utilities are centralized**: `.skip-link` and `.sr-only` are defined once in `index.css` and reused by pages/components.