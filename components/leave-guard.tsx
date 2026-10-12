"use client";

import { useEffect } from "react";
import { confirmLeave, subscribeUnsavedWork, unsavedWork } from "@/lib/unsaved-work";

/** Marker on the history entry this guard pushes so a back press lands on the same page first. */
const GUARD = "benchLeaveGuard";

type NavigateEventLike = Event & { navigationType: string; destination: { url: string } };

/**
 * Asks before work in progress is lost: on close or reload (the browser's own dialog), on an in-app
 * link, and on the browser's back and forward buttons. Back and forward use the Navigation API where
 * it exists (Chrome, Edge) and otherwise a spare history entry that absorbs the first back press.
 */
export function LeaveGuard() {
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!unsavedWork()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    const samePage = (href: string) => {
      const url = new URL(href, location.href);
      return url.pathname === location.pathname && url.search === location.search;
    };

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || samePage(a.href)) return;
      if (!confirmLeave()) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    document.addEventListener("click", onClick, true);

    let cleanupHistory: () => void;
    const nav = (window as unknown as { navigation?: EventTarget }).navigation;
    if (nav) {
      const onNavigate = (e: Event) => {
        const ev = e as NavigateEventLike;
        if (ev.navigationType !== "traverse" || !ev.cancelable || samePage(ev.destination.url)) return;
        if (!confirmLeave()) ev.preventDefault();
      };
      nav.addEventListener("navigate", onNavigate);
      cleanupHistory = () => nav.removeEventListener("navigate", onNavigate);
    } else {
      cleanupHistory = historyTrap();
    }

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
      cleanupHistory();
    };
  }, []);
  return null;
}

/**
 * Without the Navigation API a traversal cannot be cancelled, so while work is in progress a spare
 * entry for the same URL sits on top of the stack: the first back press only pops it, the question
 * is asked, and on "stay" the entry is pushed again at the page's latest URL.
 */
function historyTrap(): () => void {
  let armed = false;
  let ignorePop = false;
  let leaving = false;
  let latestHref = location.href;

  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  history.pushState = (data, unused, url) => {
    if (url != null) latestHref = new URL(String(url), location.href).href;
    return push(data, unused, url);
  };
  history.replaceState = (data, unused, url) => {
    if (url != null) latestHref = new URL(String(url), location.href).href;
    return replace(data, unused, url);
  };

  const onGuardEntry = () => (history.state as { [GUARD]?: boolean } | null)?.[GUARD] === true;
  const arm = () => {
    if (armed) return;
    armed = true;
    if (!onGuardEntry()) history.pushState({ [GUARD]: true }, "", location.href);
  };
  const disarm = () => {
    if (!armed) return;
    armed = false;
    if (onGuardEntry()) {
      ignorePop = true;
      history.back();
    }
  };
  const sync = () => (unsavedWork() ? arm() : disarm());
  const unsubscribe = subscribeUnsavedWork(sync);
  sync();

  const onPopState = () => {
    if (ignorePop) {
      ignorePop = false;
      return;
    }
    if (leaving || !unsavedWork()) {
      armed = false;
      return;
    }
    if (confirmLeave()) {
      leaving = true;
      armed = false;
      setTimeout(() => (leaving = false), 2000);
      history.back();
    } else {
      history.pushState({ [GUARD]: true }, "", latestHref);
    }
  };
  window.addEventListener("popstate", onPopState);

  return () => {
    unsubscribe();
    window.removeEventListener("popstate", onPopState);
    history.pushState = push;
    history.replaceState = replace;
  };
}
