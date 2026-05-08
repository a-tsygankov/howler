// Tiny theme module: persists the user's pick in localStorage and
// applies the `dark` class to <html> so the Tailwind dark-mode
// utilities + the .dark token overrides in styles.css take effect.
//
// Three values: "light", "dark", or "system" (track the OS-level
// `prefers-color-scheme` query). Default = "system" so a fresh
// install matches the user's environment.

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "howler.theme";
const MEDIA_QUERY = "(prefers-color-scheme: dark)";

export const readTheme = (): Theme => {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
};

export const writeTheme = (t: Theme): void => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, t);
  applyTheme(t);
};

export const applyTheme = (t: Theme): void => {
  if (typeof document === "undefined") return;
  const isDark =
    t === "dark" ||
    (t === "system" && window.matchMedia(MEDIA_QUERY).matches);
  document.documentElement.classList.toggle("dark", isDark);
};

/// Subscribe to system changes when in "system" mode so the page
/// flips when the user changes the OS theme. Returns an unsubscribe.
export const watchSystemTheme = (cb: () => void): (() => void) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const m = window.matchMedia(MEDIA_QUERY);
  const handler = () => cb();
  m.addEventListener("change", handler);
  return () => m.removeEventListener("change", handler);
};

/// Apply on first script load — runs before React mounts so the
/// initial paint is correct (no flash of light theme on dark users).
export const initThemeOnce = (): void => {
  applyTheme(readTheme());
};
