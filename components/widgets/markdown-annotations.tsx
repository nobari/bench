"use client";

import { useEffect, useRef } from "react";
import { Check, Highlighter, MessageSquarePlus, Trash2, Undo2, X } from "lucide-react";
import { MARK_COLORS, MARK_LABELS, type MarkColor, type MdAnnotation, type Placed } from "@/lib/tools/text/annotations";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

/** Where a popover sits: pixels from the top-left of the preview's scrolling content. */
export interface PopoverPos {
  top: number;
  left: number;
}

/** The solid version of each mark colour, for dots, numbers and the panel. */
export const MARK_SOLID: Record<MarkColor, string> = { yellow: "#facc15", red: "#f87171", green: "#4ade80", blue: "#60a5fa" };

const POPOVER = "absolute z-20 flex items-center gap-1 rounded-[var(--radius)] border border-edge bg-base p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.18)]";
const ICON = "flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-muted transition-colors hover:bg-raised hover:text-ink";

/** Clamps a centred popover of about `width` px inside the preview. */
export function clampPos(pos: PopoverPos, width: number, boxWidth: number): PopoverPos {
  const half = Math.min(width, boxWidth - 16) / 2;
  return { top: Math.max(4, pos.top), left: Math.min(Math.max(pos.left, 8 + half), Math.max(8 + half, boxWidth - 8 - half)) };
}

export function MarkPalette({ value, onPick, verb = "Highlight" }: { value?: MarkColor; onPick: (c: MarkColor) => void; verb?: string }) {
  return (
    <div className="flex items-center gap-1 px-0.5" role="group" aria-label="Colour">
      {MARK_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onPick(c)}
          title={`${verb} in ${MARK_LABELS[c].toLowerCase()}`}
          aria-label={`${verb} in ${MARK_LABELS[c].toLowerCase()}`}
          aria-pressed={value === c}
          data-mark-color={c}
          className={cn("h-5 w-5 rounded-full border border-black/15 transition-transform hover:scale-110", value === c && "ring-2 ring-accent ring-offset-1 ring-offset-[var(--color-base)]")}
          style={{ background: MARK_SOLID[c] }}
        />
      ))}
    </div>
  );
}

/** Offered over a fresh selection: a colour to highlight it in, or a comment on it. */
export function CreateAnnotationPopover({ pos, color, onCreate }: { pos: PopoverPos; color: MarkColor; onCreate: (color: MarkColor, withNote: boolean) => void }) {
  return (
    <div className={cn(POPOVER, "-translate-x-1/2")} style={{ top: pos.top, left: pos.left }} data-ann-popover="create" onMouseDown={(e) => e.preventDefault()}>
      <Highlighter size={14} className="ml-1 text-faint" aria-hidden />
      <MarkPalette value={color} onPick={(c) => onCreate(c, false)} />
      <span className="mx-0.5 h-5 w-px bg-edge" />
      <button type="button" onClick={() => onCreate(color, true)} className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-[12px] text-muted hover:bg-raised hover:text-ink" title="Highlight and leave a comment" data-ann-comment>
        <MessageSquarePlus size={14} /> Comment
      </button>
    </div>
  );
}

/** The selected annotation: its colour, comment, resolved state, and the way out. */
export function AnnotationEditor({
  pos,
  annotation,
  number,
  lost,
  autoFocus,
  onChange,
  onDelete,
  onClose,
}: {
  pos: PopoverPos;
  annotation: MdAnnotation;
  number: number;
  lost: boolean;
  autoFocus: boolean;
  onChange: (patch: Partial<MdAnnotation>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus, annotation.id]);
  return (
    <div className={cn(POPOVER, "w-[min(320px,calc(100%-16px))] -translate-x-1/2 flex-col items-stretch gap-1.5 p-2")} style={{ top: pos.top, left: pos.left }} data-ann-popover="edit" role="dialog" aria-label={`Annotation ${number}`}>
      <div className="flex items-center gap-1.5">
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold text-[#1e2419]" style={{ background: MARK_SOLID[annotation.color] }}>
          {number}
        </span>
        <MarkPalette value={annotation.color} onPick={(color) => onChange({ color })} verb="Colour" />
        <span className="ml-auto" />
        <button type="button" onClick={() => onChange({ done: !annotation.done })} className={cn(ICON, annotation.done && "text-positive")} title={annotation.done ? "Reopen" : "Mark as resolved"} data-ann-done>
          {annotation.done ? <Undo2 size={14} /> : <Check size={15} />}
        </button>
        <button type="button" onClick={onDelete} className={cn(ICON, "hover:text-danger")} title="Remove this annotation (Delete)" data-ann-delete>
          <Trash2 size={14} />
        </button>
        <button type="button" onClick={onClose} className={ICON} title="Close (Esc)" data-ann-close>
          <X size={14} />
        </button>
      </div>
      {lost && <p className="text-[12px] text-warn">The highlighted text is no longer in the document. The note is kept until you remove it.</p>}
      <textarea
        ref={ref}
        value={annotation.note}
        onChange={(e) => onChange({ note: e.target.value.slice(0, 2000) })}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onClose();
        }}
        rows={2}
        placeholder="Add a comment…"
        className="w-full resize-y rounded-[var(--radius-sm)] border border-edge bg-base-2 px-2 py-1.5 text-[13px] leading-snug text-ink outline-none placeholder:text-faint focus:border-accent"
        data-ann-note
      />
      <p className="text-[11px] text-faint">{annotation.done ? "Resolved · " : ""}“{annotation.quote.replace(/\s+/g, " ").trim().slice(0, 80)}{annotation.quote.length > 80 ? "…" : ""}”</p>
    </div>
  );
}

/** Every annotation in document order, with the controls that act on all of them. */
export function AnnotationsPanel({
  placed,
  selected,
  show,
  onShow,
  onSelect,
  onClear,
  markdown,
}: {
  placed: Placed[];
  selected: string | null;
  show: boolean;
  onShow: (v: boolean) => void;
  onSelect: (id: string) => void;
  onClear: () => void;
  markdown: string;
}) {
  return (
    <section aria-label="Annotations" className="border-b border-edge bg-base-2 px-3 py-2 text-[12.5px]" data-annotations-panel>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label className="inline-flex items-center gap-1.5 text-muted">
          <input type="checkbox" checked={show} onChange={(e) => onShow(e.target.checked)} className="accent-[var(--accent)]" data-show-marks /> Show marks
        </label>
        {placed.length > 0 && <CopyButton value={markdown} label="Copy as Markdown" className="h-6 px-2 text-[11px]" />}
        {placed.length > 0 && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Remove all annotations?")) onClear();
            }}
            className="ml-auto inline-flex items-center gap-1 text-[12px] text-faint hover:text-danger"
            data-clear-annotations
          >
            <Trash2 size={12} /> Clear all
          </button>
        )}
      </div>
      {placed.length === 0 ? (
        <p className="mt-1.5 text-faint">Select text in the preview to highlight it or leave a comment. Annotations travel with the share link and are listed at the end of the exported document.</p>
      ) : (
        <ol className="mt-1.5 max-h-64 space-y-0.5 overflow-auto">
          {placed.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onSelect(p.id)}
                className={cn("flex w-full items-start gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 text-left transition-colors hover:bg-raised", selected === p.id && "bg-raised")}
                data-ann-item={p.id}
              >
                <span className="mt-px inline-flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full px-1 text-[10.5px] font-semibold text-[#1e2419]" style={{ background: MARK_SOLID[p.color], opacity: p.done ? 0.55 : 1 }}>
                  {p.n}
                </span>
                <span className="min-w-0 flex-1">
                  <q className={cn("block truncate italic text-muted", p.done && "line-through")}>{p.quote.replace(/\s+/g, " ").trim()}</q>
                  {p.note && <span className="block whitespace-pre-wrap text-ink">{p.note}</span>}
                  {(p.done || !p.at) && (
                    <span className={cn("block text-[11.5px]", p.at ? "text-positive" : "text-warn")}>{p.at ? "Resolved" : "Text no longer in the document"}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
