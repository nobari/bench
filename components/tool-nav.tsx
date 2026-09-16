"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { CATEGORIES } from "@/lib/tools/categories";
import { TOOLS } from "@/lib/tools/registry";
import { toolShortTitle } from "@/lib/tools/types";
import { Wordmark } from "@/components/logo";
import { cn } from "@/lib/utils";

/** Every category and every tool — the index that stays in view on desktop. */
function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="All tools" className="px-2 py-3">
      {CATEGORIES.map((cat) => {
        const tools = TOOLS.filter((t) => t.category === cat.slug);
        if (!tools.length) return null;
        const Icon = cat.icon;
        const catActive = pathname === `/${cat.slug}`;
        return (
          <div key={cat.slug} className="mb-3">
            <Link
              href={`/${cat.slug}`}
              onClick={onNavigate}
              aria-current={catActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-[12px] font-semibold",
                catActive ? "bg-raised text-ink" : "text-muted hover:text-ink",
              )}
            >
              <Icon size={13} style={{ color: `var(${cat.accentVar})` }} />
              <span className="truncate">{cat.name}</span>
            </Link>
            <ul>
              {tools.map((t) => {
                const href = `/${t.category}/${t.slug}`;
                const active = pathname === href;
                return (
                  <li key={t.slug}>
                    <Link
                      href={href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "block truncate rounded-[var(--radius-sm)] py-[5px] pl-7 pr-2 text-[13px]",
                        active
                          ? "bg-accent-soft font-medium text-accent"
                          : "text-muted hover:bg-raised hover:text-ink",
                      )}
                    >
                      {toolShortTitle(t)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

/** Desktop sidebar. */
export function ToolNav({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <aside
      className={cn(
        "sticky top-12 h-[calc(100vh-3rem)] w-60 shrink-0 overflow-y-auto border-r border-edge bg-base",
        className,
      )}
    >
      <NavList pathname={pathname} />
    </aside>
  );
}

/** Menu button + slide-in drawer for narrow screens. */
export function MobileToolNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="All tools"
        aria-expanded={open}
        className="mr-1 flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-muted hover:bg-raised hover:text-ink lg:hidden"
      >
        <Menu size={18} />
      </button>

      {/* Portalled: the header's backdrop-filter would otherwise confine a fixed drawer to its own box. */}
      {open &&
        createPortal(
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="All tools">
            <div className="absolute inset-0 bg-scrim" onClick={() => setOpen(false)} />
            <div className="absolute inset-y-0 left-0 flex w-[min(85vw,300px)] flex-col border-r border-edge bg-base shadow-dialog">
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-edge px-3">
                <Wordmark />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-muted hover:bg-raised hover:text-ink"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <NavList pathname={pathname} onNavigate={() => setOpen(false)} />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
