"use client";

/**
 * Layers drawn over pdf.js's pages: where each page sits in the scrolling container (kept fresh as the viewer
 * renders, zooms and rotates), a rectangle drawn with the pointer, the crop tool and the redaction marks.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { Check, X } from "lucide-react";
import type { PageViewport, PdfViewerApi } from "./pdf-viewer";
import { BTN, PRIMARY } from "./pdf-ui";
import { cn } from "@/lib/utils";

export interface PageBox {
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
  viewport: PageViewport;
  rendered: boolean;
}

/** A rectangle in CSS pixels inside a page box. */
export interface CssRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** [x0, y0, x1, y1] in PDF user space. */
export type PdfBox = [number, number, number, number];

export function cssToPdf(viewport: PageViewport, r: CssRect): PdfBox {
  const a = viewport.convertToPdfPoint(r.x, r.y), b = viewport.convertToPdfPoint(r.x + r.w, r.y + r.h);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

export function pdfToCss(viewport: PageViewport, box: PdfBox): CssRect {
  const a = viewport.convertToViewportPoint(box[0], box[1]), b = viewport.convertToViewportPoint(box[2], box[3]);
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
}

/** Where the pages are, relative to the overlay root (the container's content origin). */
export function usePageBoxes(api: RefObject<PdfViewerApi | null>, active: boolean, version: number): PageBox[] {
  const [boxes, setBoxes] = useState<PageBox[]>([]);
  const frame = useRef(0);
  const compute = useCallback(() => {
    const a = api.current;
    const container = a?.container();
    if (!a || !container) return;
    const cr = container.getBoundingClientRect();
    const out: PageBox[] = [];
    for (const v of a.pages()) {
      const el = v.div.querySelector<HTMLElement>(".canvasWrapper") ?? v.div;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      out.push({ index: v.index, left: r.left - cr.left + container.scrollLeft, top: r.top - cr.top + container.scrollTop, width: r.width, height: r.height, viewport: v.viewport, rendered: v.rendered });
    }
    setBoxes(out);
  }, [api]);
  useEffect(() => {
    if (!active) return;
    const schedule = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(compute);
    };
    schedule();
    const a = api.current;
    const offs = ["pagerendered", "scalechanging", "rotationchanging", "updateviewarea", "pagesloaded", "pagesinit", "scrollmodechanged", "spreadmodechanged", "textlayerrendered"].map((ev) => a?.on(ev, schedule) ?? (() => {}));
    window.addEventListener("resize", schedule);
    const container = a?.container();
    const ro = container && typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    if (container && ro) ro.observe(container);
    const poll = setInterval(schedule, 1500);
    return () => {
      cancelAnimationFrame(frame.current);
      offs.forEach((off) => off());
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
      clearInterval(poll);
    };
  }, [active, version, api, compute]);
  return active ? boxes : EMPTY;
}

const EMPTY: PageBox[] = [];

/* --------------------------------------------------------------- drag */

export function useDragRect(onDone: (page: PageBox, rect: CssRect) => void) {
  const [drag, setDrag] = useState<{ page: number; x0: number; y0: number; x1: number; y1: number } | null>(null);
  const start = (page: PageBox) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.setPointerCapture(e.pointerId);
    const x = e.clientX - r.left, y = e.clientY - r.top;
    setDrag({ page: page.index, x0: x, y0: y, x1: x, y1: y });
    e.preventDefault();
  };
  const move = (page: PageBox) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || drag.page !== page.index) return;
    const r = e.currentTarget.getBoundingClientRect();
    setDrag({ ...drag, x1: Math.max(0, Math.min(r.width, e.clientX - r.left)), y1: Math.max(0, Math.min(r.height, e.clientY - r.top)) });
  };
  const end = (page: PageBox) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || drag.page !== page.index) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const rect = rectOf(drag);
    setDrag(null);
    if (rect.w >= 4 && rect.h >= 4) onDone(page, rect);
  };
  const rect = drag ? rectOf(drag) : null;
  return { drag, rect, start, move, end };
}

const rectOf = (d: { x0: number; y0: number; x1: number; y1: number }): CssRect => ({ x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) });

const pageStyle = (b: PageBox) => ({ left: b.left, top: b.top, width: b.width, height: b.height });

const mm = (pt: number) => `${Math.round((pt / 72) * 25.4)} mm`;

/* --------------------------------------------------------------- crop */

export function CropLayer({ boxes, onCrop }: { boxes: PageBox[]; onCrop(pages: "one" | "all", page: number, box: PdfBox): void }) {
  const [pending, setPending] = useState<{ page: number; rect: CssRect; box: PdfBox } | null>(null);
  const { drag, rect, start, move, end } = useDragRect((page, r) => setPending({ page: page.index, rect: r, box: cssToPdf(page.viewport, r) }));
  return (
    <>
      {boxes.map((b) => {
        const live = drag?.page === b.index ? rect : null;
        const held = pending?.page === b.index ? pending : null;
        const shown = live ?? (held ? pdfToCss(b.viewport, held.box) : null);
        return (
          <div key={b.index} className="pointer-events-auto absolute cursor-crosshair touch-none" style={pageStyle(b)} onPointerDown={start(b)} onPointerMove={move(b)} onPointerUp={end(b)} onPointerCancel={() => undefined} data-crop-page={b.index + 1}>
            {shown && (
              <>
                <div className="pointer-events-none absolute inset-0 bg-black/35" style={{ clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${shown.x}px ${shown.y}px, ${shown.x}px ${shown.y + shown.h}px, ${shown.x + shown.w}px ${shown.y + shown.h}px, ${shown.x + shown.w}px ${shown.y}px, ${shown.x}px ${shown.y}px)` }} />
                <div className="pointer-events-none absolute border-2 border-accent" style={{ left: shown.x, top: shown.y, width: shown.w, height: shown.h }} />
              </>
            )}
            {held && !live && (
              <div className="absolute z-10 flex items-center gap-1 rounded-[var(--radius-sm)] border border-edge bg-base p-1 shadow-pop" style={{ left: Math.max(0, Math.min(b.width - 300, held.rect.x)), top: Math.min(b.height - 40, held.rect.y + held.rect.h + 6) }} onPointerDown={(e) => e.stopPropagation()} data-crop-bar>
                <span className="px-1 text-[11.5px] tabular text-muted">
                  {mm(held.box[2] - held.box[0])} × {mm(held.box[3] - held.box[1])}
                </span>
                <button type="button" className={PRIMARY} onClick={() => { onCrop("one", held.page, held.box); setPending(null); }} data-crop-one>
                  <Check size={12} /> Crop page {held.page + 1}
                </button>
                <button type="button" className={BTN} onClick={() => { onCrop("all", held.page, held.box); setPending(null); }} data-crop-all>
                  All pages
                </button>
                <button type="button" className={cn(BTN, "px-1.5")} onClick={() => setPending(null)} aria-label="Cancel">
                  <X size={12} />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------ redaction */

export interface RedactMark {
  id: string;
  page: number;
  box: PdfBox;
}

export function RedactLayer({ boxes, marks, onMark, onUnmark }: { boxes: PageBox[]; marks: RedactMark[]; onMark(page: number, box: PdfBox): void; onUnmark(id: string): void }) {
  const { drag, rect, start, move, end } = useDragRect((page, r) => onMark(page.index, cssToPdf(page.viewport, r)));
  return (
    <>
      {boxes.map((b) => {
        const live = drag?.page === b.index ? rect : null;
        return (
          <div key={b.index} className="pointer-events-auto absolute cursor-crosshair touch-none" style={pageStyle(b)} onPointerDown={start(b)} onPointerMove={move(b)} onPointerUp={end(b)} data-redact-page={b.index + 1}>
            {marks
              .filter((m) => m.page === b.index)
              .map((m) => {
                const r = pdfToCss(b.viewport, m.box);
                return (
                  <div key={m.id} className="group absolute border border-danger bg-black/80" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} data-redact-mark={m.id} onPointerDown={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => onUnmark(m.id)} className="absolute -right-2 -top-2 hidden h-4 w-4 items-center justify-center rounded-full border border-edge bg-base text-faint hover:text-danger group-hover:flex" aria-label="Remove this mark" title="Remove this mark">
                      <X size={10} />
                    </button>
                  </div>
                );
              })}
            {live && <div className="pointer-events-none absolute border border-danger bg-danger/20" style={{ left: live.x, top: live.y, width: live.w, height: live.h }} />}
          </div>
        );
      })}
    </>
  );
}
