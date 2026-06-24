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
import { ArrowUpRight, CornerDownLeft, Lightbulb, Search } from "lucide-react";
import { CATEGORIES } from "@/lib/tools/categories";
import { TOOLS } from "@/lib/tools/registry";

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

export function CommandPaletteProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggle();
      }
      if (
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !isTyping(e.target)
      ) {
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

function CommandMenu({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const router = useRouter();

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
      className="pointer-events-auto mt-[12vh] w-[min(92vw,620px)]"
      overlayClassName="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
      contentClassName="fixed inset-0 z-50 flex items-start justify-center p-4"
    >
      <div className="panel registered overflow-hidden shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]">
        <div className="flex items-center gap-3 border-b border-edge px-4">
          <Search size={16} className="text-faint" />
          <Command.Input
            autoFocus
            placeholder="Search 9 tools — try “base64”, “gif”, “json”…"
            className="h-14 flex-1 bg-transparent font-mono text-sm text-ink outline-none placeholder:text-faint"
          />
          <kbd className="readout rounded border border-edge px-1.5 py-0.5">
            ESC
          </kbd>
        </div>

        <Command.List className="max-h-[52vh] overflow-y-auto overscroll-contain p-2">
          <Command.Empty className="px-3 py-8 text-center font-mono text-sm text-faint">
            No tools match. Try another term.
          </Command.Empty>

          {CATEGORIES.map((cat) => {
            const tools = TOOLS.filter((t) => t.category === cat.slug);
            if (!tools.length) return null;
            return (
              <Command.Group
                key={cat.slug}
                heading={cat.name}
                className="[&_[cmdk-group-heading]]:readout [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2"
              >
                {tools.map((t) => {
                  const Icon = t.icon;
                  return (
                    <Command.Item
                      key={`${t.category}/${t.slug}`}
                      value={`${t.title} ${t.keywords.join(" ")} ${(t.aliases ?? []).join(" ")}`}
                      onSelect={() => go(`/${t.category}/${t.slug}`)}
                      style={{ ["--accent" as string]: `var(${cat.accentVar})` }}
                      className="group flex cursor-pointer items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 text-sm text-muted data-[selected=true]:bg-raised data-[selected=true]:text-ink"
                    >
                      <Icon
                        size={16}
                        className="text-faint group-data-[selected=true]:text-accent"
                      />
                      <span className="flex-1 font-medium">{t.title}</span>
                      <span className="hidden truncate font-mono text-xs text-faint sm:block">
                        {t.tagline}
                      </span>
                      <CornerDownLeft
                        size={13}
                        className="opacity-0 group-data-[selected=true]:opacity-100 text-accent"
                      />
                    </Command.Item>
                  );
                })}
              </Command.Group>
            );
          })}

          <Command.Group
            heading="Actions"
            className="[&_[cmdk-group-heading]]:readout [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2"
          >
            <Command.Item
              value="suggest a new tool request feature"
              onSelect={() => go("/suggest")}
              className="group flex cursor-pointer items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 text-sm text-muted data-[selected=true]:bg-raised data-[selected=true]:text-ink"
            >
              <Lightbulb size={16} className="text-faint group-data-[selected=true]:text-signal" />
              <span className="flex-1 font-medium">Suggest a tool</span>
              <ArrowUpRight size={13} className="text-faint" />
            </Command.Item>
          </Command.Group>
        </Command.List>
      </div>
    </Command.Dialog>
  );
}
