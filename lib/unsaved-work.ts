/**
 * Work in progress that a navigation would throw away: a running export, files loaded into a tool,
 * tags edited but not saved. Widgets declare it with useUnsavedWork(message); the LeaveGuard in the
 * root layout asks before the page is closed, reloaded, navigated with a link, or traversed with the
 * browser's back and forward buttons. Any tool can also call confirmLeave() before a programmatic
 * navigation of its own.
 */
import { useEffect, useRef } from "react";

const work = new Map<number, string>();
const listeners = new Set<() => void>();
let nextKey = 1;

/** The first message describing unsaved work, or null when there is none. */
export function unsavedWork(): string | null {
  for (const m of work.values()) return m;
  return null;
}

export function subscribeUnsavedWork(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function set(key: number, message: string | null) {
  const before = unsavedWork();
  if (message) work.set(key, message);
  else work.delete(key);
  if (unsavedWork() !== before) for (const l of listeners) l();
}

/** Declare (or clear, with a falsy value) this widget's work in progress. The message says what would be lost. */
export function useUnsavedWork(message: string | null | false | undefined): void {
  const key = useRef(0);
  useEffect(() => {
    if (!key.current) key.current = nextKey++;
    const k = key.current;
    set(k, message || null);
    return () => set(k, null);
  }, [message]);
}

/** True when leaving is fine: nothing is in progress, or the user agreed to lose it. */
export function confirmLeave(): boolean {
  const m = unsavedWork();
  if (!m) return true;
  return window.confirm(`${m}\n\nLeave this page anyway?`);
}
