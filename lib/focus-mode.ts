"use client";

/**
 * Focus mode: the tool alone, the site's chrome (header, sidebar, footer, the page's title block and the copy under
 * the tool) hidden, the widget filling the viewport. The state is one attribute on <html> (globals.css hides the
 * chrome by it), remembered per tool in this browser, and a `?focus=1` link turns it on.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let on = false;

const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const get = () => on;
const getServer = () => false;

const keyFor = (path: string) => `bench:focus:${path}`;

/** Switch focus mode and remember the choice for this tool. */
export function setFocusMode(next: boolean, path?: string) {
  if (on === next) return;
  on = next;
  if (typeof document !== "undefined") {
    if (next) document.documentElement.dataset.focus = "on";
    else delete document.documentElement.dataset.focus;
  }
  if (path) {
    try {
      if (next) localStorage.setItem(keyFor(path), "on");
      else localStorage.removeItem(keyFor(path));
    } catch {
      /* no storage */
    }
  }
  emit();
}
export const focusMode = () => on;

/** Whether focus mode is on, plus a toggle bound to the current tool path. */
export function useFocusMode(path?: string): { focus: boolean; setFocus: (next: boolean) => void; toggle: () => void } {
  const focus = useSyncExternalStore(subscribe, get, getServer);
  const setFocus = useCallback((next: boolean) => setFocusMode(next, path), [path]);
  const toggle = useCallback(() => setFocusMode(!on, path), [path]);
  return { focus, setFocus, toggle };
}

/**
 * Mounted once on a tool page: restores the remembered choice (or a `?focus=1` link), and leaves focus mode on
 * Escape or when the page changes.
 */
export function useFocusModePage(path: string) {
  useEffect(() => {
    let remembered = false;
    try {
      remembered = localStorage.getItem(keyFor(path)) === "on";
    } catch {
      /* no storage */
    }
    const linked = /(?:^|[?&])focus=1(?:&|$)/.test(window.location.search);
    if (remembered || linked || document.documentElement.dataset.focus === "on") setFocusMode(true, linked ? path : undefined);
    const inField = (e: KeyboardEvent) => e.target instanceof Element && !!e.target.closest("input, textarea, select, [contenteditable=true]");
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape" && on) setFocusMode(false, path);
      else if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey && !e.altKey && !inField(e)) {
        e.preventDefault();
        setFocusMode(!on, path);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      setFocusMode(false);
    };
  }, [path]);
}
