// squadrules-compat-surface: falls back to the existing on-disk config-dir path segment "kairos"
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router";
import { Layout } from "./components/Layout";

/** Route-level code-splitting: each page is loaded on demand to keep initial chunk under 500 kB. */
const HomePage = lazy(() => import("./pages/HomePage").then((m) => ({ default: m.HomePage })));
const KairosPage = lazy(() => import("./pages/KairosPage").then((m) => ({ default: m.KairosPage })));
const RunsPage = lazy(() => import("./pages/RunsPage").then((m) => ({ default: m.RunsPage })));
const ProtocolEditPage = lazy(() =>
  import("./pages/ProtocolEditPage").then((m) => ({ default: m.ProtocolEditPage }))
);
const RunGuidedPage = lazy(() =>
  import("./pages/RunGuidedPage").then((m) => ({ default: m.RunGuidedPage }))
);
const SkillBundlePage = lazy(() =>
  import("./pages/SkillBundlePage").then((m) => ({ default: m.SkillBundlePage }))
);
const ProtocolDetailPage = lazy(() =>
  import("./pages/ProtocolDetailPage").then((m) => ({ default: m.ProtocolDetailPage }))
);
const AccountPage = lazy(() =>
  import("./pages/AccountPage").then((m) => ({ default: m.AccountPage }))
);
const NotFoundPage = lazy(() =>
  import("./pages/NotFoundPage").then((m) => ({ default: m.NotFoundPage }))
);

function RouteFallback() {
  return (
    <div className="flex min-h-[12rem] items-center justify-center text-[var(--color-text-muted)]" aria-busy="true">
      Loading…
    </div>
  );
}

/** Route tree; use with any Router (BrowserRouter in app, MemoryRouter in tests). */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route
          index
          element={
            <Suspense fallback={<RouteFallback />}>
              <HomePage />
            </Suspense>
          }
        />
        <Route
          path="kairos"
          element={
            <Suspense fallback={<RouteFallback />}>
              <KairosPage />
            </Suspense>
          }
        />
        <Route
          path="runs"
          element={
            <Suspense fallback={<RouteFallback />}>
              <RunsPage />
            </Suspense>
          }
        />
        <Route
          path="protocols/new"
          element={
            <Suspense fallback={<RouteFallback />}>
              <ProtocolEditPage />
            </Suspense>
          }
        />
        <Route
          path="protocols/:uri/edit"
          element={
            <Suspense fallback={<RouteFallback />}>
              <ProtocolEditPage />
            </Suspense>
          }
        />
        <Route
          path="protocols/:uri/run"
          element={
            <Suspense fallback={<RouteFallback />}>
              <RunGuidedPage />
            </Suspense>
          }
        />
        <Route
          path="protocols/:uri/skill"
          element={
            <Suspense fallback={<RouteFallback />}>
              <SkillBundlePage />
            </Suspense>
          }
        />
        <Route
          path="protocols/:uri"
          element={
            <Suspense fallback={<RouteFallback />}>
              <ProtocolDetailPage />
            </Suspense>
          }
        />
        <Route
          path="account"
          element={
            <Suspense fallback={<RouteFallback />}>
              <AccountPage />
            </Suspense>
          }
        />
        <Route
          path="*"
          element={
            <Suspense fallback={<RouteFallback />}>
              <NotFoundPage />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter basename="/ui">
      <AppRoutes />
    </BrowserRouter>
  );
}
