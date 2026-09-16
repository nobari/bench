"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQueryState, parseAsStringLiteral } from "nuqs";
import DOMPurify from "dompurify";
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import {
  Bold,
  Code,
  Columns2,
  Download,
  Eye,
  Heading1,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  Minus,
  PenLine,
  Printer,
  Quote,
  Strikethrough,
  Table,
  X,
} from "lucide-react";
import {
  SAMPLE,
  documentTitle,
  indentLines,
  insertBlock,
  markdownStats,
  prefixLines,
  renderMarkdown,
  toStandaloneHtml,
  wrapSelection,
  type Edit,
} from "@/lib/tools/text/markdown";
import { CopyButton } from "@/components/copy-button";
import { SHARE_SYNC_EVENT } from "@/components/share-button";
import { cn } from "@/lib/utils";

const VIEWS = ["edit", "split", "preview"] as const;
const DRAFT_KEY = "bench:markdown:draft";

if (typeof window !== "undefined") {
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.getAttribute("target") === "_blank") node.setAttribute("rel", "noopener noreferrer");
  });
}
const sanitize = (html: string) => DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });

/** Document source: compressed hash (Share) → `i` query → local draft → sample. */
function readInitial(): { text: string; source: "link" | "draft" | "sample" } {
  if (typeof window === "undefined") return { text: SAMPLE, source: "sample" };
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const h = hash.get("d");
  if (h) {
    try {
      const v = decompressFromEncodedURIComponent(h);
      if (v) return { text: v, source: "link" };
    } catch {
      /* ignore */
    }
  }
  const q = new URLSearchParams(window.location.search).get("i");
  if (q !== null) return { text: q, source: "link" };
  try {
    const draft = localStorage.getItem(DRAFT_KEY);
    if (draft) return { text: draft, source: "draft" };
  } catch {
    /* storage unavailable */
  }
  return { text: SAMPLE, source: "sample" };
}

const TOOL =
  "flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-muted transition-colors hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-40";
const GHOST =
  "inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-edge px-2 text-[12px] text-muted transition-colors hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40";

export function MarkdownEditorWidget() {
  const [view, setView] = useQueryState("v", parseAsStringLiteral(VIEWS).withDefault("split").withOptions({ history: "replace" }));
  const [initial] = useState(readInitial);
  const [text, setText] = useState(initial.text);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [outline, setOutline] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const syncing = useRef(false);
  const urlsRef = useRef<string[]>([]);

  const deferred = useDeferredValue(text);
  const rendered = useMemo(() => renderMarkdown(deferred, sanitize), [deferred]);
  const stats = useMemo(() => markdownStats(deferred), [deferred]);

  // Autosave the draft locally (debounced).
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        if (text.trim()) localStorage.setItem(DRAFT_KEY, text);
        else localStorage.removeItem(DRAFT_KEY);
        setSavedAt(Date.now());
      } catch {
        /* storage unavailable */
      }
    }, 500);
    return () => clearTimeout(id);
  }, [text]);

  useEffect(() => {
    const sync = () => {
      const h = new URLSearchParams();
      if (text.trim()) h.set("d", compressToEncodedURIComponent(text));
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${h}`);
    };
    window.addEventListener(SHARE_SYNC_EVENT, sync);
    return () => window.removeEventListener(SHARE_SYNC_EVENT, sync);
  }, [text]);

  useEffect(() => {
    const urls = urlsRef.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const apply = (fn: (t: string, s: number, e: number) => Edit) => {
    const ta = taRef.current;
    const s = ta?.selectionStart ?? text.length;
    const e = ta?.selectionEnd ?? text.length;
    const edit = fn(text, s, e);
    setText(edit.text);
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(edit.start, edit.end);
    });
  };

  const actions = {
    bold: () => apply((t, s, e) => wrapSelection(t, s, e, "**", "**", "bold")),
    italic: () => apply((t, s, e) => wrapSelection(t, s, e, "*", "*", "italic")),
    strike: () => apply((t, s, e) => wrapSelection(t, s, e, "~~", "~~", "text")),
    h1: () => apply((t, s, e) => prefixLines(t, s, e, "# ")),
    h2: () => apply((t, s, e) => prefixLines(t, s, e, "## ")),
    quote: () => apply((t, s, e) => prefixLines(t, s, e, "> ")),
    ul: () => apply((t, s, e) => prefixLines(t, s, e, "- ")),
    ol: () => apply((t, s, e) => prefixLines(t, s, e, "", true)),
    task: () => apply((t, s, e) => prefixLines(t, s, e, "- [ ] ")),
    link: () => apply((t, s, e) => wrapSelection(t, s, e, "[", "](https://)", "link text")),
    image: () => apply((t, s, e) => insertBlock(t, s, e, "![alt text](https://)")),
    code: () =>
      apply((t, s, e) => (t.slice(s, e).includes("\n") || s === e ? insertBlock(t, s, e, "```\n" + (t.slice(s, e) || "code") + "\n```") : wrapSelection(t, s, e, "`", "`", "code"))),
    table: () => apply((t, s, e) => insertBlock(t, s, e, "| Column | Column |\n| --- | --- |\n| cell | cell |")),
    hr: () => apply((t, s, e) => insertBlock(t, s, e, "---")),
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "b") return e.preventDefault(), actions.bold();
      if (k === "i") return e.preventDefault(), actions.italic();
      if (k === "k") return e.preventDefault(), actions.link();
    }
    if (e.key === "Tab") {
      e.preventDefault();
      apply((t, s, en) => indentLines(t, s, en, e.shiftKey));
    }
  };

  const onEditorScroll = () => {
    const ta = taRef.current, pv = previewRef.current;
    if (!ta || !pv || syncing.current) return;
    syncing.current = true;
    const ratio = ta.scrollTop / Math.max(1, ta.scrollHeight - ta.clientHeight);
    pv.scrollTop = ratio * (pv.scrollHeight - pv.clientHeight);
    requestAnimationFrame(() => (syncing.current = false));
  };
  const onPreviewScroll = () => {
    const ta = taRef.current, pv = previewRef.current;
    if (!ta || !pv || syncing.current) return;
    syncing.current = true;
    const ratio = pv.scrollTop / Math.max(1, pv.scrollHeight - pv.clientHeight);
    ta.scrollTop = ratio * (ta.scrollHeight - ta.clientHeight);
    requestAnimationFrame(() => (syncing.current = false));
  };

  const title = documentTitle(text);
  const fileBase = title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "document";
  const download = (name: string, content: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    urlsRef.current.push(url);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  };
  const print = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(toStandaloneHtml(title, rendered.html));
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };
  const jumpTo = (id: string) => {
    const el = previewRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    el?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const showEditor = view !== "preview";
  const showPreview = view !== "edit";

  return (
    <div className="space-y-3">
      {/* control bar */}
      <div className="panel flex flex-wrap items-center gap-2 p-2">
        <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
          {(
            [
              ["edit", "Edit", PenLine],
              ["split", "Split", Columns2],
              ["preview", "Preview", Eye],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-[3px] px-2.5 text-[12.5px] transition-colors",
                view === id ? "bg-accent font-medium text-on-accent" : "text-muted hover:text-ink",
              )}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>

        {showEditor && (
          <div className="flex flex-wrap items-center gap-0.5">
            <button onClick={actions.bold} title="Bold (⌘B)" className={TOOL}><Bold size={15} /></button>
            <button onClick={actions.italic} title="Italic (⌘I)" className={TOOL}><Italic size={15} /></button>
            <button onClick={actions.strike} title="Strikethrough" className={TOOL}><Strikethrough size={15} /></button>
            <span className="mx-1 h-5 w-px bg-edge" />
            <button onClick={actions.h1} title="Heading 1" className={TOOL}><Heading1 size={16} /></button>
            <button onClick={actions.h2} title="Heading 2" className={TOOL}><Heading2 size={16} /></button>
            <button onClick={actions.quote} title="Quote" className={TOOL}><Quote size={15} /></button>
            <span className="mx-1 h-5 w-px bg-edge" />
            <button onClick={actions.ul} title="Bullet list" className={TOOL}><List size={16} /></button>
            <button onClick={actions.ol} title="Numbered list" className={TOOL}><ListOrdered size={16} /></button>
            <button onClick={actions.task} title="Task list" className={TOOL}><ListChecks size={16} /></button>
            <span className="mx-1 h-5 w-px bg-edge" />
            <button onClick={actions.link} title="Link (⌘K)" className={TOOL}><Link2 size={15} /></button>
            <button onClick={actions.image} title="Image" className={TOOL}><ImageIcon size={15} /></button>
            <button onClick={actions.code} title="Code (inline for a selection on one line, block otherwise)" className={TOOL}><Code size={15} /></button>
            <button onClick={actions.table} title="Table" className={TOOL}><Table size={15} /></button>
            <button onClick={actions.hr} title="Horizontal rule" className={TOOL}><Minus size={15} /></button>
          </div>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <CopyButton value={text} label="Copy Markdown" />
          <CopyButton value={rendered.html} label="Copy HTML" />
          <button onClick={() => download(`${fileBase}.md`, text, "text/markdown")} className={GHOST} title="Download as .md">
            <Download size={13} /> .md
          </button>
          <button onClick={() => download(`${fileBase}.html`, toStandaloneHtml(title, rendered.html), "text/html")} className={GHOST} title="Download as a standalone .html">
            <Download size={13} /> .html
          </button>
          <button onClick={print} className={GHOST} title="Print, or save as PDF from the print dialog">
            <Printer size={13} /> Print / PDF
          </button>
        </div>
      </div>

      <div className={cn("grid gap-3", view === "split" && "lg:grid-cols-2")}>
        {showEditor && (
          <div className="panel flex min-w-0 flex-col">
            <div className="flex items-center justify-between border-b border-edge px-3 py-2">
              <span className="readout">Markdown</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setText(SAMPLE)} className="text-[12px] text-faint hover:text-ink">
                  Load sample
                </button>
                {text && (
                  <button onClick={() => setText("")} className="inline-flex items-center gap-1 text-[12px] text-faint hover:text-danger">
                    <X size={12} /> Clear
                  </button>
                )}
              </div>
            </div>
            <textarea
              ref={taRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              onScroll={onEditorScroll}
              spellCheck
              placeholder="# Start writing…"
              className="h-[560px] w-full resize-y bg-transparent p-3 font-mono text-[13px] leading-relaxed text-ink outline-none placeholder:text-faint"
            />
            <div className="flex items-center gap-4 border-t border-edge px-3 py-1.5 readout tabular">
              <span>{stats.words.toLocaleString()} words</span>
              <span>{stats.chars.toLocaleString()} ch</span>
              <span>{stats.lines} ln</span>
              <span>~{stats.minutes} min read</span>
              <span className="ml-auto">{savedAt ? "Draft saved in this browser" : initial.source === "draft" ? "Draft restored" : ""}</span>
            </div>
          </div>
        )}

        {showPreview && (
          <div className="panel flex min-w-0 flex-col">
            <div className="flex items-center justify-between border-b border-edge px-3 py-2">
              <span className="readout">Preview</span>
              {rendered.headings.length > 0 && (
                <button onClick={() => setOutline((o) => !o)} className={cn(GHOST, outline && "border-accent text-accent")}>
                  <ListTree size={13} /> Outline
                </button>
              )}
            </div>
            {outline && rendered.headings.length > 0 && (
              <nav aria-label="Outline" className="border-b border-edge bg-base-2 px-3 py-2">
                <ul className="space-y-0.5">
                  {rendered.headings.map((h, i) => (
                    <li key={`${h.id}-${i}`} style={{ paddingLeft: (h.depth - 1) * 12 }}>
                      <button onClick={() => jumpTo(h.id)} className="text-left text-[12.5px] text-muted hover:text-accent">
                        {h.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
            <div ref={previewRef} onScroll={onPreviewScroll} className="h-[560px] overflow-auto p-4 sm:p-6">
              {text.trim() ? (
                <div className="md-preview" dangerouslySetInnerHTML={{ __html: rendered.html }} />
              ) : (
                <p className="text-[13px] text-faint">The preview appears here as you type.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
