import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

/** Explicit UI themes (must match `html[data-theme="…"]` in `src/ui/theme/tokens-theme-*.css`). */
export const UI_THEME_CHOICES = ["light", "dark"] as const;
export type UiTheme = (typeof UI_THEME_CHOICES)[number];

export type ThemePreference = UiTheme | "system";
export type EffectiveTheme = UiTheme;

export const THEME_PREFERENCE_STORAGE_KEY = "squadrules:ui:theme-preference";
export const THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

const FALLBACK_THEME_PREFERENCE: ThemePreference = "system";

export function isThemePreference(value: string | null): value is ThemePreference {
  if (value === null) {
    return false;
  }
  if (value === "system") {
    return true;
  }
  return (UI_THEME_CHOICES as readonly string[]).includes(value);
}

export function resolveEffectiveTheme(preference: ThemePreference, prefersDark: boolean): EffectiveTheme {
  if (preference === "system") {
    /* When matching the OS, use the default dark variant (v1). */
    return prefersDark ? "dark" : "light";
  }
  return preference;
}

export function readStoredThemePreference(): ThemePreference {
  if (typeof window === "undefined") {
    return FALLBACK_THEME_PREFERENCE;
  }
  try {
    const stored = window.localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY);
    return isThemePreference(stored) ? stored : FALLBACK_THEME_PREFERENCE;
  } catch {
    return FALLBACK_THEME_PREFERENCE;
  }
}

export function getSystemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(THEME_MEDIA_QUERY).matches;
}

export function applyThemeToDocument(theme: EffectiveTheme) {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme === "light" ? "light" : "dark";
}

export interface ThemePreferenceState {
  preference: ThemePreference;
  effectiveTheme: EffectiveTheme;
  setPreference: (preference: ThemePreference) => void;
}

export function useThemePreference(): ThemePreferenceState {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readStoredThemePreference());
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => getSystemPrefersDark());

  const effectiveTheme = useMemo(
    () => resolveEffectiveTheme(preference, systemPrefersDark),
    [preference, systemPrefersDark]
  );

  useEffect(() => {
    applyThemeToDocument(effectiveTheme);
  }, [effectiveTheme]);

  useEffect(() => {
    if (typeof window === "undefined" || preference !== "system" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQueryList = window.matchMedia(THEME_MEDIA_QUERY);
    setSystemPrefersDark(mediaQueryList.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };

    if (typeof mediaQueryList.addEventListener === "function") {
      mediaQueryList.addEventListener("change", handleChange);
      return () => mediaQueryList.removeEventListener("change", handleChange);
    }

    mediaQueryList.addListener(handleChange);
    return () => mediaQueryList.removeListener(handleChange);
  }, [preference]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_PREFERENCE_STORAGE_KEY) {
        return;
      }
      setPreferenceState(isThemePreference(event.newValue) ? event.newValue : FALLBACK_THEME_PREFERENCE);
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const setPreference = useCallback((nextPreference: ThemePreference) => {
    setPreferenceState(nextPreference);
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, nextPreference);
    } catch {
      // localStorage may be blocked; keep in-memory preference only.
    }
  }, []);

  return {
    preference,
    effectiveTheme,
    setPreference,
  };
}

const ThemePreferenceContext = createContext<ThemePreferenceState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const value = useThemePreference();
  return <ThemePreferenceContext.Provider value={value}>{children}</ThemePreferenceContext.Provider>;
}

export function useThemePreferenceContext(): ThemePreferenceState {
  const context = useContext(ThemePreferenceContext);
  if (!context) {
    throw new Error("useThemePreferenceContext must be used within ThemeProvider");
  }
  return context;
}
