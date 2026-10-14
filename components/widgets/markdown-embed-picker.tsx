"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardPaste, Search, X } from "lucide-react";
import { CATEGORIES } from "@/lib/tools/categories";
import { TOOLS } from "@/lib/tools/registry";
import { toolShortTitle, type ToolDef } from "@/lib/tools/types";
import { BENCH_HOST, embedTarget } from "@/lib/tools/text/markdown";
import { cn } from "@/lib/utils";

/** The fenced block that frames a tool, ready to insert. */
export function embedBlock(url: string, title: string): string {
  return "```embed\n" + url + "\n" + (title ? `title: ${title}\n` : "") + "```";
}

/**
 * Pick a tool to frame in the document. Picking inserts the block with the tool's page; to frame a tool in a
 * particular state, the author opens it, presses Share link and pastes that link into the block — or lets the
 * picker take the link from the clipboard.
 */
export function EmbedPicker({ onPick, onClose }: { onPick: (block: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [clipNote, setClipNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const q = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      CATEGORIES.map((cat) => ({
        cat,
        tools: TOOLS.filter((t) => t.category === cat.slug && t.slug !== "markdown" && (!q || `${t.title} ${t.tagline} ${t.aliases?.join(" ") ?? ""}`.toLowerCase().includes(q))),
      })).filter((g) => g.tools.length),
    [q],
  );
  const pick = (t: ToolDef) => onPick(embedBlock(`https://${BENCH_HOST}/${t.category}/${t.slug}`, t.title));
  const fromClipboard = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      const target = embedTarget(text, { hosts: [window.location.host], tool: (path) => { const [, c, s] = path.split("/"); const t = TOOLS.find((x) => x.category === c && x.slug === s); return t ? { title: t.title } : null; } });
      if (!target) return setClipNote(text ? "The clipboard does not hold a Bench tool link." : "The clipboard is empty.");
      onPick(embedBlock(text, target.toolTitle));
    } catch {
      setClipNote("The browser did not allow reading the clipboard; paste the link into the block instead.");
    }
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-scrim p-4 pt-[10vh]" onClick={onClose} role="presentation">
      <div className="panel flex max-h-[80vh] w-full max-w-xl flex-col" role="dialog" aria-label="Embed a tool" onClick={(e) => e.stopPropagation()} data-embed-picker>
        <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
          <Search size={14} className="shrink-0 text-faint" />
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a tool to embed…" className="h-8 min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-faint" aria-label="Find a tool" />
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-faint hover:bg-raised hover:text-ink">
            <X size={14} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-edge bg-base-2 px-3 py-2 text-[12px] text-muted">
          <span className="min-w-0 flex-1">To frame a tool in a particular state, open it, press Share link, and paste that link into the block — or take it from the clipboard now.</span>
          <button type="button" onClick={() => void fromClipboard()} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-edge px-2 text-[12px] text-muted hover:border-accent hover:text-accent" data-embed-clipboard>
            <ClipboardPaste size={12} /> Use the clipboard link
          </button>
          {clipNote && <span className="w-full text-warn">{clipNote}</span>}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {groups.length === 0 && <p className="px-2 py-3 text-[13px] text-faint">No tool matches.</p>}
          {groups.map(({ cat, tools }) => (
            <div key={cat.slug} className="mb-2">
              <div className="readout px-2 pb-1 pt-1.5 text-[10.5px]">{cat.name}</div>
              <ul>
                {tools.map((t) => {
                  const Icon = t.icon;
                  return (
                    <li key={t.slug}>
                      <button type="button" onClick={() => pick(t)} className={cn("flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left hover:bg-raised")} data-embed-tool={`${t.category}/${t.slug}`}>
                        <span className="cat-tile flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] border border-edge bg-surface" style={{ color: `var(${cat.accentVar})` }}>
                          <Icon size={13} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-ink">{toolShortTitle(t)}</span>
                          <span className="block truncate text-[12px] text-muted">{t.tagline}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
