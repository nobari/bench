"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQueryState, parseAsString } from "nuqs";
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { AlertTriangle, Columns2, Download, Eye, Loader, Maximize2, Minus, PanelLeft, Pencil, Plus, Printer, RotateCcw, Trash2 } from "lucide-react";
import type { MermaidConfig } from "mermaid";
import { CHEATSHEET, DEFAULT_TEMPLATE, TEMPLATES, detectType, diagramTitle, markdownFence, printableHtml, standaloneSvg, svgToPng, PAPER_SIZES, type PaperSize } from "@/lib/tools/web/mermaid";
import { CopyButton } from "@/components/copy-button";
import { SHARE_SYNC_EVENT } from "@/components/share-button";
import { cn } from "@/lib/utils";

const DRAFT_KEY = "bench:mermaid:draft";
const THEMES = [
  ["default", "Default"],
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
function readInitial(): { code: string; source: "link" | "draft" | "template" } {
  if (typeof window === "undefined") return { code: DEFAULT_TEMPLATE.code, source: "template" };
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const h = hash.get("i");
  if (h) {
    try {
      const d = decompressFromEncodedURIComponent(h);
      if (d) return { code: d, source: "link" };
    } catch {
      /* fall through */
    }
  }
  const q = new URLSearchParams(window.location.search).get("i");
  if (q) return { code: q, source: "link" };
  try {
    const draft = localStorage.getItem(DRAFT_KEY);
    if (draft?.trim()) return { code: draft, source: "draft" };
  } catch {
    /* storage unavailable */
  }
  return { code: DEFAULT_TEMPLATE.code, source: "template" };
}

function download(blob: Blob | string, name: string, type = "text/plain") {
  const url = URL.createObjectURL(typeof blob === "string" ? new Blob([blob], { type }) : blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Render = { kind: "idle" } | { kind: "ok"; svg: string; type: string } | { kind: "error"; message: string; line: number | null };

export function MermaidEditorWidget() {
  const [initial] = useState(readInitial);
  const [code, setCode] = useState(initial.code);
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
        const config: MermaidConfig = { startOnLoad: false, securityLevel: "strict", theme: themeId, look: handDrawn ? "handDrawn" : "classic", fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif" };
        mermaid.initialize(config);
        await mermaid.parse(deferred);
        const { svg } = await mermaid.render(`bench-mermaid-${id}`, deferred);
        if (!active || id !== seq.current) return;
        setRender({ kind: "ok", svg, type: detectType(deferred) });
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
      } catch {
        /* storage unavailable */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [code]);
  useEffect(() => {
    const sync = () => {
      const h = new URLSearchParams();
      if (code.trim() && code !== DEFAULT_TEMPLATE.code) h.set("i", compressToEncodedURIComponent(code));
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${h.size ? `#${h}` : ""}`);
    };
    window.addEventListener(SHARE_SYNC_EVENT, sync);
    return () => window.removeEventListener(SHARE_SYNC_EVENT, sync);
  }, [code]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  const svg = render.kind === "ok" ? render.svg : lastGood;
  const svgDoc = useMemo(() => (svg ? standaloneSvg(svg) : ""), [svg]);

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

  const print = () => {
    if (!svg) return;
    const w = window.open("", "_blank");
    if (!w) {
      setNotice("Allow pop-ups to print.");
      return;
    }
    w.document.write(printableHtml(title || type, svg, { paper, includeSource: printSource, source: code }));
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 350);
  };

  const exportPng = async (scale: number) => {
    if (!svg) return;
    setBusy("png");
    try {
      download(await svgToPng(svg, scale, themeId === "dark" ? "#1f2020" : "#ffffff"), `${fileBase}@${scale}x.png`);
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
      const blob = await svgToPng(svg, 2, themeId === "dark" ? "#1f2020" : "#ffffff");
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
    fit();
  };

  const lines = code.split("\n").length;
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
        <CopyButton value={markdownFence(code)} label="Copy Markdown" className="h-8 px-2.5 text-[12.5px]" />
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
          <div className="panel flex min-w-0 flex-col">
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
                <button type="button" onClick={fit} aria-label="Reset zoom" title="Fit" className={ICON}>
                  <Maximize2 size={13} />
                </button>
              </div>
            </div>
            <div
              ref={hostRef}
              data-zoom={zoom}
              className={cn("relative min-h-[420px] flex-1 overflow-hidden rounded-b-[var(--radius)]", themeId === "dark" ? "bg-[#1f2020]" : "bg-white")}
              style={{ backgroundImage: themeId === "dark" ? undefined : "radial-gradient(rgba(0,0,0,0.08) 1px, transparent 1px)", backgroundSize: "16px 16px", cursor: "grab", touchAction: "none" }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = { x: e.clientX, y: e.clientY, pan };
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (d) setPan({ x: d.pan.x + e.clientX - d.x, y: d.pan.y + e.clientY - d.y });
              }}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
              onDoubleClick={fit}
            >
              {svg ? (
                <div
                  className="absolute left-1/2 top-1/2 [&>svg]:block"
                  style={{ transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center center" }}
                  // Mermaid output is rendered with securityLevel "strict", which escapes labels and strips scripts.
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              ) : (
                <div className="flex h-full min-h-[420px] items-center justify-center p-6 text-center text-[13.5px] text-muted">
                  {render.kind === "error" ? "Fix the error on the left to see the diagram." : render.kind === "idle" && !code.trim() ? "Type Mermaid on the left, or pick a template." : <Loader size={18} className="animate-spin text-accent" />}
                </div>
              )}
            </div>
            <p className="border-t border-edge px-3 py-1.5 text-[11.5px] text-faint">Drag to pan · pinch or ⌘/Ctrl + scroll to zoom · double-click to fit.</p>
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
