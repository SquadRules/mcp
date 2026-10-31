Entry point `main.tsx` bootstraps React 18 via `createRoot`, wrapping the app in `QueryClientProvider` (TanStack Query), `ThemeProvider` (from `hooks/useThemePreference`), and i18n. `App.tsx` declares all routes under `/ui` using `react-router-dom` with lazy-loaded page components for code-splitting; every route is wrapped in `<Suspense>` with a shared fallback.

Internal layering:
- `pages/` — route-level containers (HomePage, ProtocolEditPage, RunGuidedPage, RunsPage, SkillBundlePage, etc.), each composed of reusable components.
- `components/` — presentational pieces (Layout, ChallengeCard, RichTextEditor, StepFlowGraph, SurfaceCard, ErrorAlert, CopyButton, RenderedMarkdown) plus a `run/` subfolder for guided-run orchestration (`RunGuidedContent`, `SolutionForm`, `runContractChallenge`).
- `hooks/` — domain state hooks built on TanStack Query (`useProtocol`, `useReward`, `useRunSession`, `useSpaces`, `useAuth`, `useActivate`, `useForwardStart`, `useForwardStep`, `useProtocol`) and UI concerns (`useThemePreference`).
- `lib/api.ts` — thin `apiFetch` wrapper around `fetch` with `credentials: 'same-origin'` and JSON content-type; all server calls go through it.
- `i18n/` — i18next bootstrap loading `en.json` as the only resource bundle.
- `theme/tokens*.css` — CSS custom properties for light/dark themes consumed by Tailwind classes throughout.
- `utils/` — cross-cutting helpers (confidence scoring, rich-text editor extensions, browse adapters).

Dependency direction is one-way: pages → components/hooks → lib/i18n/theme; no component imports another page. The protocol editor round-trips markdown ↔ form state via pure functions in `hooks/useProtocol.ts` (`parseProtocolMarkdown`, `parseProtocolMarkdownToForm`, `buildMarkdownFromForm`) that serialize step contracts as fenced ```json blocks.