"use client";

import { useEffect } from "react";

/**
 * While `active`, keep a long job safe from the browser: a held Web Lock tells Chrome the page is busy so a hidden
 * or minimised tab is not frozen, and a screen wake lock (while the page is visible, re-taken when it returns) keeps
 * the display from sleeping under a multi-hour export. Timers in a hidden tab are still throttled, but the export
 * loop is promise-driven and never waits on them.
 */
export function useKeepAwake(active: boolean, name = "bench-job") {
  useEffect(() => {
    if (!active) return;
    let release: (() => void) | null = null;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      void navigator.locks?.request(name, { mode: "shared" }, () => held).catch(() => undefined);
    } catch {
      /* no Web Locks */
    }
    let wake: WakeLockSentinel | null = null;
    let gone = false;
    const acquire = async () => {
      try {
        if (gone || document.visibilityState !== "visible" || !("wakeLock" in navigator)) return;
        wake = await navigator.wakeLock.request("screen");
        wake.addEventListener("release", () => {
          wake = null;
        });
      } catch {
        /* denied or unsupported: nothing to do */
      }
    };
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible" && !wake) void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", onVisible);
      release?.();
      void wake?.release().catch(() => undefined);
    };
  }, [active, name]);
}
