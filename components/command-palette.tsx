"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Lightbulb, Search } from "lucide-react";
import { CATEGORIES, getCategory } from "@/lib/tools/categories";
import { TOOLS } from "@/lib/tools/registry";
import { searchTools } from "@/lib/tools/search";
import { toolShortTitle, type ToolDef } from "@/lib/tools/types";

interface Ctx {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
}

const PaletteContext = createContext<Ctx | null>(null);

export function useCommandPalette() {
  const ctx = useContext(PaletteContext);
  if (!ctx) throw new Error("useCommandPalette must be used within provider");
  return ctx;
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggle();
      }
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !isTyping(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return (
    <PaletteContext.Provider value={{ open, setOpen, toggle }}>
      {children}
      <CommandMenu open={open} setOpen={setOpen} />
    </PaletteContext.Provider>
  );
}

function isTyping(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

const ITEM =
  "flex cursor-pointer items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-[13.5px] text-muted data-[selected=true]:bg-raised data-[selected=true]:text-ink";
const GROUP =
  "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-faint";

function ToolItem({ t, onSelect, showCategory }: { t: ToolDef; onSelect: () => void; showCategory?: boolean }) {
  const cat = getCategory(t.category);
  const Icon = t.icon;
  return (
    <Command.Item value={`${t.category}/${t.slug}`} onSelect={() => onSelect()} className={ITEM}>
      <Icon size={15} style={{ color: cat ? `var(${cat.accentVar})` : undefined }} className="shrink-0" />
      <span className="shrink-0 font-medium">{toolShortTitle(t)}</span>
      <span className="hidden min-w-0 truncate text-[12.5px] text-faint sm:block">{t.tagline}</span>
      {showCategory && cat && <span className="ml-auto shrink-0 pl-3 text-[11.5px] text-faint">{cat.name}</span>}
    </Command.Item>
  );
}

function CommandMenu({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  // A fresh search each time the palette opens; the state lives on while closed, so clear it then.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setQuery("");
  }
  // Ranking is ours (see lib/tools/search.ts): best match first, not grouped by category.
  const results = query.trim() ? searchTools(TOOLS, query, 40) : null;

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router, setOpen],
  );

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Search tools"
      shouldFilter={false}
      className="pointer-events-auto mt-[10vh] w-[min(92vw,600px)]"
      overlayClassName="fixed inset-0 z-50 bg-scrim"
      contentClassName="fixed inset-0 z-50 flex items-start justify-center p-4"
    >
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-edge bg-surface shadow-dialog">
        <div className="flex items-center gap-3 border-b border-edge px-4">
          <Search size={16} className="text-muted" />
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Search tools — base64, json, gif, hash…"
            className="h-12 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint"
          />
          <kbd className="rounded border border-edge bg-base px-1.5 py-0.5 font-mono text-[11px] text-muted">
            esc
          </kbd>
        </div>

        <Command.List className="max-h-[56vh] overflow-y-auto overscroll-contain p-2">
          {results && results.length === 0 && (
            <div className="px-3 py-8 text-center text-[13px] text-muted">No tool matches that. Try another word, or suggest it below.</div>
          )}

          {results ? (
            <Command.Group heading={`${results.length} match${results.length === 1 ? "" : "es"}`} className={GROUP}>
              {results.map(({ tool: t }) => (
                <ToolItem key={`${t.category}/${t.slug}`} t={t} onSelect={() => go(`/${t.category}/${t.slug}`)} showCategory />
              ))}
            </Command.Group>
          ) : (
            CATEGORIES.map((cat) => {
              const tools = TOOLS.filter((t) => t.category === cat.slug);
              if (!tools.length) return null;
              return (
                <Command.Group key={cat.slug} heading={cat.name} className={GROUP}>
                  {tools.map((t) => (
                    <ToolItem key={`${t.category}/${t.slug}`} t={t} onSelect={() => go(`/${t.category}/${t.slug}`)} />
                  ))}
                </Command.Group>
              );
            })
          )}

          <Command.Group heading="More" className={GROUP}>
            <Command.Item
              value="suggest a new tool request feature"
              onSelect={() => go("/suggest")}
              className={ITEM}
            >
              <Lightbulb size={15} className="shrink-0 text-muted" />
              <span className="font-medium">Suggest a tool</span>
            </Command.Item>
          </Command.Group>
        </Command.List>
      </div>
    </Command.Dialog>
  );
}
