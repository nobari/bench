import { useEffect } from "react";

/**
 * Soft state for share links. A widget's real data lives in the query string or the hash already; the way it is being
 * looked at — a view mode, an open outline — is registered here and written into the link as one `s` hash parameter
 * when a share link is made. A reader applies only what it still understands, so a link keeps working when a state
 * changes or disappears later; the theme is never part of it.
 */
const PARAM = "s";
const states = new Map<string, unknown>();

function encode(value: unknown): string {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode(text: string): unknown {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function setShareState(key: string, value: object | null) {
  if (value && Object.keys(value).length) states.set(key, value);
  else states.delete(key);
}

/** Register this widget's soft state (pass null for none); it is written into the link when one is shared. */
export function useShareState(key: string, value: object | null) {
  const json = value ? JSON.stringify(value) : null;
  useEffect(() => {
    setShareState(key, json ? (JSON.parse(json) as object) : null);
    return () => setShareState(key, null);
  }, [key, json]);
}

/** Put every registered soft state into the page's hash as `s`, keeping the other hash parameters. */
export function writeShareStateToUrl() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  if (states.size) hash.set(PARAM, encode(Object.fromEntries(states)));
  else hash.delete(PARAM);
  const h = hash.toString();
  // A null state lets the app router see the new URL; handing back its own state object bypasses that, and the router
  // then restores its stale URL on the next render, dropping the parameter again.
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${h ? `#${h}` : ""}`);
}

/** The soft state a link carries for this widget, or null; anything unreadable is simply absent. */
export function readShareState<T extends object>(key: string): Partial<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const raw = hash.get(PARAM);
    if (!raw) return null;
    const all = decode(raw);
    const v = all && typeof all === "object" ? (all as Record<string, unknown>)[key] : null;
    return v && typeof v === "object" ? (v as Partial<T>) : null;
  } catch {
    return null;
  }
}
