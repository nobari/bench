"use client";

/**
 * The Focus button on a tool page, and the slim bar that stays while the chrome is hidden: the tool's name and the
 * way out. Mounted by the tool shell; the state lives in lib/focus-mode.
 */

import { usePathname } from "next/navigation";
import { Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFocusMode, useFocusModePage } from "@/lib/focus-mode";

export function FocusToggle({ className }: { className?: string }) {
  const path = usePathname();
  const { focus, toggle } = useFocusMode(path);
  useFocusModePage(path);
  return (
    <button type="button" onClick={toggle} aria-pressed={focus} className={cn("inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-3 text-[13px] text-muted transition-colors hover:border-accent hover:text-accent", className)} title={focus ? "Show the site again (Esc)" : "Hide everything but the tool (F)"} data-focus-toggle>
      {focus ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      {focus ? "Exit focus" : "Focus"}
    </button>
  );
}

/** Shown only in focus mode (globals.css): the tool's name and the exit, floating over the top-right corner. */
export function FocusBar({ title }: { title: string }) {
  const path = usePathname();
  const { setFocus } = useFocusMode(path);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-40 hidden items-center justify-between gap-3 px-3 py-1.5 text-[12px] text-muted" data-focus-bar>
      <span className="pointer-events-auto rounded-[var(--radius-sm)] bg-base/80 px-2 py-0.5 backdrop-blur" data-focus-title>
        {title}
      </span>
      <button type="button" onClick={() => setFocus(false)} className="pointer-events-auto inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-edge bg-base/80 px-2 py-0.5 backdrop-blur hover:text-ink" data-focus-exit>
        <Minimize2 size={12} /> Exit focus <kbd className="rounded border border-edge px-1 font-mono text-[10px]">esc</kbd>
      </button>
    </div>
  );
}
