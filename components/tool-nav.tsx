"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { CATEGORIES } from "@/lib/tools/categories";
import { getCategoryTree } from "@/lib/tools/registry";
import { toolShortTitle } from "@/lib/tools/types";
import { Wordmark } from "@/components/logo";
import { cn } from "@/lib/utils";
import { readNavMode, setNavMode, subscribeNavMode, type NavMode } from "@/lib/nav-state";

const CLOSED_KEY = "bench:nav-closed";

function readClosed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** The whole tree — category → group → tool — with each category folding; the category you are in stays open. */
function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const [closed, setClosed] = useState<string[]>([]);
  const current = pathname.split("/")[1] ?? "";

  useEffect(() => {
    const remembered = readClosed();
    if (remembered.length) queueMicrotask(() => setClosed(remembered));
  }, []);

  const toggle = (slug: string) => {
    setClosed((c) => {
      const next = c.includes(slug) ? c.filter((x) => x !== slug) : [...c, slug];
      try {
        localStorage.setItem(CLOSED_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  };

  return (
    <nav aria-label="All tools" className="px-2 py-3">
      {CATEGORIES.map((cat) => {
        const tree = getCategoryTree(cat.slug);
        if (!tree.length) return null;
        const Icon = cat.icon;
        const count = tree.reduce((n, g) => n + g.tools.length, 0);
        const here = current === cat.slug;
        const catActive = pathname === `/${cat.slug}`;
        const open = here || !closed.includes(cat.slug);
        const grouped = tree.length > 1;
        return (
          <div key={cat.slug} className="mb-1" data-nav-category={cat.slug} data-open={open ? "true" : "false"} data-cat={cat.slug} style={{ "--cat": `var(${cat.accentVar})` } as CSSProperties}>
            <div className={cn("flex items-center rounded-[var(--radius-sm)]", catActive ? "bg-raised" : "hover:bg-raised")}>
              <button
                type="button"
                onClick={() => toggle(cat.slug)}
                disabled={here}
                aria-expanded={open}
                aria-label={`${open ? "Collapse" : "Expand"} ${cat.name}`}
                title={here ? undefined : open ? "Collapse" : "Expand"}
                className="flex h-8 w-6 shrink-0 items-center justify-center text-faint hover:text-ink disabled:hover:text-faint"
              >
                <ChevronRight size={12} className={cn("transition-transform duration-150", open && "rotate-90")} />
              </button>
              <Link
                href={`/${cat.slug}`}
                onClick={onNavigate}
                aria-current={catActive ? "page" : undefined}
                className={cn("flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-[12px] font-semibold", catActive ? "text-ink" : "text-muted hover:text-ink")}
              >
                <Icon size={13} style={{ color: `var(${cat.accentVar})` }} />
                <span className="cat-name truncate">{cat.name}</span>
                <span className="ml-auto pl-2 text-[11px] font-normal tabular text-faint">{count}</span>
              </Link>
            </div>
            {open && (
              <div className="mb-2 ml-[11px] border-l border-edge pl-1.5">
                {tree.map(({ group, tools }) => (
                  <div key={group.id} data-nav-group={group.id}>
                    {grouped && (
                      <Link
                        href={`/${cat.slug}#${group.id}`}
                        onClick={onNavigate}
                        className="readout block truncate px-2 pb-0.5 pt-2 text-[10px] text-faint hover:text-muted"
                      >
                        {group.name}
                      </Link>
                    )}
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
                                "block truncate rounded-[var(--radius-sm)] py-[5px] pl-2 pr-2 text-[13px]",
                                active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-raised hover:text-ink",
                              )}
                            >
                              {toolShortTitle(t)}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/** Icon-only rail shown while the sidebar is collapsed: one link per category. */
function NavRail({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Tool categories" className="flex flex-col items-center gap-1 px-1.5 py-2">
      {CATEGORIES.map((cat) => {
        if (!getCategoryTree(cat.slug).length) return null;
        const Icon = cat.icon;
        const active = pathname === `/${cat.slug}` || pathname.startsWith(`/${cat.slug}/`);
        return (
          <Link
            key={cat.slug}
            href={`/${cat.slug}`}
            title={cat.name}
            aria-label={cat.name}
            aria-current={pathname === `/${cat.slug}` ? "page" : undefined}
            className={cn("flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)]", active ? "bg-accent-soft" : "hover:bg-raised")}
            data-cat={cat.slug}
            style={{ "--cat": `var(${cat.accentVar})` } as CSSProperties}
          >
            <Icon size={17} style={{ color: `var(${cat.accentVar})` }} />
          </Link>
        );
      })}
    </nav>
  );
}

/** Desktop sidebar: the full tree, collapsible to an icon rail or hidden for focus (remembered per browser). */
export function ToolNav({ className }: { className?: string }) {
  const pathname = usePathname();
  const [mode, setMode] = useState<NavMode>("open");

  useEffect(() => {
    const remembered = readNavMode();
    if (remembered !== "open") queueMicrotask(() => setMode(remembered));
    return subscribeNavMode(setMode);
  }, []);

  const change = (next: NavMode) => {
    setMode(next);
    setNavMode(next);
  };
  const collapsed = mode === "rail";
  const iconBtn = "flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-faint hover:bg-raised hover:text-ink";

  return (
    <aside
      className={cn(
        "tool-nav sticky top-12 h-[calc(100vh-3rem)] shrink-0 overflow-y-auto overflow-x-hidden border-r border-edge bg-base transition-[width] duration-200",
        collapsed ? "w-12" : "w-60",
        mode === "hidden" && "hidden",
        className,
      )}
      data-nav-mode={mode}
    >
      <div className={cn("flex h-9 items-center border-b border-edge", collapsed ? "flex-col justify-center gap-0.5 py-1 h-auto" : "justify-end gap-0.5 px-2")}>
        <button type="button" onClick={() => change(collapsed ? "open" : "rail")} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar to icons"} aria-expanded={!collapsed} title={collapsed ? "Expand sidebar" : "Collapse sidebar to icons"} className={iconBtn} data-nav-collapse>
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
        <button type="button" onClick={() => change("hidden")} aria-label="Hide the sidebar" title="Hide the sidebar (the button at the top left brings it back)" className={iconBtn} data-nav-hide>
          <X size={15} />
        </button>
      </div>
      {collapsed ? <NavRail pathname={pathname} /> : <NavList pathname={pathname} />}
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
