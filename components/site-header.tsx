"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useCommandPalette } from "@/components/command-palette";
import { MobileToolNav } from "@/components/tool-nav";
import { GithubMark } from "@/components/icons";
import { Wordmark } from "@/components/logo";
import { SITE } from "@/lib/site";

export function SiteHeader() {
  const { setOpen } = useCommandPalette();

  return (
    <header className="sticky top-0 z-30 h-12 border-b border-edge bg-base/90 backdrop-blur">
      <div className="mx-auto flex h-full max-w-[1440px] items-center gap-2 px-3 sm:px-4">
        <MobileToolNav />
        <Link href="/" className="shrink-0 rounded-[var(--radius-sm)]" aria-label="Bench home">
          <Wordmark />
        </Link>

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ml-3 hidden h-8 w-full max-w-md items-center gap-2 rounded-[var(--radius-sm)] border border-edge bg-surface px-2.5 text-left text-[13px] text-faint transition-colors hover:border-edge-bright sm:flex"
        >
          <Search size={14} />
          <span className="flex-1">Search tools</span>
          <kbd className="rounded border border-edge bg-base px-1.5 py-0.5 font-mono text-[11px] text-muted">
            ⌘K
          </kbd>
        </button>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Search tools"
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-muted hover:bg-raised hover:text-ink sm:hidden"
          >
            <Search size={17} />
          </button>
          <Link
            href="/suggest"
            className="hidden h-8 items-center rounded-[var(--radius-sm)] px-2.5 text-[13px] text-muted hover:bg-raised hover:text-ink sm:flex"
          >
            Suggest a tool
          </Link>
          <a
            href={SITE.links.github}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub repository"
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-muted hover:bg-raised hover:text-ink"
          >
            <GithubMark className="h-[17px] w-[17px]" />
          </a>
        </div>
      </div>
    </header>
  );
}
