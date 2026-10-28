"use client";

/**
 * The Organise panel: every page as a tile to select, drag into a new order, rotate, delete, duplicate, crop,
 * extract or split, with blank pages and other PDFs slotted in between.
 */
import { useRef, useState, type DragEvent } from "react";
import { Copy, Crop, FilePlus2, FileUp, RotateCcw, RotateCw, Scissors, SquareDashed, Trash2 } from "lucide-react";
import { ThumbTile, type ThumbsApi } from "./pdf-sidebar";
import { formatPageRanges, parsePageRanges } from "@/lib/tools/files/pdf/ranges";
import { cn } from "@/lib/utils";

export interface PagesActions {
  onRotate(pages: number[], delta: 90 | -90): void;
  onDelete(pages: number[]): void;
  onDuplicate(pages: number[]): void;
  onBlank(at: number): void;
  onInsertPdf(at: number): void;
  onExtract(pages: number[]): void;
  onSplit(): void;
  onCrop(pages: number[]): void;
  onMove(order: number[]): void;
}

const BTN = "inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] border border-edge px-2 text-[12px] text-muted transition-colors hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40";

export function PagesPanel({ count, ratios, current, sizes, thumbs, selected, onSelected, onGoTo, busy, actions, pageLabel }: { count: number; ratios: number[]; current: number; sizes: string[]; thumbs: ThumbsApi; selected: Set<number>; onSelected(next: Set<number>): void; onGoTo(page: number): void; busy: boolean; actions: PagesActions; pageLabel(index: number): string }) {
  // The range field shows the selection until it is typed in; a new selection clears what was typed.
  const [rangeDraft, setRangeDraft] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [prevSelected, setPrevSelected] = useState(selected);
  if (prevSelected !== selected) {
    setPrevSelected(selected);
    setRangeDraft(null);
    setRangeError(null);
  }
  const [drag, setDrag] = useState<{ pages: number[]; over: number | null; before: boolean } | null>(null);
  const anchor = useRef<number | null>(null);
  const sel = [...selected].sort((a, b) => a - b);
  const pages = sel.length ? sel : current >= 1 ? [current - 1] : [];
  const noun = sel.length > 1 ? `${sel.length} pages` : sel.length === 1 ? `page ${sel[0] + 1}` : `page ${current}`;
  const range = rangeDraft ?? (sel.length ? formatPageRanges(sel.map((i) => i + 1)) : "");
  const setRange = setRangeDraft;

  const click = (i: number, e: React.MouseEvent) => {
    const next = new Set(selected);
    if (e.shiftKey && anchor.current !== null) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
      for (let k = a; k <= b; k++) next.add(k);
    } else if (e.metaKey || e.ctrlKey) {
      if (next.has(i)) next.delete(i);
      else next.add(i);
      anchor.current = i;
    } else {
      next.clear();
      next.add(i);
      anchor.current = i;
      onGoTo(i + 1);
    }
    onSelected(next);
  };

  const applyRange = () => {
    const r = parsePageRanges(range, count);
    if (!r.ok) {
      setRangeError(r.error);
      return;
    }
    setRangeError(null);
    onSelected(new Set(r.pages.map((p) => p - 1)));
  };

  const onDragStart = (i: number) => (e: DragEvent) => {
    const moving = selected.has(i) ? [...selected].sort((a, b) => a - b) : [i];
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", moving.join(","));
    setDrag({ pages: moving, over: null, before: true });
  };
  const onDragOver = (i: number) => (e: DragEvent) => {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const before = e.clientX < r.left + r.width / 2;
    if (drag.over !== i || drag.before !== before) setDrag({ ...drag, over: i, before });
  };
  const onDrop = (i: number) => (e: DragEvent) => {
    e.preventDefault();
    if (!drag) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const before = e.clientX < r.left + r.width / 2;
    const moving = new Set(drag.pages);
    const rest = Array.from({ length: count }, (_, k) => k).filter((k) => !moving.has(k));
    let slot = rest.indexOf(i);
    if (slot < 0) {
      // dropped on a page being moved: keep the order
      setDrag(null);
      return;
    }
    if (!before) slot += 1;
    const order = [...rest.slice(0, slot), ...drag.pages, ...rest.slice(slot)];
    setDrag(null);
    if (order.some((v, k) => v !== k)) {
      actions.onMove(order);
      onSelected(new Set(drag.pages.map((_, k) => slot + k)));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-pages-panel>
      <div className="space-y-1.5 border-b border-edge px-2.5 py-2">
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" className={BTN} disabled={busy || !pages.length} onClick={() => actions.onRotate(pages, -90)} title={`Rotate ${noun} left`} data-pages-rotate-left>
            <RotateCcw size={13} />
          </button>
          <button type="button" className={BTN} disabled={busy || !pages.length} onClick={() => actions.onRotate(pages, 90)} title={`Rotate ${noun} right`} data-pages-rotate-right>
            <RotateCw size={13} />
          </button>
          <button type="button" className={BTN} disabled={busy || !pages.length} onClick={() => actions.onDuplicate(pages)} title={`Duplicate ${noun}`} data-pages-duplicate>
            <Copy size={13} />
          </button>
          <button type="button" className={BTN} disabled={busy || !pages.length || pages.length >= count} onClick={() => actions.onDelete(pages)} title={`Delete ${noun}`} data-pages-delete>
            <Trash2 size={13} />
          </button>
          <button type="button" className={BTN} disabled={busy || !pages.length} onClick={() => actions.onCrop(pages)} title={`Crop ${noun}…`} data-pages-crop>
            <Crop size={13} />
          </button>
          <span className="mx-0.5 h-5 w-px bg-edge" />
          <button type="button" className={BTN} disabled={busy} onClick={() => actions.onBlank(pages.length ? pages[pages.length - 1] + 1 : count)} title="Insert a blank page after the selection" data-pages-blank>
            <SquareDashed size={13} />
          </button>
          <button type="button" className={BTN} disabled={busy} onClick={() => actions.onInsertPdf(pages.length ? pages[pages.length - 1] + 1 : count)} title="Insert the pages of another PDF after the selection (merge)" data-pages-insert>
            <FileUp size={13} />
          </button>
          <span className="mx-0.5 h-5 w-px bg-edge" />
          <button type="button" className={BTN} disabled={busy || !pages.length} onClick={() => actions.onExtract(pages)} title={`Extract ${noun} to a new PDF`} data-pages-extract>
            <FilePlus2 size={13} /> Extract
          </button>
          <button type="button" className={BTN} disabled={busy || count < 2} onClick={actions.onSplit} title="Split the document into several files…" data-pages-split>
            <Scissors size={13} /> Split
          </button>
        </div>
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            applyRange();
          }}
        >
          <input value={range} onChange={(e) => setRange(e.target.value)} placeholder="Select pages: 1-3, 5, 8-" className="input h-7 flex-1 px-2 py-0 text-[12px]" aria-label="Pages to select" data-pages-range />
          <button type="submit" className={cn(BTN, "h-7")} data-pages-range-apply>
            Select
          </button>
          {sel.length > 0 && (
            <button type="button" onClick={() => onSelected(new Set())} className={cn(BTN, "h-7")}>
              Clear
            </button>
          )}
        </form>
        <p className="text-[11px] text-faint">{rangeError ? <span className="text-danger">{rangeError}</span> : `${sel.length ? `${sel.length} selected · ` : ""}Click selects, ⇧ a run, ⌘ adds; drag tiles to reorder.`}</p>
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto p-2"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "a") {
            e.preventDefault();
            onSelected(new Set(Array.from({ length: count }, (_, i) => i)));
          } else if ((e.key === "Delete" || e.key === "Backspace") && sel.length && sel.length < count && !busy) {
            e.preventDefault();
            actions.onDelete(sel);
          }
        }}
        tabIndex={0}
        data-pages-grid
      >
        <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-3">
          {Array.from({ length: count }, (_, i) => {
            const isSel = selected.has(i);
            const dropBefore = drag?.over === i && drag.before;
            const dropAfter = drag?.over === i && !drag.before;
            return (
              <div key={i} className="relative" draggable={!busy} onDragStart={onDragStart(i)} onDragOver={onDragOver(i)} onDrop={onDrop(i)} onDragEnd={() => setDrag(null)} data-page-tile={i + 1} data-selected={isSel || undefined}>
                {dropBefore && <span className="absolute -left-1.5 top-0 h-[calc(100%-18px)] w-0.5 rounded bg-accent" aria-hidden />}
                {dropAfter && <span className="absolute -right-1.5 top-0 h-[calc(100%-18px)] w-0.5 rounded bg-accent" aria-hidden />}
                <ThumbTile index={i} label={`${pageLabel(i)}${sizes[i] ? ` · ${sizes[i]}` : ""}`} ratio={ratios[i] ?? 0.773} thumbs={thumbs} active={isSel} onClick={undefined} className={cn(drag?.pages.includes(i) && "opacity-40")}>
                  <span
                    role="checkbox"
                    aria-checked={isSel}
                    aria-label={`Select page ${i + 1}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      click(i, e);
                    }}
                    className="absolute inset-0 cursor-pointer rounded-[var(--radius-sm)]"
                  />
                  {isSel && <span className="pointer-events-none absolute left-1 top-1 rounded bg-accent px-1 text-[10px] font-semibold text-on-accent">{sel.indexOf(i) + 1}</span>}
                </ThumbTile>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
