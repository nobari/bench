"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQueryState, parseAsString } from "nuqs";
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { AlertTriangle, ArrowUpRight, CheckSquare, Columns2, Download, Eye, Hash, Highlighter, Loader, Maximize2, Minimize2, Minus, MousePointer2, PanelLeft, Pencil, Plus, Printer, RotateCcw, Scan, StickyNote, Trash2 } from "lucide-react";
import type { MermaidConfig } from "mermaid";
import { ANNOTATION_COLORS, CHEATSHEET, DEFAULT_TEMPLATE, PRINT_DIAGRAM_CONFIG, PRINT_THEME_VARIABLES, TEMPLATES, greyscaleSvg, annotatedSvg, annotationUnit, annotationsMarkdown, annotationsSvg, detectType, diagramTitle, markdownFence, nextNumber, printableHtml, sanitizeAnnotations, standaloneSvg, svgSize, svgToPng, PAPER_SIZES, type Annotation, type AnnotationColor, type AnnotationKind, type PaperSize } from "@/lib/tools/web/mermaid";
import { CopyButton } from "@/components/copy-button";
import { SHARE_SYNC_EVENT } from "@/components/share-button";
import { cn } from "@/lib/utils";

const DRAFT_KEY = "bench:mermaid:draft";
const ANN_DRAFT_KEY = "bench:mermaid:annotations";
type Tool = "select" | AnnotationKind;
const TOOLS: { id: Tool; label: string; Icon: typeof StickyNote; hint: string }[] = [
  { id: "select", label: "Select", Icon: MousePointer2, hint: "Drag the diagram to pan; drag an annotation to move it" },
  { id: "note", label: "Note", Icon: StickyNote, hint: "Click the diagram to drop a sticky note" },
  { id: "check", label: "Checkbox", Icon: CheckSquare, hint: "Click to add a to-do; click its box to tick it" },
  { id: "arrow", label: "Arrow", Icon: ArrowUpRight, hint: "Drag from the label to what it points at" },
  { id: "highlight", label: "Highlight", Icon: Highlighter, hint: "Drag a box over the part to highlight" },
  { id: "number", label: "Number", Icon: Hash, hint: "Click to drop the next numbered marker" },
];
const newId = () => "a" + Math.random().toString(36).slice(2, 8);
const THEMES = [
  ["default", "Default"],
  ["print", "Print (black & white)"],
  ["neutral", "Neutral"],
  ["forest", "Forest"],
  ["dark", "Dark"],
  ["base", "Base"],
] as const;
type Theme = (typeof THEMES)[number][0];
type View = "split" | "edit" | "preview";

const SEL = "h-8 rounded-[var(--radius-sm)] border border-edge bg-base px-2 pr-7 text-[13px] text-ink outline-none focus:border-accent";
const GHOST = "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2.5 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-40";
const ICON = "flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border border-edge bg-surface text-muted hover:text-ink disabled:opacity-40";

type Mermaid = typeof import("mermaid").default;
let mermaidPromise: Promise<Mermaid> | null = null;
function loadMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => {
      m.default.initialize({ startOnLoad: false, securityLevel: "strict" });
      return m.default;
    });
    mermaidPromise.catch(() => {
      mermaidPromise = null;
    });
  }
  return mermaidPromise;
}

/** Source comes from the compressed hash (Share), a plain `i` param, the saved draft, or the default template. */
function parseAnnotations(json: string | null): Annotation[] {
  if (!json) return [];
  try {
    return sanitizeAnnotations(JSON.parse(json));
  } catch {
    return [];
  }
}

function readInitial(): { code: string; annotations: Annotation[]; source: "link" | "draft" | "template" } {
  if (typeof window === "undefined") return { code: DEFAULT_TEMPLATE.code, annotations: [], source: "template" };
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const dec = (v: string | null) => {
    if (!v) return null;
    try {
      return decompressFromEncodedURIComponent(v) || null;
    } catch {
      return null;
    }
  };
  const linked = dec(hash.get("i")) ?? new URLSearchParams(window.location.search).get("i");
  if (linked) return { code: linked, annotations: parseAnnotations(dec(hash.get("a"))), source: "link" };
  try {
    // The untouched starter diagram is never stored, but notes made on it are.
    const draft = localStorage.getItem(DRAFT_KEY);
    const annotations = parseAnnotations(localStorage.getItem(ANN_DRAFT_KEY));
    if (draft?.trim()) return { code: draft, annotations, source: "draft" };
    if (annotations.length) return { code: DEFAULT_TEMPLATE.code, annotations, source: "draft" };
  } catch {
    /* storage unavailable */
  }
  return { code: DEFAULT_TEMPLATE.code, annotations: [], source: "template" };
}

function download(blob: Blob | string, name: string, type = "text/plain") {
  const url = URL.createObjectURL(typeof blob === "string" ? new Blob([blob], { type }) : blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A dashed ring around the selected annotation, in diagram units. */
function selectionRing(a: Annotation | undefined, box: { width: number; height: number }): string {
  if (!a) return "";
  const u = annotationUnit(box.width, box.height);
  if (a.kind === "highlight") return `<rect x="${a.x * box.width - u * 0.3}" y="${a.y * box.height - u * 0.3}" width="${a.w * box.width + u * 0.6}" height="${a.h * box.height + u * 0.6}" fill="none" stroke="#3f7414" stroke-width="${u * 0.1}" stroke-dasharray="${u * 0.4} ${u * 0.3}" pointer-events="none"/>`;
  const cx = a.kind === "arrow" ? a.x * box.width : a.x * box.width + (a.kind === "number" ? 0 : u * 2), cy = a.kind === "arrow" ? a.y * box.height : a.y * box.height + (a.kind === "number" ? 0 : u);
  return `<circle cx="${cx}" cy="${cy}" r="${u * 1.6}" fill="none" stroke="#3f7414" stroke-width="${u * 0.1}" stroke-dasharray="${u * 0.4} ${u * 0.3}" pointer-events="none"/>`;
}

type Render = { kind: "idle" } | { kind: "ok"; svg: string; type: string } | { kind: "error"; message: string; line: number | null };

export function MermaidEditorWidget() {
  const [initial] = useState(readInitial);
  const [code, setCode] = useState(initial.code);
  const [annotations, setAnnotations] = useState<Annotation[]>(initial.annotations);
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState<AnnotationColor>("yellow");
  const [selected, setSelected] = useState<string | null>(null);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [maximized, setMaximized] = useState(false);
  const sketch = useRef<{ id: string; kind: "arrow" | "highlight"; x: number; y: number } | null>(null);
  const moving = useRef<{ id: string; dx: number; dy: number; d2x?: number; d2y?: number } | null>(null);
  const [theme, setTheme] = useQueryState("theme", parseAsString.withDefault("default").withOptions({ history: "replace" }));
  const [look, setLook] = useQueryState("look", parseAsString.withDefault("classic").withOptions({ history: "replace" }));
  const [viewParam, setView] = useQueryState("v", parseAsString.withDefault("split").withOptions({ history: "replace" }));
  const [render, setRender] = useState<Render>({ kind: "idle" });
  const [lastGood, setLastGood] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [paper, setPaper] = useState<PaperSize>("auto");
  const [printSource, setPrintSource] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(initial.source === "draft" ? "Restored your last draft." : null);
  const [cheat, setCheat] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; pan: { x: number; y: number } } | null>(null);
  const seq = useRef(0);
  const deferred = useDeferredValue(code);
  const view = (viewParam === "edit" || viewParam === "preview" ? viewParam : "split") as View;
  const themeId = (THEMES.some(([t]) => t === theme) ? theme : "default") as Theme;
  const handDrawn = look === "hand";
  const type = useMemo(() => detectType(deferred), [deferred]);
  const title = useMemo(() => diagramTitle(code), [code]);
  const fileBase = (title || type || "diagram").replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "diagram";

  // Render on every (deferred) change; keep the last good drawing visible while fixing a syntax error.
  useEffect(() => {
    const id = ++seq.current;
    if (!deferred.trim()) {
      queueMicrotask(() => setRender({ kind: "idle" }));
      return;
    }
    let active = true;
    (async () => {
      try {
        const mermaid = await loadMermaid();
        // Plain SVG text labels (no <foreignObject>): HTML labels taint the canvas, which breaks PNG export and clipboard copy.
        // "print" is the base theme with an all-greyscale palette, so a black-and-white printer loses nothing.
        const config: MermaidConfig = {
          startOnLoad: false,
          securityLevel: "strict",
          theme: themeId === "print" ? "base" : themeId,
          themeVariables: themeId === "print" ? PRINT_THEME_VARIABLES : undefined,
          look: handDrawn ? "handDrawn" : "classic",
          fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif",
          htmlLabels: false,
          flowchart: { htmlLabels: false },
          sequence: { useMaxWidth: true, ...(themeId === "print" ? PRINT_DIAGRAM_CONFIG.sequence : {}) },
          class: { htmlLabels: false },
          journey: themeId === "print" ? { ...PRINT_DIAGRAM_CONFIG.journey } : undefined,
        };
        mermaid.initialize(config);
        await mermaid.parse(deferred);
        const rendered = await mermaid.render(`bench-mermaid-${id}`, deferred);
        if (!active || id !== seq.current) return;
        // The journey renderer ignores theme variables, so the print theme greys its colours after the fact.
        const kind = detectType(deferred);
        const svg = themeId === "print" && kind === "journey" ? greyscaleSvg(rendered.svg) : rendered.svg;
        setRender({ kind: "ok", svg, type: kind });
        setLastGood(svg);
      } catch (e) {
        if (!active || id !== seq.current) return;
        const message = e instanceof Error ? e.message : String(e);
        const line = Number(message.match(/line (\d+)/i)?.[1]);
        setRender({ kind: "error", message: message.split("\n").slice(0, 3).join(" · ").replace(/\s+/g, " ").trim(), line: Number.isFinite(line) && line > 0 ? line : null });
        // Mermaid leaves a scratch element behind when rendering throws.
        document.getElementById(`dbench-mermaid-${id}`)?.remove();
      }
    })();
    return () => {
      active = false;
    };
  }, [deferred, themeId, handDrawn]);

  // Draft autosave and share-link sync.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (code.trim() && code !== DEFAULT_TEMPLATE.code) localStorage.setItem(DRAFT_KEY, code);
        else localStorage.removeItem(DRAFT_KEY);
        if (annotations.length) localStorage.setItem(ANN_DRAFT_KEY, JSON.stringify(annotations));
        else localStorage.removeItem(ANN_DRAFT_KEY);
      } catch {
        /* storage unavailable */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [code, annotations]);
  useEffect(() => {
    const sync = () => {
      const h = new URLSearchParams();
      if (code.trim() && (code !== DEFAULT_TEMPLATE.code || annotations.length)) h.set("i", compressToEncodedURIComponent(code));
      if (annotations.length) h.set("a", compressToEncodedURIComponent(JSON.stringify(annotations)));
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${h.size ? `#${h}` : ""}`);
    };
    window.addEventListener(SHARE_SYNC_EVENT, sync);
    return () => window.removeEventListener(SHARE_SYNC_EVENT, sync);
  }, [code, annotations]);

  // Escape leaves full screen or drops the current tool; Delete removes the selected annotation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest("input, textarea, [contenteditable]");
      if (e.key === "Escape") {
        if (maximized) setMaximized(false);
        else if (tool !== "select") setTool("select");
        else setSelected(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected && !typing) {
        e.preventDefault();
        setAnnotations((l) => l.filter((a) => a.id !== selected));
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maximized, tool, selected]);
  useEffect(() => {
    document.body.style.overflow = maximized ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [maximized]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  const svg = render.kind === "ok" ? render.svg : lastGood;
  // Exports and print carry the annotations baked in (when shown).
  const mono = themeId === "print";
  const exported = useMemo(() => (svg ? (showAnnotations ? annotatedSvg(svg, annotations, { mono }) : svg) : null), [svg, annotations, showAnnotations, mono]);
  const svgDoc = useMemo(() => (exported ? standaloneSvg(exported) : ""), [exported]);
  const box = useMemo(() => (svg ? svgSize(svg) : { width: 800, height: 600 }), [svg]);
  const overlay = useMemo(() => (svg && showAnnotations ? annotationsSvg(annotations, box.width, box.height, { interactive: true, mono }) : ""), [svg, annotations, box, showAnnotations, mono]);

  // Zoom with pinch or ⌘/Ctrl + scroll; plain scrolling still moves the page.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => Math.min(8, Math.max(0.1, z * Math.exp(-e.deltaY * 0.01))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Fit: scale the drawing to the preview panel (never above 1:1), centred.
  const fit = useCallback(() => {
    const host = hostRef.current;
    const drawn = host?.querySelector("svg");
    if (host && drawn) {
      // Measure the drawing at 1:1 (the zoomed box divided by the current zoom), not the viewBox, which Mermaid pads.
      const box = drawn.getBoundingClientRect();
      const current = Number(host.dataset.zoom || 1);
      const width = box.width / current, height = box.height / current;
      const z = Math.min(1, (host.clientWidth - 32) / width, (host.clientHeight - 32) / height);
      setZoom(Number.isFinite(z) && z > 0 ? z : 1);
    } else setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Refit whenever a new diagram arrives (a template, a link, or a structural edit).
  const fitKey = render.kind === "ok" ? render.type + ":" + render.svg.length : "";
  useEffect(() => {
    if (!fitKey) return;
    const id = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(id);
  }, [fitKey, fit]);
  useEffect(() => {
    const id = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(id);
  }, [maximized, fit]);

  const insertTab = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: s, selectionEnd: en, value } = el;
    if (e.shiftKey) {
      const lineStart = value.lastIndexOf("\n", s - 1) + 1;
      if (value.startsWith("    ", lineStart)) {
        setCode(value.slice(0, lineStart) + value.slice(lineStart + 4));
        requestAnimationFrame(() => el.setSelectionRange(Math.max(lineStart, s - 4), Math.max(lineStart, en - 4)));
      }
      return;
    }
    setCode(value.slice(0, s) + "    " + value.slice(en));
    requestAnimationFrame(() => el.setSelectionRange(s + 4, s + 4));
  };

  // Pointer position → diagram fractions (0–1 across the SVG viewBox).
  const toDiagram = (e: { clientX: number; clientY: number }) => {
    const drawn = hostRef.current?.querySelector("svg[id^=bench-mermaid]");
    if (!drawn) return null;
    const r = drawn.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const patch = (id: string, p: Partial<Annotation>) => setAnnotations((l) => l.map((a) => (a.id === id ? ({ ...a, ...p } as Annotation) : a)));
  const onPreviewDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const target = e.target as Element;
    const checkId = target.closest("[data-check]")?.getAttribute("data-check");
    if (checkId) {
      setAnnotations((l) => l.map((a) => (a.id === checkId && a.kind === "check" ? { ...a, done: !a.done } : a)));
      setSelected(checkId);
      return;
    }
    const annId = target.closest("[data-ann]")?.getAttribute("data-ann");
    const pt = toDiagram(e);
    if (annId && pt) {
      const a = annotations.find((x) => x.id === annId);
      setSelected(annId);
      if (a) moving.current = { id: annId, dx: a.x - pt.x, dy: a.y - pt.y, d2x: a.kind === "arrow" ? a.x2 - pt.x : undefined, d2y: a.kind === "arrow" ? a.y2 - pt.y : undefined };
      return;
    }
    if (tool === "select" || !pt) {
      setSelected(null);
      drag.current = { x: e.clientX, y: e.clientY, pan };
      return;
    }
    const id = newId();
    if (tool === "note") setAnnotations((l) => [...l, { id, kind: "note", x: pt.x, y: pt.y, text: "", color }]);
    else if (tool === "check") setAnnotations((l) => [...l, { id, kind: "check", x: pt.x, y: pt.y, text: "", done: false }]);
    else if (tool === "number") setAnnotations((l) => [...l, { id, kind: "number", x: pt.x, y: pt.y, n: nextNumber(l) }]);
    else if (tool === "arrow") {
      setAnnotations((l) => [...l, { id, kind: "arrow", x: pt.x, y: pt.y, x2: pt.x, y2: pt.y, text: "", color }]);
      sketch.current = { id, kind: "arrow", x: pt.x, y: pt.y };
    } else if (tool === "highlight") {
      setAnnotations((l) => [...l, { id, kind: "highlight", x: pt.x, y: pt.y, w: 0.001, h: 0.001, color }]);
      sketch.current = { id, kind: "highlight", x: pt.x, y: pt.y };
    }
    setSelected(id);
    // One placement per click: back to Select so the next click edits rather than adds.
    if (tool === "note" || tool === "check" || tool === "number") setTool("select");
  };
  const onPreviewMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pt = toDiagram(e);
    if (sketch.current && pt) {
      const s = sketch.current;
      if (s.kind === "arrow") patch(s.id, { x2: pt.x, y2: pt.y });
      else patch(s.id, { x: Math.min(s.x, pt.x), y: Math.min(s.y, pt.y), w: Math.max(0.001, Math.abs(pt.x - s.x)), h: Math.max(0.001, Math.abs(pt.y - s.y)) });
      return;
    }
    if (moving.current && pt) {
      const m = moving.current;
      patch(m.id, m.d2x !== undefined ? { x: pt.x + m.dx, y: pt.y + m.dy, x2: pt.x + m.d2x, y2: pt.y + (m.d2y ?? 0) } : { x: pt.x + m.dx, y: pt.y + m.dy });
      return;
    }
    const d = drag.current;
    if (d) setPan({ x: d.pan.x + e.clientX - d.x, y: d.pan.y + e.clientY - d.y });
  };
  const onPreviewUp = () => {
    if (sketch.current) {
      const s = sketch.current;
      sketch.current = null;
      // A click without a drag leaves a degenerate shape; drop it.
      setAnnotations((l) => l.filter((a) => a.id !== s.id || (a.kind === "arrow" ? Math.hypot(a.x2 - a.x, a.y2 - a.y) > 0.01 : a.kind === "highlight" ? a.w > 0.01 && a.h > 0.01 : true)));
      if (tool !== "select") setTool("select");
    }
    moving.current = null;
    drag.current = null;
  };

  const print = () => {
    if (!svg) return;
    const w = window.open("", "_blank");
    if (!w) {
      setNotice("Allow pop-ups to print.");
      return;
    }
    w.document.write(printableHtml(title || type, exported ?? svg, { paper, includeSource: printSource, source: code, notes: showAnnotations ? annotationsMarkdown(annotations) : "" }));
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 350);
  };

  const exportPng = async (scale: number) => {
    if (!svg) return;
    setBusy("png");
    try {
      download(await svgToPng(exported ?? svg, scale, themeId === "dark" ? "#1f2020" : "#ffffff"), `${fileBase}@${scale}x.png`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "PNG export failed.");
    } finally {
      setBusy(null);
    }
  };

  const copyPng = async () => {
    if (!svg) return;
    setBusy("copy");
    try {
      const blob = await svgToPng(exported ?? svg, 2, themeId === "dark" ? "#1f2020" : "#ffffff");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setNotice("Copied as an image.");
    } catch {
      setNotice("Couldn't copy an image in this browser — download the PNG instead.");
    } finally {
      setBusy(null);
    }
  };

  const applyTemplate = (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    if (code.trim() && code !== DEFAULT_TEMPLATE.code && !TEMPLATES.some((x) => x.code === code) && !window.confirm("Replace the current diagram with the template?")) return;
    setCode(t.code);
    if (t.id === "print") void setTheme("print");
    fit();
  };

  const lines = code.split("\n").length;
  const selectedAnn = selected ? annotations.find((a) => a.id === selected) : undefined;
  // The preview captures the pointer, so a freshly placed annotation's text field must be focused by hand.
  const editorRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!selected) return;
    const id = requestAnimationFrame(() => editorRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [selected]);
  const errorLine = render.kind === "error" ? render.line : null;
  const showEditor = view !== "preview";
  const showPreview = view !== "edit";
  const groups = [...new Set(TEMPLATES.map((t) => t.group))];

  return (
    <div className="space-y-3">
      {/* toolbar */}
      <div className="panel flex flex-wrap items-center gap-2 p-2">
        <select aria-label="Insert a template" value="" onChange={(e) => e.target.value && applyTemplate(e.target.value)} className={cn(SEL, "max-w-[200px]")}>
          <option value="">Templates…</option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {TEMPLATES.filter((t) => t.group === g).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <select aria-label="Theme" value={themeId} onChange={(e) => setTheme(e.target.value === "default" ? null : e.target.value)} className={SEL}>
          {THEMES.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
          <input type="checkbox" checked={handDrawn} onChange={(e) => setLook(e.target.checked ? "hand" : null)} className="accent-[var(--accent)]" />
          Hand-drawn
        </label>
        {mono && <span className="text-[12px] text-faint">Greyscale only — safe for any printer or photocopier</span>}
        <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
          {(
            [
              ["edit", "Edit", Pencil],
              ["split", "Split", Columns2],
              ["preview", "Preview", Eye],
            ] as const
          ).map(([id, label, Icon]) => (
            <button key={id} type="button" onClick={() => setView(id === "split" ? null : id)} aria-label={label} title={label} className={cn("flex h-7 items-center gap-1 rounded-[3px] px-2 text-[12.5px]", view === id ? "bg-accent font-medium text-on-accent" : "text-muted hover:text-ink")}>
              <Icon size={13} />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setCheat((c) => !c)} className={cn(GHOST, cheat && "border-accent text-accent")}>
          <PanelLeft size={13} /> Syntax
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={print} disabled={!svg} className={GHOST} title="Print the diagram">
            <Printer size={13} /> Print
          </button>
          <select aria-label="Paper size" value={paper} onChange={(e) => setPaper(e.target.value as PaperSize)} className={cn(SEL, "h-8 text-[12.5px]")}>
            {PAPER_SIZES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-[12px] text-muted" title="Append the Mermaid source below the diagram when printing">
            <input type="checkbox" checked={printSource} onChange={(e) => setPrintSource(e.target.checked)} className="accent-[var(--accent)]" />
            with source
          </label>
        </div>
      </div>

      {/* export row */}
      <div className="panel flex flex-wrap items-center gap-1.5 p-2 text-[12.5px]">
        <span className="mr-1 text-faint">Export</span>
        <button type="button" onClick={() => svg && download(svgDoc, `${fileBase}.svg`, "image/svg+xml")} disabled={!svg} className={GHOST}>
          <Download size={13} /> SVG
        </button>
        <button type="button" onClick={() => void exportPng(2)} disabled={!svg || !!busy} className={GHOST}>
          {busy === "png" ? <Loader size={13} className="animate-spin" /> : <Download size={13} />} PNG 2×
        </button>
        <button type="button" onClick={() => void exportPng(4)} disabled={!svg || !!busy} className={GHOST}>
          <Download size={13} /> PNG 4×
        </button>
        <button type="button" onClick={() => void copyPng()} disabled={!svg || !!busy} className={GHOST}>
          {busy === "copy" ? <Loader size={13} className="animate-spin" /> : null} Copy image
        </button>
        <CopyButton value={svgDoc} label="Copy SVG" className="h-8 px-2.5 text-[12.5px]" disabled={!svg} />
        <CopyButton value={markdownFence(code) + (annotations.length ? "\n\n" + annotationsMarkdown(annotations) : "")} label="Copy Markdown" className="h-8 px-2.5 text-[12.5px]" />
        <button type="button" onClick={() => download(code, `${fileBase}.mmd`, "text/plain")} className={GHOST}>
          <Download size={13} /> .mmd
        </button>
        {notice && <span className="ml-2 text-accent">{notice}</span>}
        <span className="ml-auto font-mono text-[11.5px] text-faint">
          {type || "no diagram"} · {lines} line{lines === 1 ? "" : "s"}
        </span>
      </div>

      <div className={cn("grid gap-3", showEditor && showPreview && "lg:grid-cols-2", cheat && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_260px]")}>
        {showEditor && (
          <div className={cn("panel flex min-w-0 flex-col", render.kind === "error" && "border-danger/50")}>
            <div className="flex items-center justify-between border-b border-edge px-3 py-2">
              <span className="readout">Mermaid source</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setCode(DEFAULT_TEMPLATE.code)} className="text-[12px] text-faint hover:text-ink" title="Reset to the starter flowchart">
                  <RotateCcw size={12} className="mr-1 inline" />
                  Reset
                </button>
                <button type="button" onClick={() => setCode("")} className="inline-flex items-center gap-1 text-[12px] text-faint hover:text-danger">
                  <Trash2 size={12} /> Clear
                </button>
              </div>
            </div>
            <textarea
              ref={textareaRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={insertTab}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder={"flowchart TD\n    A[Start] --> B{Question?}\n    B -- Yes --> C[Do it]\n    B -- No --> D[Skip]"}
              className="min-h-[420px] flex-1 resize-y bg-transparent p-3 font-mono text-[13px] leading-relaxed text-ink outline-none"
            />
            {render.kind === "error" && (
              <p className="flex items-start gap-1.5 border-t border-edge px-3 py-2 text-[12.5px] text-danger">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  {errorLine !== null && (
                    <button
                      type="button"
                      className="mr-1 underline decoration-dotted"
                      onClick={() => {
                        const el = textareaRef.current;
                        if (!el) return;
                        const pos = code.split("\n").slice(0, errorLine - 1).join("\n").length + (errorLine > 1 ? 1 : 0);
                        el.focus();
                        el.setSelectionRange(pos, pos + (code.split("\n")[errorLine - 1]?.length ?? 0));
                      }}
                    >
                      Line {errorLine}:
                    </button>
                  )}
                  {render.message}
                </span>
              </p>
            )}
          </div>
        )}

        {showPreview && (
          <div className={cn("panel flex min-w-0 flex-col", maximized && "fixed inset-2 z-50 shadow-dialog sm:inset-4")}>
            <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
              <span className="readout">Preview{render.kind === "error" && lastGood ? " · last good render" : ""}</span>
              <div className="ml-auto flex items-center gap-1">
                <button type="button" onClick={() => setZoom((z) => Math.max(0.1, z / 1.25))} aria-label="Zoom out" className={ICON}>
                  <Minus size={13} />
                </button>
                <span className="w-12 text-center font-mono text-[11.5px] text-muted tabular">{Math.round(zoom * 100)}%</span>
                <button type="button" onClick={() => setZoom((z) => Math.min(8, z * 1.25))} aria-label="Zoom in" className={ICON}>
                  <Plus size={13} />
                </button>
                <button type="button" onClick={fit} aria-label="Fit to panel" title="Fit" className={ICON}>
                  <Scan size={13} />
                </button>
                <button type="button" onClick={() => setMaximized((m) => !m)} aria-label={maximized ? "Exit full screen" : "Maximize"} title={maximized ? "Exit full screen (Esc)" : "Maximize"} className={ICON}>
                  {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                </button>
              </div>
            </div>
            {/* annotation tools */}
            <div className="flex flex-wrap items-center gap-1 border-b border-edge px-2 py-1.5">
              {TOOLS.map((t) => (
                <button key={t.id} type="button" onClick={() => setTool(t.id)} title={t.hint} aria-label={t.label} aria-pressed={tool === t.id} className={cn("flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-[12px]", tool === t.id ? "bg-accent font-medium text-on-accent" : "text-muted hover:bg-raised hover:text-ink")}>
                  <t.Icon size={13} />
                  <span className="hidden md:inline">{t.label}</span>
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-edge" />
              {(Object.keys(ANNOTATION_COLORS) as AnnotationColor[]).map((c) => (
                <button key={c} type="button" onClick={() => { setColor(c); if (selected) patch(selected, { color: c }); }} aria-label={`${c} colour`} title={c} className={cn("h-5 w-5 rounded-full border-2", color === c ? "border-ink" : "border-transparent")} style={{ backgroundColor: ANNOTATION_COLORS[c].stroke }} />
              ))}
              <span className="mx-1 h-4 w-px bg-edge" />
              <label className="flex items-center gap-1 text-[12px] text-muted">
                <input type="checkbox" checked={showAnnotations} onChange={(e) => setShowAnnotations(e.target.checked)} className="accent-[var(--accent)]" />
                Show{annotations.length ? ` (${annotations.length})` : ""}
              </label>
              {annotations.length > 0 && (
                <button type="button" onClick={() => { if (window.confirm("Remove all annotations?")) { setAnnotations([]); setSelected(null); } }} className="ml-auto inline-flex items-center gap-1 text-[12px] text-faint hover:text-danger">
                  <Trash2 size={12} /> Clear notes
                </button>
              )}
            </div>
            {selectedAnn && (
              <div className="flex flex-wrap items-center gap-2 border-b border-edge bg-base px-2 py-1.5 text-[12.5px]">
                <span className="text-faint capitalize">{selectedAnn.kind}</span>
                {(selectedAnn.kind === "note" || selectedAnn.kind === "check" || selectedAnn.kind === "arrow") && (
                  <input
                    ref={editorRef}
                    value={selectedAnn.text}
                    onChange={(e) => patch(selectedAnn.id, { text: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && setSelected(null)}
                    placeholder={selectedAnn.kind === "check" ? "To do…" : selectedAnn.kind === "arrow" ? "Label (optional)" : "Note text…"}
                    className="h-7 min-w-[160px] flex-1 rounded-[var(--radius-sm)] border border-edge bg-surface px-2 text-[12.5px] text-ink outline-none focus:border-accent"
                  />
                )}
                {selectedAnn.kind === "check" && (
                  <label className="flex items-center gap-1 text-muted">
                    <input type="checkbox" checked={selectedAnn.done} onChange={(e) => patch(selectedAnn.id, { done: e.target.checked })} className="accent-[var(--accent)]" /> done
                  </label>
                )}
                {selectedAnn.kind === "number" && (
                  <input type="number" min={1} max={999} value={selectedAnn.n} onChange={(e) => patch(selectedAnn.id, { n: Math.max(1, Math.min(999, Number(e.target.value) || 1)) })} className="h-7 w-16 rounded-[var(--radius-sm)] border border-edge bg-surface px-2 font-mono text-[12.5px] text-ink outline-none focus:border-accent" aria-label="Number" />
                )}
                <button type="button" onClick={() => { setAnnotations((l) => l.filter((a) => a.id !== selectedAnn.id)); setSelected(null); }} className="inline-flex items-center gap-1 text-faint hover:text-danger">
                  <Trash2 size={12} /> Delete
                </button>
                <button type="button" onClick={() => setSelected(null)} className="text-faint hover:text-ink">
                  Done
                </button>
              </div>
            )}
            <div
              ref={hostRef}
              data-zoom={zoom}
              className={cn("relative min-h-[420px] flex-1 overflow-hidden", themeId === "dark" ? "bg-[#1f2020]" : "bg-white")}
              style={{ backgroundImage: themeId === "dark" ? undefined : "radial-gradient(rgba(0,0,0,0.08) 1px, transparent 1px)", backgroundSize: "16px 16px", cursor: tool === "select" ? "grab" : "crosshair", touchAction: "none" }}
              onPointerDown={onPreviewDown}
              onPointerMove={onPreviewMove}
              onPointerUp={onPreviewUp}
              onPointerCancel={onPreviewUp}
              onDoubleClick={(e) => {
                if (!(e.target as Element).closest("[data-ann]")) fit();
              }}
            >
              {svg ? (
                <div className="absolute left-1/2 top-1/2" style={{ transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center center" }}>
                  <div
                    className="[&>svg]:block"
                    // Mermaid output is rendered with securityLevel "strict", which escapes labels and strips scripts.
                    dangerouslySetInnerHTML={{ __html: svg }}
                  />
                  {overlay && (
                    <svg
                      className="absolute inset-0 h-full w-full overflow-visible"
                      viewBox={`0 0 ${box.width} ${box.height}`}
                      preserveAspectRatio="none"
                      // Our own markup, built from sanitised annotation data with escaped text.
                      dangerouslySetInnerHTML={{ __html: overlay + (selected ? selectionRing(annotations.find((a) => a.id === selected), box) : "") }}
                    />
                  )}
                </div>
              ) : (
                <div className="flex h-full min-h-[420px] items-center justify-center p-6 text-center text-[13.5px] text-muted">
                  {render.kind === "error" ? "Fix the error on the left to see the diagram." : render.kind === "idle" && !code.trim() ? "Type Mermaid on the left, or pick a template." : <Loader size={18} className="animate-spin text-accent" />}
                </div>
              )}
            </div>
            <p className="border-t border-edge px-3 py-1.5 text-[11.5px] text-faint">{tool === "select" ? "Drag to pan · pinch or ⌘/Ctrl + scroll to zoom · double-click to fit · click an annotation to edit it, drag to move, Delete to remove." : TOOLS.find((t) => t.id === tool)?.hint + " · Esc to cancel."}</p>
          </div>
        )}

        {cheat && (
          <div className="panel max-h-[640px] overflow-auto p-3 text-[12px]">
            {CHEATSHEET.map((s) => (
              <div key={s.title} className="mb-3">
                <div className="readout mb-1">{s.title}</div>
                <dl className="space-y-1">
                  {s.rows.map(([k, v]) => (
                    <div key={k}>
                      <dt className="font-mono text-[11.5px] text-ink">{k}</dt>
                      <dd className="text-faint">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
            <a href="https://mermaid.js.org/intro/syntax-reference.html" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              Full syntax reference ↗
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
