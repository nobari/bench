/**
 * The desktop sidebar's mode — the full tree, an icon rail, or hidden for focus — remembered per browser and applied
 * before first paint by the inline script in app/layout.tsx (it sets data-nav on <html>, which globals.css reads).
 */
export type NavMode = "open" | "rail" | "hidden";

export const NAV_MODE_KEY = "bench:nav";
/** The older key, "1" when the sidebar was collapsed to the rail. */
export const NAV_LEGACY_KEY = "bench:nav-collapsed";
const EVENT = "bench:nav";

export function readNavMode(): NavMode {
  try {
    const v = localStorage.getItem(NAV_MODE_KEY);
    if (v === "open" || v === "rail" || v === "hidden") return v;
    if (localStorage.getItem(NAV_LEGACY_KEY) === "1") return "rail";
  } catch {
    /* storage unavailable */
  }
  return "open";
}

/** Apply a mode to the document (for CSS) and remember it; every listener hears about it. */
export function setNavMode(mode: NavMode) {
  try {
    localStorage.setItem(NAV_MODE_KEY, mode);
    localStorage.removeItem(NAV_LEGACY_KEY);
  } catch {
    /* storage unavailable */
  }
  applyNavMode(mode);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: mode }));
}

export function applyNavMode(mode: NavMode) {
  if (mode === "open") delete document.documentElement.dataset.nav;
  else document.documentElement.dataset.nav = mode === "rail" ? "collapsed" : "hidden";
}

export function subscribeNavMode(listener: (mode: NavMode) => void): () => void {
  const on = (e: Event) => listener((e as CustomEvent<NavMode>).detail);
  window.addEventListener(EVENT, on);
  return () => window.removeEventListener(EVENT, on);
}
