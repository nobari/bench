"use client";

import { Search } from "lucide-react";
import { useCommandPalette } from "@/components/command-palette";
import { TOOLS } from "@/lib/tools/registry";

/** The search field on index pages — opens the ⌘K palette. */
export function CommandTrigger() {
  const { setOpen } = useCommandPalette();

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex h-11 w-full items-center gap-3 rounded-[var(--radius)] border border-edge bg-surface px-3.5 text-left text-[15px] text-faint transition-colors hover:border-edge-bright"
    >
      <Search size={17} className="text-muted" />
      <span className="flex-1">Search {TOOLS.length} tools</span>
      <kbd className="rounded border border-edge bg-base px-1.5 py-0.5 font-mono text-[11px] text-muted">
        ⌘K
      </kbd>
    </button>
  );
}
