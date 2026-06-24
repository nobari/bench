"use client";

import { Search } from "lucide-react";
import { useCommandPalette } from "@/components/command-palette";

export function CommandTrigger() {
  const { setOpen } = useCommandPalette();

  return (
    <button
      onClick={() => setOpen(true)}
      className="group flex h-12 w-full max-w-md items-center gap-3 rounded-[var(--radius)] border border-edge bg-surface px-4 text-left transition-colors hover:border-signal"
    >
      <Search size={17} className="text-faint transition-colors group-hover:text-signal" />
      <span className="flex-1 font-mono text-sm text-muted">
        Search every tool…
      </span>
      <kbd className="readout rounded border border-edge px-2 py-1 group-hover:border-edge-bright">
        ⌘K
      </kbd>
    </button>
  );
}
