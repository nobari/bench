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

/*
 * Colour is a second, independent switch on top of the theme: off, the site is its neutral graphite self; on,
 * actions, links, status and category hues take real colour (data-color="on" on <html>, read by globals.css).
 * It is remembered per browser, and a share link carries it softly (see lib/share-state.ts: `ui.color`), so a
 * reader sees the page the way it was shared without their own choice being overwritten.
 */
export const COLOR_KEY = "bench:color";
const COLOR_EVENT = "bench:color";

/** The stored choice, or null when none was made. */
export function readStoredColor(): boolean | null {
  try {
    const v = localStorage.getItem(COLOR_KEY);
    return v === "on" ? true : v === "off" ? false : null;
  } catch {
    return null;
  }
}

/** Whether colour is showing now (the attribute the pre-paint script or a link set, else the stored choice). */
export function currentColor(): boolean {
  if (typeof document !== "undefined" && document.documentElement.dataset.color !== undefined) return document.documentElement.dataset.color === "on";
  return readStoredColor() ?? false;
}

export function applyColor(on: boolean) {
  if (on) document.documentElement.dataset.color = "on";
  else delete document.documentElement.dataset.color;
}

export function setColor(on: boolean) {
  try {
    localStorage.setItem(COLOR_KEY, on ? "on" : "off");
  } catch {
    /* storage unavailable */
  }
  applyColor(on);
  window.dispatchEvent(new CustomEvent(COLOR_EVENT, { detail: on }));
}

export function subscribeColor(listener: (on: boolean) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<boolean>).detail);
  window.addEventListener(COLOR_EVENT, handler);
  return () => window.removeEventListener(COLOR_EVENT, handler);
}
