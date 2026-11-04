"use client";

import { useSyncExternalStore } from "react";

const KEY = "bench:personal-tools:v1";
const EVENT = "bench:personal-tools";
const EMPTY = '{"favorites":[],"recent":[]}';
export type PersonalTools = { favorites: string[]; recent: string[] };
function snapshot() {
  try {
    return localStorage.getItem(KEY) ?? EMPTY;
  } catch {
    return EMPTY;
  }
}
function subscribe(fn: () => void) {
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}
function parse(raw: string): PersonalTools {
  try {
    const data = JSON.parse(raw);
    const paths = (v: unknown) =>
      Array.isArray(v)
        ? [
            ...new Set(
              v.filter(
                (x): x is string =>
                  typeof x === "string" && /^\/[a-z-]+\/[a-z0-9-]+$/.test(x),
              ),
            ),
          ].slice(0, 100)
        : [];
    return {
      favorites: paths(data.favorites),
      recent: paths(data.recent).slice(0, 8),
    };
  } catch {
    return { favorites: [], recent: [] };
  }
}
export function usePersonalTools() {
  return parse(useSyncExternalStore(subscribe, snapshot, () => EMPTY));
}
function update(fn: (data: PersonalTools) => PersonalTools): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(fn(parse(snapshot()))));
    window.dispatchEvent(new Event(EVENT));
    return true;
  } catch {
    return false;
  }
}
export const toggleFavorite = (path: string) =>
  update((s) => ({
    ...s,
    favorites: s.favorites.includes(path)
      ? s.favorites.filter((p) => p !== path)
      : [...s.favorites, path],
  }));
export const rememberTool = (path: string) =>
  update((s) => ({
    ...s,
    recent: [path, ...s.recent.filter((p) => p !== path)].slice(0, 8),
  }));
export const clearRecentTools = () => update((s) => ({ ...s, recent: [] }));
