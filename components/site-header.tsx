"use client";

import Link from "next/link";
import { Search, Lightbulb } from "lucide-react";
import { useCommandPalette } from "@/components/command-palette";
import { GithubMark } from "@/components/icons";
import { SITE } from "@/lib/site";

export function SiteHeader() {
  const { setOpen } = useCommandPalette();

  return (
    <header className="sticky top-0 z-30 border-b border-edge bg-base/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="group flex shrink-0 items-baseline gap-1.5">
          <span className="font-display text-lg font-extrabold tracking-tight text-ink">
            {SITE.wordmark}
          </span>
          <span
            aria-hidden
            className="h-3.5 w-[3px] translate-y-[1px] bg-signal transition-opacity group-hover:opacity-60"
          />
        </Link>

        <button
          onClick={() => setOpen(true)}
          className="group ml-1 hidden h-9 flex-1 items-center gap-2.5 rounded-[var(--radius-sm)] border border-edge bg-surface px-3 text-left transition-colors hover:border-edge-bright sm:flex sm:max-w-md"
        >
          <Search size={14} className="text-faint" />
          <span className="flex-1 font-mono text-xs text-faint">
            Search tools…
          </span>
          <kbd className="readout rounded border border-edge px-1.5 py-0.5 group-hover:border-edge-bright">
            ⌘K
          </kbd>
        </button>

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setOpen(true)}
            aria-label="Search tools"
            className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-muted hover:bg-raised hover:text-ink sm:hidden"
          >
            <Search size={17} />
          </button>
          <Link
            href="/suggest"
            className="hidden h-9 items-center gap-1.5 rounded-[var(--radius-sm)] px-3 font-mono text-xs text-muted hover:bg-raised hover:text-ink sm:flex"
          >
            <Lightbulb size={14} />
            Suggest
          </Link>
          <a
            href={SITE.links.github}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub repository"
            className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-muted hover:bg-raised hover:text-ink"
          >
            <GithubMark className="h-[18px] w-[18px]" />
          </a>
        </div>
      </div>
    </header>
  );
}
