/**
 * The colour theme — light, wood (a warm walnut mid-tone) or dark — remembered per browser and applied before
 * first paint by the inline script in app/layout.tsx (it sets data-theme on <html>, which globals.css reads).
 * With no choice stored the site follows the system's light/dark preference.
 */
export type Theme = "light" | "wood" | "dark";
export const THEMES: { id: Theme; name: string; hint: string }[] = [
  { id: "light", name: "Light", hint: "Light gray" },
  { id: "wood", name: "Wood", hint: "Warm walnut, between light and dark" },
  { id: "dark", name: "Dark", hint: "Dark gray" },
];
export const THEME_KEY = "bench:theme";
/** The browser-chrome colour (the base token) per theme, for the theme-color meta. */
const BAR: Record<Theme, string> = { light: "#fafafa", wood: "#4a3827", dark: "#141416" };
const EVENT = "bench:theme";

export const isTheme = (v: unknown): v is Theme => v === "light" || v === "wood" || v === "dark";

/** The stored choice, or null when the site follows the system. */
export function readStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return isTheme(v) ? v : null;
  } catch {
    return null;
  }
}

/** What is showing now: the stored choice, else the system preference. */
export function currentTheme(): Theme {
  return readStoredTheme() ?? (typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

export function applyTheme(theme: Theme | null) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const bar = BAR[theme ?? currentTheme()];
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) m.content = bar;
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage unavailable */
  }
  applyTheme(theme);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: theme }));
}

export function subscribeTheme(listener: (theme: Theme) => void): () => void {
  const on = (e: Event) => listener((e as CustomEvent<Theme>).detail);
  window.addEventListener(EVENT, on);
  return () => window.removeEventListener(EVENT, on);
}
