"use client";

/**
 * Editing a page's own text in place: the index of lines built from pdf.js's operator list (lib/tools/files/pdf/
 * textruns.ts), kept per page and rebuilt when the document changes, and the layer that shows the lines over the
 * page, turns one into an input on click, and takes new text on a click in empty space.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { loadPdfJs } from "@/lib/tools/files/pdf/pdfjs";
import { buildTextIndex, fontInfoFrom, lineBounds, mergeGlyphMaps, type FontInfo, type GlyphEntry, type PageTextIndex, type TextLine } from "@/lib/tools/files/pdf/textruns";
import type { PageBox } from "./pdf-overlays";
import { cn } from "@/lib/utils";

export interface TextIndexApi {
  get(page: number): PageTextIndex | null;
  ensure(page: number): Promise<PageTextIndex | null>;
  /** Characters available per font across every page indexed so far. */
  glyphs(): Map<string, Map<string, GlyphEntry>>;
  failed(page: number): string | null;
  /** Bumps when an index arrives. */
  tick: number;
}

interface Store {
  key: string;
  pages: Map<number, PageTextIndex>;
  pending: Map<number, Promise<PageTextIndex | null>>;
  failed: Map<number, string>;
  glyphs: Map<string, Map<string, GlyphEntry>>;
}

const newStore = (key: string): Store => ({ key, pages: new Map(), pending: new Map(), failed: new Map(), glyphs: new Map() });

/** Builds and caches the text index of pages; when `eager`, works through the whole document in the background. */
export function useTextIndex(pdf: PDFDocumentProxy | null, version: number, eager: boolean): TextIndexApi {
  // One store per document version, made on first use (never touched while rendering).
  const stores = useRef<Store | null>(null);
  const [tick, setTick] = useState(0);
  const key = pdf ? `${version}:${pdf.fingerprints?.[0] ?? ""}` : "";
  const storeFor = useCallback((): Store => {
    if (!stores.current || stores.current.key !== key) stores.current = newStore(key);
    return stores.current;
  }, [key]);

  const ensure = useCallback(
    async (page: number): Promise<PageTextIndex | null> => {
      const s = storeFor();
      if (!pdf || page < 0 || page >= pdf.numPages) return null;
      const hit = s.pages.get(page);
      if (hit) return hit;
      const pending = s.pending.get(page);
      if (pending) return pending;
      const p = (async () => {
        try {
          const idx = await indexPage(pdf, page);
          if (stores.current !== s) return null;
          s.pages.set(page, idx);
          mergeGlyphMaps(s.glyphs, idx.glyphs);
          setTick((t) => t + 1);
          return idx;
        } catch (e) {
          if (stores.current === s) {
            s.failed.set(page, e instanceof Error ? e.message : String(e));
            setTick((t) => t + 1);
          }
          return null;
        } finally {
          s.pending.delete(page);
        }
      })();
      s.pending.set(page, p);
      return p;
    },
    [pdf, storeFor],
  );

  // Background pass over the document so every font's characters are known (and lines appear without delay).
  useEffect(() => {
    if (!eager || !pdf) return;
    let stop = false;
    const limit = Math.min(pdf.numPages, 400);
    const run = async () => {
      for (let p = 0; p < limit && !stop; p++) {
        const s = storeFor();
        if (s.pages.has(p) || s.failed.has(p)) continue;
        await ensure(p);
        await new Promise((r) => setTimeout(r, 15));
      }
    };
    const t = setTimeout(() => void run(), 300);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [eager, pdf, version, ensure, storeFor]);

  return {
    get: (page) => storeFor().pages.get(page) ?? null,
    ensure,
    glyphs: () => storeFor().glyphs,
    failed: (page) => storeFor().failed.get(page) ?? null,
    tick,
  };
}

async function indexPage(pdf: PDFDocumentProxy, pageIndex: number): Promise<PageTextIndex> {
  const { api } = await loadPdfJs();
  const page = await pdf.getPage(pageIndex + 1);
  const list = await page.getOperatorList({ annotationMode: api.AnnotationMode.DISABLE });
  const OPS = api.OPS as unknown as Record<string, number>;
  const keys = new Set<string>();
  for (let i = 0; i < list.fnArray.length; i++) if (list.fnArray[i] === OPS.setFont) keys.add(String((list.argsArray[i] as unknown[])[0]));
  const fonts = new Map<string, FontInfo>();
  const objs = page.commonObjs as unknown as { get(id: string, cb?: (v: unknown) => void): unknown; has(id: string): boolean };
  await Promise.all(
    [...keys].map(
      (k) =>
        new Promise<void>((resolve) => {
          const done = (v: unknown) => {
            fonts.set(k, fontInfoFrom(k, (v && typeof v === "object" ? v : null) as Record<string, unknown> | null));
            resolve();
          };
          try {
            objs.get(k, done);
          } catch {
            done(null);
          }
          // A font that never arrives must not hold the page hostage.
          setTimeout(() => {
            if (!fonts.has(k)) done(null);
          }, 4000);
        }),
    ),
  );
  return buildTextIndex(pageIndex, OPS as never, list.fnArray, list.argsArray, fonts);
}

/* --------------------------------------------------------------- layer */

export interface TextEditState {
  lineId: string;
  text: string;
}

export interface AddTextState {
  page: number;
  /** CSS pixels inside the page box. */
  x: number;
  y: number;
  text: string;
}

export function lineCss(line: TextLine, viewport: PageBox["viewport"]): { left: number; top: number; width: number; height: number; fontSize: number } {
  const b = lineBounds(line);
  const a = viewport.convertToViewportPoint(b.x0, b.y0), c = viewport.convertToViewportPoint(b.x1, b.y1);
  const left = Math.min(a[0], c[0]), top = Math.min(a[1], c[1]);
  const vertical = Math.hypot(line.matrix[2], line.matrix[3]);
  return { left, top, width: Math.abs(c[0] - a[0]), height: Math.abs(c[1] - a[1]), fontSize: Math.abs(line.fontSize) * vertical * viewport.scale };
}

const family = (l: TextLine) => (l.font.family === "serif" ? "Georgia, 'Times New Roman', serif" : l.font.family === "mono" ? "'Courier New', monospace" : "Arial, Helvetica, sans-serif");

export function TextEditLayer({
  boxes,
  index,
  edit,
  add,
  addStyle,
  onStart,
  onEditText,
  onCommit,
  onCancel,
  onAddAt,
  onAddText,
  onAddCommit,
  busy,
}: {
  boxes: PageBox[];
  index: TextIndexApi;
  edit: TextEditState | null;
  add: AddTextState | null;
  addStyle: { size: number; color: string; family: "sans" | "serif" | "mono"; bold: boolean; italic: boolean };
  onStart(line: TextLine): void;
  onEditText(text: string): void;
  onCommit(): void;
  onCancel(): void;
  onAddAt(page: number, x: number, y: number): void;
  onAddText(text: string): void;
  onAddCommit(): void;
  busy: boolean;
}) {
  // Pages in view get their index built as they appear.
  useEffect(() => {
    for (const b of boxes) if (b.rendered && !index.get(b.index) && !index.failed(b.index)) void index.ensure(b.index);
  }, [boxes, index]);
  // A pointer going down anywhere but the open input commits it (a blur would also fire when the viewer takes focus).
  useEffect(() => {
    if (!edit && !add) return;
    const onDown = (ev: PointerEvent) => {
      const t = ev.target as Element | null;
      if (edit && !t?.closest("[data-text-input]")) onCommit();
      if (add && !t?.closest("[data-add-text-input]")) onAddCommit();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [edit, add, onCommit, onAddCommit]);
  return (
    <>
      {boxes.map((b) => {
        const idx = index.get(b.index);
        const failed = index.failed(b.index);
        return (
          <div
            key={b.index}
            className="pointer-events-auto absolute cursor-text"
            style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
            data-textedit-page={b.index + 1}
            onPointerDown={(e) => {
              if (e.target !== e.currentTarget || e.button !== 0) return;
              // An open editor was just committed by the document listener; this click starts a new line.
              if (edit || add) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              onAddAt(b.index, e.clientX - r.left, e.clientY - r.top);
            }}
          >
            {!idx && !failed && <span className="pointer-events-none absolute left-2 top-2 rounded bg-base/80 px-1.5 py-0.5 text-[11px] text-faint">Reading the text…</span>}
            {failed && <span className="pointer-events-none absolute left-2 top-2 rounded bg-base/80 px-1.5 py-0.5 text-[11px] text-danger">This page&apos;s text could not be indexed.</span>}
            {idx?.lines
              .filter((l) => !l.hidden && l.segments.length)
              .map((l) => {
                const css = lineCss(l, b.viewport);
                if (css.width < 1 || css.height < 1) return null;
                const active = edit?.lineId === l.id;
                if (active) {
                  return (
                    <LineInput key={l.id} line={l} css={css} value={edit.text} onChange={onEditText} onCommit={onCommit} onCancel={onCancel} busy={busy} />
                  );
                }
                return (
                  <div
                    key={l.id}
                    className={cn("absolute rounded-[2px] border border-transparent", l.editable ? "hover:border-accent hover:bg-accent/5" : "cursor-not-allowed hover:border-faint")}
                    style={{ left: css.left - 2, top: css.top - 1, width: css.width + 4, height: css.height + 2 }}
                    title={l.editable ? (l.inXObject ? "Edit this text (it lives in a shared graphic: every place that uses it changes)" : "Click to edit this line") : l.reason}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (e.button !== 0) return;
                      // Keep the focus from jumping to the viewer (the input focuses itself on mount).
                      e.preventDefault();
                      if (l.editable) onStart(l);
                    }}
                    data-text-line={l.id}
                    data-text-editable={l.editable || undefined}
                  />
                );
              })}
            {add?.page === b.index && (
              <input
                autoFocus
                value={add.text}
                onChange={(e) => onAddText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onAddCommit();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    onCancel();
                  }
                }}
                onPointerDown={(e) => e.stopPropagation()}
                placeholder="Type, then Enter"
                className="absolute min-w-40 rounded-[2px] border border-accent bg-base/90 px-1 text-ink outline-none"
                style={{ left: add.x, top: add.y - addStyle.size * b.viewport.scale, fontSize: addStyle.size * b.viewport.scale, lineHeight: 1.2, color: addStyle.color, fontFamily: addStyle.family === "serif" ? "Georgia, serif" : addStyle.family === "mono" ? "'Courier New', monospace" : "Arial, sans-serif", fontWeight: addStyle.bold ? 700 : 400, fontStyle: addStyle.italic ? "italic" : "normal" }}
                data-add-text-input
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function LineInput({ line, css, value, onChange, onCommit, onCancel, busy }: { line: TextLine; css: ReturnType<typeof lineCss>; value: string; onChange(v: string): void; onCommit(): void; onCancel(): void; busy: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focus = () => {
      ref.current?.focus();
      ref.current?.select();
    };
    focus();
    const t = setTimeout(focus, 60);
    return () => clearTimeout(t);
  }, []);
  return (
    <input
      ref={ref}
      value={value}
      disabled={busy}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute z-10 rounded-[2px] border border-accent bg-base px-0.5 text-ink shadow-pop outline-none"
      style={{ left: css.left - 3, top: css.top - 2, minWidth: css.width + 8, height: css.height + 4, fontSize: css.fontSize, lineHeight: `${css.height + 4}px`, fontFamily: family(line), fontWeight: line.font.bold ? 700 : 400, fontStyle: line.font.italic ? "italic" : "normal", color: line.color ?? undefined, width: Math.max(css.width + 8, value.length * css.fontSize * 0.6) }}
      data-text-input
      aria-label="Edit this line of text"
    />
  );
}
