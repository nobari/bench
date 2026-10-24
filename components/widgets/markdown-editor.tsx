"use client";

import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueryState, parseAsStringLiteral } from "nuqs";
import DOMPurify from "dompurify";
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import {
  AppWindow,
  Bold,
  BookOpen,
  ChevronDown,
  Code,
  Columns2,
  Download,
  Expand,
  Eye,
  Heading1,
  Heading2,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  Maximize2,
  Minimize2,
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
  documentTitle,
  exportableHtml,
  indentLines,
  insertBlock,
  markdownStats,
  prefixLines,
  renderMarkdown,
  toStandaloneHtml,
  wrapSelection,
  type Edit,
} from "@/lib/tools/text/markdown";
import { annotationsHtml, annotationsMarkdown, makeAnnotation, placeAnnotations, reanchor, sanitizeAnnotations, type MarkColor, type MdAnnotation, type Placed } from "@/lib/tools/text/annotations";
import { rangeOffsets, textRuns, unwrapMarks, wrapMarks } from "@/lib/tools/text/annotate-dom";
import { AnnotationEditor, AnnotationsPanel, CreateAnnotationPopover, clampPos, type PopoverPos } from "@/components/widgets/markdown-annotations";
import { EmbedPicker } from "@/components/widgets/markdown-embed-picker";
import { markdownGuide } from "@/lib/tools/text/markdown-guide";
import { SAMPLES, WELCOME } from "@/lib/tools/text/markdown-samples";
import { TOOLS } from "@/lib/tools/registry";
import { EMBED_HEIGHT_MESSAGE } from "@/components/embed-shell";
import { CopyButton } from "@/components/copy-button";
import { SHARE_SYNC_EVENT } from "@/components/share-button";
import { readShareState, useShareState } from "@/lib/share-state";
import { subscribeTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { SplitPane } from "@/components/ui/split-pane";

const VIEWS = ["edit", "split", "preview"] as const;
const DRAFT_KEY = "bench:markdown:draft";
const ANN_DRAFT_KEY = "bench:markdown:annotations";

/** A fingerprint of a placement, so the panel re-renders only when something about it changed. */
const placementKey = (l: Placed[]) => l.map((p) => [p.id, p.n, p.at ? `${p.at.start}-${p.at.end}` : "x", p.color, p.done ? 1 : 0, p.note].join("\u0001")).join("\u0002");
/** Annotations from a draft (plain JSON); anything unreadable is simply none. */
function parseAnnotations(json: string | null): MdAnnotation[] {
  if (!json) return [];
  try {
    return sanitizeAnnotations(JSON.parse(json));
  } catch {
    return [];
  }
}
/** Annotations from a link's compressed `a` parameter. */
function linkAnnotations(a: string | null): MdAnnotation[] {
  if (!a) return [];
  try {
    return parseAnnotations(decompressFromEncodedURIComponent(a));
  } catch {
    return [];
  }
}

/** Drawn diagrams by theme and source: typing anywhere else leaves every diagram as it is. */
const mermaidCache = new Map<string, string>();
const MERMAID_CACHE = 80;
type MermaidModule = typeof import("mermaid").default;
let mermaidModule: Promise<MermaidModule> | null = null;
const loadMermaid = () => (mermaidModule ??= import("mermaid").then((m) => m.default));
/** Mermaid's theme for the site's: dark and wood are dark, light is neutral, no choice follows the system. */
function mermaidTheme(): "dark" | "neutral" {
  const t = document.documentElement.dataset.theme;
  if (t === "dark" || t === "wood") return "dark";
  if (t === "light") return "neutral";
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "neutral";
}
let mermaidSeq = 0;

if (typeof window !== "undefined") {
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.getAttribute("target") === "_blank") node.setAttribute("rel", "noopener noreferrer");
    // Frames are allowed for one thing only: a Bench tool's embed page on this site.
    if (node.tagName === "IFRAME" && !/^\/embed\/(?:[a-z0-9-]+\/[a-z0-9-]+|s\/[0-9A-Za-z]{6,16})(?:[?#]|$)/.test(node.getAttribute("src") ?? "")) node.remove();
  });
}
const sanitize = (html: string) => DOMPurify.sanitize(html, { ADD_TAGS: ["iframe"], ADD_ATTR: ["target", "sandbox", "allow", "loading", "referrerpolicy", "title"] });
/** The tool at a path, for embed blocks. */
const toolAt = (path: string) => {
  const [, category, slug] = path.split("/");
  const t = TOOLS.find((x) => x.category === category && x.slug === slug);
  return t ? { title: t.title } : null;
};

/** Document source: compressed hash (Share, with its annotations) → `i` query → local draft (with its annotations) → sample. */
function readInitial(): { text: string; annotations: MdAnnotation[]; source: "link" | "draft" | "sample" } {
  if (typeof window === "undefined") return { text: WELCOME, annotations: [], source: "sample" };
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const h = hash.get("d");
  if (h) {
    try {
      const v = decompressFromEncodedURIComponent(h);
      if (v) return { text: v, annotations: linkAnnotations(hash.get("a")), source: "link" };
    } catch {
      /* ignore */
    }
  }
  const q = new URLSearchParams(window.location.search).get("i");
  if (q !== null) return { text: q, annotations: [], source: "link" };
  try {
    const draft = localStorage.getItem(DRAFT_KEY);
    if (draft) return { text: draft, annotations: parseAnnotations(localStorage.getItem(ANN_DRAFT_KEY)), source: "draft" };
  } catch {
    /* storage unavailable */
  }
  return { text: WELCOME, annotations: [], source: "sample" };
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
  // How the link's reader looked at it, applied softly: only values still understood are taken.
  const [outline, setOutline] = useState(() => readShareState<{ outline: unknown }>("markdown")?.outline === true);
  const [fill, setFill] = useState(() => readShareState<{ fill: unknown }>("markdown")?.fill === true);
  const [showMarks, setShowMarks] = useState(() => readShareState<{ marks: unknown }>("markdown")?.marks !== false);
  const [notesOpen, setNotesOpen] = useState(() => readShareState<{ notes: unknown }>("markdown")?.notes === true);
  useShareState("markdown", { outline, fill, marks: showMarks, notes: notesOpen });
  // Annotations are part of the document's data: they ride in the link's `a` parameter and in the local draft.
  const [annotations, setAnnotations] = useState<MdAnnotation[]>(initial.annotations);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [selectedAnn, setSelectedAnn] = useState<string | null>(null);
  const [annFocus, setAnnFocus] = useState(false);
  const [markColor, setMarkColor] = useState<MarkColor>("yellow");
  const [draftSel, setDraftSel] = useState<{ start: number; end: number; pos: PopoverPos } | null>(null);
  const [editorPos, setEditorPos] = useState<PopoverPos | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [themeTick, setThemeTick] = useState(0);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const previewPanelRef = useRef<HTMLDivElement | null>(null);
  const syncing = useRef(false);
  const urlsRef = useRef<string[]>([]);

  const deferred = useDeferredValue(text);
  // Embeds frame other tools; a document shown inside a frame already (an embedded editor) shows them as cards.
  const [nested] = useState(() => typeof window !== "undefined" && window.self !== window.top);
  const rendered = useMemo(
    () => renderMarkdown(deferred, sanitize, { embed: { hosts: typeof window !== "undefined" ? [window.location.host] : [], tool: toolAt, frames: !nested } }),
    [deferred, nested],
  );
  // React 19 resets innerHTML whenever it is handed a new object, so the preview's markup is kept as one object per
  // render result: unrelated state changes (autosave time, outline, copy feedback) leave the preview DOM alone.
  const previewHtml = useMemo(() => ({ __html: rendered.html }), [rendered.html]);
  const stats = useMemo(() => markdownStats(deferred), [deferred]);

  // Autosave the draft locally (debounced).
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        if (text.trim()) localStorage.setItem(DRAFT_KEY, text);
        else localStorage.removeItem(DRAFT_KEY);
        if (annotations.length) localStorage.setItem(ANN_DRAFT_KEY, JSON.stringify(annotations));
        else localStorage.removeItem(ANN_DRAFT_KEY);
        setSavedAt(Date.now());
      } catch {
        /* storage unavailable */
      }
    }, 500);
    return () => clearTimeout(id);
  }, [text, annotations]);

  useEffect(() => {
    const sync = () => {
      const h = new URLSearchParams();
      if (text.trim()) h.set("d", compressToEncodedURIComponent(text));
      if (text.trim() && annotations.length) h.set("a", compressToEncodedURIComponent(JSON.stringify(annotations)));
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${h}`);
    };
    window.addEventListener(SHARE_SYNC_EVENT, sync);
    return () => window.removeEventListener(SHARE_SYNC_EVENT, sync);
  }, [text, annotations]);

  useEffect(() => {
    const urls = urlsRef.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  // Diagrams: drawn when they scroll into view, from the cache when the source is unchanged, after a short pause while
  // the source is being typed; a theme change redraws them in the matching Mermaid theme.
  useEffect(() => subscribeTheme(() => setThemeTick((t) => t + 1)), []);
  useEffect(() => {
    const root = previewRef.current;
    if (!root) return;
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(".md-mermaid[data-diagram]"));
    const sourceOf = (el: HTMLElement) => el.dataset.source ?? (el.dataset.source = el.querySelector(".md-mermaid-src")?.textContent ?? "");
    if (!blocks.length) return;
    let cancelled = false;
    const theme = mermaidTheme();
    const draw = async (el: HTMLElement) => {
      const code = sourceOf(el);
      const key = `${theme}\u0000${code}`;
      const hit = mermaidCache.get(key);
      if (hit) {
        el.innerHTML = hit;
        el.dataset.state = "done";
        return;
      }
      el.dataset.state = "rendering";
      await new Promise((r) => setTimeout(r, 350));
      if (cancelled || !el.isConnected) return;
      try {
        const mermaid = await loadMermaid();
        mermaid.initialize({ startOnLoad: false, theme, securityLevel: "strict", fontFamily: "inherit" });
        const { svg } = await mermaid.render(`md-mermaid-${++mermaidSeq}`, code);
        if (cancelled || !el.isConnected) return;
        if (mermaidCache.size >= MERMAID_CACHE) mermaidCache.delete(mermaidCache.keys().next().value as string);
        mermaidCache.set(key, svg);
        el.innerHTML = svg;
        el.dataset.state = "done";
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        el.dataset.state = "error";
        el.innerHTML = `<p class="md-mermaid-error">Diagram not drawn: ${msg.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c)}</p><pre class="md-mermaid-src"><code>${code.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c)}</code></pre>`;
      }
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          io.unobserve(entry.target);
          void draw(entry.target as HTMLElement);
        }
      },
      { root, rootMargin: "300px" },
    );
    for (const el of blocks) {
      const hit = mermaidCache.get(`${theme}\u0000${sourceOf(el)}`);
      if (hit) {
        el.innerHTML = hit;
        el.dataset.state = "done";
      } else io.observe(el);
    }
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [rendered.html, themeTick, fill, fullscreen]);

  // Annotations: the preview's text is read, every annotation found in it (at its remembered place, else by its
  // quote), the marks painted, and places that moved written back so the link and the draft carry them.
  useEffect(() => {
    let active = true;
    const root = previewRef.current?.querySelector<HTMLElement>(".md-preview");
    if (!root) {
      queueMicrotask(() => active && setPlaced((p) => (p.length ? [] : p)));
      return () => {
        active = false;
      };
    }
    // The DOM is painted at once (no flash of unmarked text); the derived state follows in a microtask.
    unwrapMarks(root);
    const { text: previewText } = textRuns(root);
    const next = placeAnnotations(previewText, annotations);
    if (showMarks) wrapMarks(root, next.filter((p) => p.at).map((p) => ({ id: p.id, start: p.at!.start, end: p.at!.end, color: p.color, n: p.n, done: p.done })));
    queueMicrotask(() => {
      if (!active) return;
      setPlaced((prev) => (placementKey(prev) === placementKey(next) ? prev : next));
      const re = reanchor(previewText, annotations, next);
      if (re !== annotations) setAnnotations(re);
    });
    return () => {
      active = false;
    };
  }, [rendered.html, annotations, showMarks]);

  // The selected annotation is ringed and its editor sits under its last mark.
  useEffect(() => {
    const box = previewRef.current;
    const root = box?.querySelector<HTMLElement>(".md-preview");
    if (!box || !root) return;
    for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-selected]"))) delete el.dataset.selected;
    const marks = selectedAnn ? Array.from(root.querySelectorAll<HTMLElement>(`.md-ann[data-ann="${selectedAnn}"], .md-ann-n[data-ann="${selectedAnn}"]`)) : [];
    for (const m of marks) m.dataset.selected = "true";
    // Measured once layout has settled, in a frame callback.
    const frame = requestAnimationFrame(() => {
      if (!selectedAnn) return setEditorPos(null);
      const last = marks.filter((m) => m.classList.contains("md-ann")).at(-1);
      if (!last) return setEditorPos(clampPos({ top: 8, left: box.clientWidth / 2 }, 320, box.clientWidth));
      const r = last.getBoundingClientRect(), b = box.getBoundingClientRect();
      setEditorPos(clampPos({ top: r.bottom - b.top + box.scrollTop + 8, left: r.left + r.width / 2 - b.left + box.scrollLeft }, 320, box.clientWidth));
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedAnn, placed, showMarks, rendered.html]);

  // A selection inside the preview offers a highlight or a comment, once the pointer is up.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pointerDown = false;
    const read = () => {
      const box = previewRef.current;
      const root = box?.querySelector<HTMLElement>(".md-preview");
      const sel = document.getSelection();
      if (pointerDown || !box || !root || !sel || sel.rangeCount === 0 || sel.isCollapsed || !root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) {
        if (!pointerDown) setDraftSel(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const off = rangeOffsets(root, range, textRuns(root).runs);
      if (!off) {
        setDraftSel(null);
        return;
      }
      const r = range.getBoundingClientRect(), b = box.getBoundingClientRect();
      setDraftSel({ ...off, pos: clampPos({ top: r.bottom - b.top + box.scrollTop + 8, left: r.left + r.width / 2 - b.left + box.scrollLeft }, 230, box.clientWidth) });
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(read, 120);
    };
    const onDown = (e: PointerEvent) => {
      if (previewRef.current?.contains(e.target as Node)) pointerDown = true;
    };
    const onUp = () => {
      pointerDown = false;
      schedule();
    };
    document.addEventListener("selectionchange", schedule);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", schedule);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const createAnnotation = (color: MarkColor, withNote: boolean) => {
    const root = previewRef.current?.querySelector<HTMLElement>(".md-preview");
    if (!root || !draftSel) return;
    const a = makeAnnotation(textRuns(root).text, draftSel.start, draftSel.end, color);
    if (!a.quote.trim()) return;
    setAnnotations((l) => [...l, a]);
    setMarkColor(color);
    setShowMarks(true);
    setDraftSel(null);
    document.getSelection()?.removeAllRanges();
    setSelectedAnn(withNote ? a.id : null);
    setAnnFocus(withNote);
  };
  const patchAnnotation = (id: string, p: Partial<MdAnnotation>) => setAnnotations((l) => l.map((a) => (a.id === id ? { ...a, ...p } : a)));
  const deleteAnnotation = (id: string) => {
    setAnnotations((l) => l.filter((a) => a.id !== id));
    setSelectedAnn((s) => (s === id ? null : s));
  };
  const selectAnnotation = (id: string) => {
    setSelectedAnn(id);
    setAnnFocus(false);
    requestAnimationFrame(() => previewRef.current?.querySelector(`.md-ann[data-ann="${id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  };
  const clearAnnotations = () => {
    setAnnotations([]);
    setSelectedAnn(null);
  };
  const selectedData = selectedAnn ? annotations.find((a) => a.id === selectedAnn) : undefined;
  const selectedPlaced = selectedAnn ? placed.find((p) => p.id === selectedAnn) : undefined;

  // Embedded tools report their height; frames without a fixed height follow it.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: unknown; height?: unknown } | null;
      if (!data || data.type !== EMBED_HEIGHT_MESSAGE || typeof data.height !== "number") return;
      const root = previewRef.current;
      if (!root) return;
      for (const frame of Array.from(root.querySelectorAll<HTMLIFrameElement>("iframe.md-embed-frame[data-auto]"))) {
        if (frame.contentWindow === e.source) frame.style.height = `${Math.min(1400, Math.max(200, Math.ceil(data.height) + 2))}px`;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  const [picking, setPicking] = useState(false);
  const [samplesOpen, setSamplesOpen] = useState(false);
  useEffect(() => {
    if (!samplesOpen) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-samples-menu], [data-samples-button]")) setSamplesOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [samplesOpen]);
  const guide = useMemo(() => markdownGuide(), []);

  // Clicks in the preview: a mark or its number selects that annotation, a copy button copies its code block, and
  // anything else (outside the popovers) drops the selection. The preview is plain HTML, so one listener serves all.
  const onPreviewClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-ann-popover]")) return;
    const mark = target.closest<HTMLElement>(".md-ann, .md-ann-n");
    if (mark?.dataset.ann) {
      setSelectedAnn(mark.dataset.ann);
      setAnnFocus(false);
      return;
    }
    const btn = target.closest<HTMLButtonElement>(".md-copy");
    if (!btn) {
      setSelectedAnn(null);
      return;
    }
    const code = btn.closest(".md-code")?.querySelector("pre code")?.textContent ?? "";
    void navigator.clipboard.writeText(code).then(() => {
      btn.textContent = "Copied";
      btn.dataset.copied = "true";
      setTimeout(() => {
        btn.textContent = "Copy";
        delete btn.dataset.copied;
      }, 1500);
    });
  }, []);

  // Fill the window and real full screen on the preview panel.
  useEffect(() => {
    if (!fill) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fill]);
  // Esc closes the annotation editor, else drops the selection offer, else leaves the fill mode; Delete removes the
  // selected annotation when no text field has the focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = !!(e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]");
      if (e.key === "Escape") {
        if (selectedAnn) setSelectedAnn(null);
        else if (draftSel) {
          setDraftSel(null);
          document.getSelection()?.removeAllRanges();
        } else if (fill && !document.fullscreenElement) setFill(false);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedAnn && !inField) {
        e.preventDefault();
        setAnnotations((l) => l.filter((a) => a.id !== selectedAnn));
        setSelectedAnn(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fill, selectedAnn, draftSel]);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === previewPanelRef.current && !!previewPanelRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void previewPanelRef.current?.requestFullscreen?.().catch(() => setFill(true));
  };
  /** The preview as it stands — diagrams drawn, copy bars gone, marks kept and listed — for files and printing. */
  const exportHtml = () => exportableHtml(previewRef.current?.querySelector(".md-preview")?.innerHTML ?? rendered.html) + (showMarks && placed.length ? annotationsHtml(placed) : "");

  // A toolbar edit replaces the textarea's value, which moves the caret to the end and scrolls the box to the
  // bottom; the selection and the scroll position are put back before the browser paints the new value.
  const pendingEdit = useRef<{ start: number; end: number; scrollTop: number } | null>(null);
  const apply = (fn: (t: string, s: number, e: number) => Edit) => {
    const ta = taRef.current;
    const s = ta?.selectionStart ?? text.length;
    const e = ta?.selectionEnd ?? text.length;
    const edit = fn(text, s, e);
    pendingEdit.current = { start: edit.start, end: edit.end, scrollTop: ta?.scrollTop ?? 0 };
    setText(edit.text);
  };
  useLayoutEffect(() => {
    const ta = taRef.current, edit = pendingEdit.current;
    if (!ta || !edit) return;
    pendingEdit.current = null;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(edit.start, edit.end);
    ta.scrollTop = edit.scrollTop;
  }, [text]);

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
    w.document.write(toStandaloneHtml(title, exportHtml()));
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

    // The editor pane, shown alone or in a split (see below).
  const editorPane = (
<div className="panel flex min-w-0 flex-col">
            <div className="flex items-center justify-between border-b border-edge px-3 py-2">
              <span className="readout">Markdown</span>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button onClick={() => setSamplesOpen((o) => !o)} className={cn("inline-flex items-center gap-1 text-[12px] text-faint hover:text-ink", samplesOpen && "text-ink")} aria-haspopup="menu" aria-expanded={samplesOpen} data-samples-button>
                    Samples <ChevronDown size={11} />
                  </button>
                  {samplesOpen && (
                    <div className="absolute right-0 top-full z-30 mt-1 w-80 rounded-[var(--radius)] border border-edge bg-base p-1 shadow-[0_8px_24px_rgba(0,0,0,0.18)]" role="menu" data-samples-menu>
                      {SAMPLES.map((sample) => (
                        <button
                          key={sample.id}
                          role="menuitem"
                          onClick={() => {
                            setText(sample.text);
                            clearAnnotations();
                            setSamplesOpen(false);
                          }}
                          className="block w-full rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left hover:bg-raised"
                          data-sample={sample.id}
                        >
                          <span className="block text-[13px] font-medium text-ink">{sample.title}</span>
                          <span className="block text-[12px] text-muted">{sample.blurb}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {text && (
                  <button onClick={() => { setText(""); clearAnnotations(); }} className="inline-flex items-center gap-1 text-[12px] text-faint hover:text-danger">
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
  );
  // The preview pane, shown alone or in a split (see below).
  const previewPane = (
<div ref={previewPanelRef} className={cn("panel flex min-w-0 flex-col md-panel", fill && "fixed inset-0 z-[60] rounded-none border-0", fullscreen && "rounded-none border-0")} data-preview-panel data-fill={fill ? "true" : undefined} data-fullscreen={fullscreen ? "true" : undefined}>
            <div className="flex items-center justify-between gap-2 border-b border-edge px-3 py-2">
              <span className="readout">Preview{fill || fullscreen ? ` — ${title}` : ""}</span>
              <div className="flex items-center gap-1.5">
                {rendered.headings.length > 0 && (
                  <button onClick={() => setOutline((o) => !o)} className={cn(GHOST, outline && "border-accent text-accent")}>
                    <ListTree size={13} /> Outline
                  </button>
                )}
                <button onClick={() => setNotesOpen((o) => !o)} className={cn(GHOST, notesOpen && "border-accent text-accent")} title="Highlight stretches of the preview and comment on them" data-notes-toggle>
                  <Highlighter size={13} /> Annotate{annotations.length ? ` (${annotations.length})` : ""}
                </button>
                {!fullscreen && (
                  <button onClick={() => setFill((f) => !f)} className={cn(GHOST, fill && "border-accent text-accent")} title={fill ? "Back to the page (Esc)" : "Fill the browser window with the preview"} data-fill-toggle>
                    {fill ? <Minimize2 size={13} /> : <Expand size={13} />} {fill ? "Exit" : "Fill window"}
                  </button>
                )}
                <button onClick={toggleFullscreen} className={cn(GHOST, fullscreen && "border-accent text-accent")} title={fullscreen ? "Leave full screen (Esc)" : "Preview full screen"} data-fullscreen-toggle>
                  <Maximize2 size={13} /> {fullscreen ? "Exit full screen" : "Full screen"}
                </button>
              </div>
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
            {notesOpen && <AnnotationsPanel placed={placed} selected={selectedAnn} show={showMarks} onShow={setShowMarks} onSelect={selectAnnotation} onClear={clearAnnotations} markdown={annotationsMarkdown(placed)} />}
            <div ref={previewRef} onScroll={onPreviewScroll} onClick={onPreviewClick} className={cn("relative overflow-auto p-4 sm:p-6", fill || fullscreen ? "min-h-0 flex-1" : "h-[560px]")}>
              {text.trim() ? (
                <div className={cn("md-preview", (fill || fullscreen) && "mx-auto max-w-3xl")} dangerouslySetInnerHTML={previewHtml} />
              ) : (
                <p className="text-[13px] text-faint">The preview appears here as you type.</p>
              )}
              {draftSel && !selectedAnn && <CreateAnnotationPopover pos={draftSel.pos} color={markColor} onCreate={createAnnotation} />}
              {selectedAnn && selectedData && editorPos && (
                <AnnotationEditor
                  pos={editorPos}
                  annotation={selectedData}
                  number={selectedPlaced?.n ?? annotations.length}
                  lost={!!selectedPlaced && !selectedPlaced.at}
                  autoFocus={annFocus}
                  onChange={(p) => patchAnnotation(selectedAnn, p)}
                  onDelete={() => deleteAnnotation(selectedAnn)}
                  onClose={() => setSelectedAnn(null)}
                />
              )}
            </div>
          </div>
  );
return (
    <div className="space-y-3">
      {picking && (
        <EmbedPicker
          onPick={(block) => {
            setPicking(false);
            apply((t, s, e) => insertBlock(t, s, e, block));
          }}
          onClose={() => setPicking(false)}
        />
      )}
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
            <span className="mx-1 h-5 w-px bg-edge" />
            <button onClick={() => setPicking(true)} title="Embed another Bench tool, live, in the state its link carries" className={TOOL} data-embed-button><AppWindow size={15} /></button>
          </div>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <CopyButton value={text} label="Copy Markdown" />
          <CopyButton value={exportableHtml(rendered.html)} label="Copy HTML" />
          <button onClick={() => download(`${fileBase}.md`, text, "text/markdown")} className={GHOST} title="Download as .md">
            <Download size={13} /> .md
          </button>
          <button onClick={() => download(`${fileBase}.html`, toStandaloneHtml(title, exportHtml()), "text/html")} className={GHOST} title="Download as a standalone .html">
            <Download size={13} /> .html
          </button>
          <button onClick={print} className={GHOST} title="Print, or save as PDF from the print dialog">
            <Printer size={13} /> Print / PDF
          </button>
          <span className="mx-0.5 h-5 w-px bg-edge" />
          <CopyButton value={guide} label="LLM guide" className="h-7 px-2 text-[12px]" />
          <button onClick={() => download("bench-markdown-guide.md", guide, "text/markdown")} className={GHOST} title="Download the guide for a language model: what this editor renders, its alerts, diagrams and embedded tools, with a working link for every tool" data-guide-download>
            <BookOpen size={13} /> .md
          </button>
        </div>
      </div>

      {view === "split" ? (
        <SplitPane id="markdown-editor" defaultRatio={0.5} minFirst={260} minSecond={260} collapsible="both" firstLabel="editor" secondLabel="preview" stackBelow="lg" gap={12} first={editorPane} second={previewPane} />
      ) : (
        <div className="grid gap-3">
          {showEditor && editorPane}
          {showPreview && previewPane}
        </div>
      )}
    </div>
  );
}
