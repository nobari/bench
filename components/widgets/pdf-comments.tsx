"use client";

/**
 * Comments in PDF Studio: the panel listing every comment of the document (the file's own and the ones still in
 * the editor), the dialog pdf.js's editors open to write one, and the popup that shows one by its mark.
 */
import { useEffect, useRef, useState } from "react";
import { Check, Copy, CornerDownRight, Download, MessageSquare, Pencil, Trash2, Undo2, X } from "lucide-react";
import { KIND_LABELS, formatDate, type PdfComment } from "@/lib/tools/files/pdf/comments";
import { commentText, type DialogState, type LiveComment, type PopupState } from "./pdf-comment-manager";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

export interface CommentFilter {
  unresolved: boolean;
  withText: boolean;
  page: number | null;
}

export interface CommentActions {
  onReveal(c: PdfComment): void;
  onReply(c: PdfComment, text: string): Promise<void>;
  onResolve(c: PdfComment, resolved: boolean): Promise<void>;
  onEdit(c: PdfComment, text: string): Promise<void>;
  onDelete(c: PdfComment): Promise<void>;
}

export interface LiveActions {
  onReveal(l: LiveComment): void;
  onEdit(l: LiveComment): void;
  onDelete(l: LiveComment): void;
}

const ICON = "flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40";
const SMALL = "inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-[12px] text-muted hover:bg-raised hover:text-ink disabled:opacity-40";
const TEXTAREA = "w-full resize-y rounded-[var(--radius-sm)] border border-edge bg-base px-2 py-1.5 text-[13px] leading-snug text-ink outline-none placeholder:text-faint focus:border-accent";

function Dot({ color, kind }: { color: string | null; kind: string }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-black/15" style={{ background: color ?? "var(--color-faint)" }} title={kind} aria-hidden />;
}

function Composer({ initial = "", placeholder, onSubmit, onCancel, submitLabel = "Send", busy }: { initial?: string; placeholder: string; onSubmit: (text: string) => void; onCancel: () => void; submitLabel?: string; busy?: boolean }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="mt-1.5 space-y-1.5" data-comment-composer>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 4000))}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) {
            e.preventDefault();
            onSubmit(text);
          }
        }}
        rows={2}
        placeholder={placeholder}
        className={TEXTAREA}
      />
      <div className="flex items-center gap-1">
        <button type="button" disabled={!text.trim() || busy} onClick={() => onSubmit(text)} className="inline-flex h-7 items-center rounded-[var(--radius-sm)] bg-accent px-2.5 text-[12px] font-medium text-on-accent disabled:opacity-40" data-composer-submit>
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} className={SMALL}>
          Cancel
        </button>
        <span className="ml-auto text-[11px] text-faint">⌘↵</span>
      </div>
    </div>
  );
}

function CommentItem({ c, selected, actions, busy, pageLabel, onSelect }: { c: PdfComment; selected: boolean; actions: CommentActions; busy: boolean; pageLabel: (p: number) => string; onSelect: () => void }) {
  const [mode, setMode] = useState<"none" | "reply" | "edit">("none");
  const quote = c.quote.replace(/\s+/g, " ").trim();
  return (
    <li className={cn("rounded-[var(--radius-sm)] border border-transparent px-2 py-1.5 transition-colors", selected ? "border-edge bg-raised" : "hover:bg-raised/60")} data-comment-item={c.id} data-comment-kind={c.kind} data-comment-resolved={c.resolved || undefined}>
      <button type="button" onClick={onSelect} className="flex w-full items-start gap-2 text-left" title="Show on the page">
        <Dot color={c.color} kind={KIND_LABELS[c.kind]} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 text-[11.5px] text-faint">
            <span className="font-medium text-muted">{c.author || "Unknown"}</span>
            <span>{KIND_LABELS[c.kind]}</span>
            <span>{pageLabel(c.page)}</span>
            {c.date && <span>{formatDate(c.date)}</span>}
            {c.resolved && <span className="text-positive">Resolved</span>}
          </span>
          {quote && <q className={cn("mt-0.5 block text-[12.5px] italic text-muted", c.kind !== "note" && "line-clamp-2")}>{quote}</q>}
          {c.text && <span className={cn("mt-0.5 block whitespace-pre-wrap text-[13px] text-ink", c.resolved && "opacity-70")}>{c.text}</span>}
        </span>
      </button>
      {c.replies.length > 0 && (
        <ul className="ml-4 mt-1 space-y-1 border-l border-edge pl-2">
          {c.replies.map((r) => (
            <li key={r.id} className="text-[12.5px]" data-comment-reply={r.id}>
              <span className="text-[11.5px] text-faint">
                <span className="font-medium text-muted">{r.author || "Unknown"}</span> {r.date && formatDate(r.date)}
              </span>
              <span className="block whitespace-pre-wrap text-ink">{r.text}</span>
            </li>
          ))}
        </ul>
      )}
      {selected && mode === "none" && (
        <div className="mt-1 flex flex-wrap items-center gap-0.5" data-comment-actions>
          <button type="button" onClick={() => setMode("reply")} className={SMALL} disabled={busy} data-comment-reply-button>
            <CornerDownRight size={12} /> Reply
          </button>
          <button type="button" onClick={() => void actions.onResolve(c, !c.resolved)} className={cn(SMALL, c.resolved && "text-positive")} disabled={busy} data-comment-resolve>
            {c.resolved ? <Undo2 size={12} /> : <Check size={12} />} {c.resolved ? "Reopen" : "Resolve"}
          </button>
          <button type="button" onClick={() => setMode("edit")} className={SMALL} disabled={busy} data-comment-edit>
            <Pencil size={12} /> Edit
          </button>
          {(quote || c.text) && <CopyButton value={[quote && `“${quote}”`, c.text].filter(Boolean).join(" — ")} label="Copy" className="h-7 border-0 px-2 text-[12px]" />}
          <button type="button" onClick={() => void actions.onDelete(c)} className={cn(SMALL, "ml-auto hover:text-danger")} disabled={busy} data-comment-delete>
            <Trash2 size={12} /> Delete
          </button>
        </div>
      )}
      {selected && mode === "reply" && (
        <Composer
          placeholder="Write a reply…"
          busy={busy}
          onCancel={() => setMode("none")}
          onSubmit={(t) => {
            setMode("none");
            void actions.onReply(c, t);
          }}
        />
      )}
      {selected && mode === "edit" && (
        <Composer
          initial={c.text}
          placeholder="Comment"
          submitLabel="Save"
          busy={busy}
          onCancel={() => setMode("none")}
          onSubmit={(t) => {
            setMode("none");
            void actions.onEdit(c, t);
          }}
        />
      )}
    </li>
  );
}

function LiveItem({ l, selected, actions, onSelect, pageLabel, author }: { l: LiveComment; selected: boolean; actions: LiveActions; onSelect: () => void; pageLabel: (p: number) => string; author: string }) {
  return (
    <li className={cn("rounded-[var(--radius-sm)] border border-dashed px-2 py-1.5 transition-colors", selected ? "border-edge bg-raised" : "border-transparent hover:bg-raised/60")} data-live-comment={l.uid}>
      <button type="button" onClick={onSelect} className="flex w-full items-start gap-2 text-left" title="Show on the page">
        <Dot color={l.color} kind="Comment" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 text-[11.5px] text-faint">
            <span className="font-medium text-muted">{author || "You"}</span>
            <span>{pageLabel(l.pageIndex)}</span>
            {l.date && <span>{formatDate(l.date)}</span>}
            <span className="text-warn">Not saved yet</span>
          </span>
          <span className="mt-0.5 block whitespace-pre-wrap text-[13px] text-ink">{l.text}</span>
        </span>
      </button>
      {selected && (
        <div className="mt-1 flex items-center gap-0.5">
          <button type="button" onClick={() => actions.onEdit(l)} className={SMALL}>
            <Pencil size={12} /> Edit
          </button>
          <button type="button" onClick={() => actions.onDelete(l)} className={cn(SMALL, "ml-auto hover:text-danger")}>
            <Trash2 size={12} /> Remove comment
          </button>
        </div>
      )}
    </li>
  );
}

export function CommentsPanel({
  comments,
  live,
  selected,
  onSelect,
  actions,
  liveActions,
  busy,
  author,
  onAuthor,
  pageLabel,
  filter,
  onFilter,
  pageCount,
  markdown,
  onExportJson,
  loading,
}: {
  comments: PdfComment[];
  live: LiveComment[];
  selected: string | null;
  onSelect(id: string | null): void;
  actions: CommentActions;
  liveActions: LiveActions;
  busy: boolean;
  author: string;
  onAuthor(name: string): void;
  pageLabel: (p: number) => string;
  filter: CommentFilter;
  onFilter(f: CommentFilter): void;
  pageCount: number;
  markdown: string;
  onExportJson(): void;
  loading: boolean;
}) {
  const shown = comments.filter((c) => (!filter.unresolved || !c.resolved) && (!filter.withText || c.text || c.replies.length) && (filter.page === null || c.page === filter.page));
  const liveShown = live.filter((l) => filter.page === null || l.pageIndex === filter.page);
  const total = comments.length + live.length;
  return (
    <div className="flex h-full min-h-0 flex-col" data-comments-panel>
      <div className="space-y-1.5 border-b border-edge px-2.5 py-2">
        <label className="flex items-center gap-2 text-[12px] text-muted">
          <span className="shrink-0">Your name</span>
          <input value={author} onChange={(e) => onAuthor(e.target.value)} placeholder="Shown on your comments" className="input h-7 px-2 py-0 text-[12px]" data-comment-author />
        </label>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
          <label className="inline-flex items-center gap-1">
            <input type="checkbox" checked={filter.unresolved} onChange={(e) => onFilter({ ...filter, unresolved: e.target.checked })} className="accent-[var(--accent)]" /> Open only
          </label>
          <label className="inline-flex items-center gap-1">
            <input type="checkbox" checked={filter.withText} onChange={(e) => onFilter({ ...filter, withText: e.target.checked })} className="accent-[var(--accent)]" /> With text
          </label>
          <select value={filter.page === null ? "all" : String(filter.page)} onChange={(e) => onFilter({ ...filter, page: e.target.value === "all" ? null : Number(e.target.value) })} className="input h-7 px-2 py-0 pr-6 text-[12px]" style={{ width: 110 }} aria-label="Page">
            <option value="all">All pages</option>
            {Array.from({ length: pageCount }, (_, i) => (
              <option key={i} value={i}>
                {pageLabel(i)}
              </option>
            ))}
          </select>
          <span className="ml-auto tabular text-faint" data-comment-count={total}>
            {shown.length + liveShown.length} of {total}
          </span>
        </div>
        {total > 0 && (
          <div className="flex items-center gap-1">
            <CopyButton value={markdown} label="Copy as Markdown" className="h-7 px-2 text-[12px]" />
            <button type="button" onClick={onExportJson} className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-edge px-2 text-[12px] text-muted hover:border-accent hover:text-accent">
              <Download size={12} /> JSON
            </button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1.5 py-1.5">
        {loading && total === 0 ? (
          <p className="px-2 py-3 text-[12.5px] text-faint">Reading the comments…</p>
        ) : total === 0 ? (
          <p className="px-2 py-3 text-[12.5px] text-faint">
            <MessageSquare size={14} className="mr-1 inline" />
            No comments yet. Select text and press Highlight, click a page with the Note tool, or draw and type with the other tools; each mark can carry a comment.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {liveShown.map((l) => (
              <LiveItem key={l.uid} l={l} selected={selected === l.uid} actions={liveActions} onSelect={() => onSelect(selected === l.uid ? null : l.uid)} pageLabel={pageLabel} author={author} />
            ))}
            {shown.map((c) => (
              <CommentItem
                key={c.id}
                c={c}
                selected={selected === c.id}
                actions={actions}
                busy={busy}
                pageLabel={pageLabel}
                onSelect={() => {
                  onSelect(selected === c.id ? null : c.id);
                  actions.onReveal(c);
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ overlays */

function anchorStyle(x: number, y: number, host: HTMLElement | null, width: number): React.CSSProperties {
  const r = host?.getBoundingClientRect();
  if (!r) return { left: x, top: y };
  const left = Math.min(Math.max(x - r.left, 8), Math.max(8, r.width - width - 8));
  const top = Math.min(Math.max(y - r.top + 6, 8), Math.max(8, r.height - 140));
  return { left, top };
}

/** Where a comment is written: pdf.js opened it on an editor or an existing annotation's popup. */
export function CommentDialog({ state, host, author, onSave, onCancel, onDelete }: { state: DialogState; host: HTMLElement | null; author: string; onSave(text: string): void; onCancel(): void; onDelete(): void }) {
  const [text, setText] = useState(state.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.setSelectionRange(ref.current.value.length, ref.current.value.length);
  }, [state]);
  return (
    <div
      role="dialog"
      aria-label={state.isNew ? "New comment" : "Edit comment"}
      className="absolute z-30 w-[min(300px,calc(100%-16px))] rounded-[var(--radius)] border border-edge bg-base p-2 shadow-pop"
      style={anchorStyle(state.x, state.y, host, 300)}
      data-comment-dialog
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-1 flex items-center gap-1 text-[11.5px] text-faint">
        <MessageSquare size={12} />
        <span>{author || "Comment"}</span>
        <button type="button" onClick={onCancel} className={cn(ICON, "ml-auto h-6 w-6")} title="Close (Esc)">
          <X size={13} />
        </button>
      </div>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 4000))}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSave(text);
          }
        }}
        rows={3}
        placeholder="Write a comment…"
        className={TEXTAREA}
        data-comment-dialog-text
      />
      <div className="mt-1.5 flex items-center gap-1">
        <button type="button" onClick={() => onSave(text)} className="inline-flex h-7 items-center rounded-[var(--radius-sm)] bg-accent px-2.5 text-[12px] font-medium text-on-accent" data-comment-dialog-save>
          {state.isNew ? "Add" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className={SMALL}>
          Cancel
        </button>
        {!state.isNew && (
          <button type="button" onClick={onDelete} className={cn(SMALL, "ml-auto hover:text-danger")} title="Remove the comment">
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

/** A comment shown by its mark on the page (hover or pinned). */
export function CommentPopup({ state, host, author, onEdit, onDelete, onClose }: { state: PopupState; host: HTMLElement | null; author: string; onEdit(): void; onDelete(): void; onClose(): void }) {
  const text = commentText(state.target);
  const data = state.target.getData?.();
  const who = data?.titleObj?.str || author;
  const when = data?.modificationDate instanceof Date ? data.modificationDate : null;
  if (!text) return null;
  return (
    <div className="absolute z-20 w-[min(260px,calc(100%-16px))] rounded-[var(--radius)] border border-edge bg-base p-2 text-[12.5px] shadow-pop" style={anchorStyle(state.x, state.y, host, 260)} data-comment-popup data-pinned={state.pinned || undefined} onPointerDown={(e) => e.stopPropagation()}>
      <div className="mb-0.5 flex items-center gap-1 text-[11px] text-faint">
        <span className="font-medium text-muted">{who || "Comment"}</span>
        {when && <span>{formatDate(when)}</span>}
        {state.pinned && (
          <button type="button" onClick={onClose} className={cn(ICON, "ml-auto h-5 w-5")} title="Close">
            <X size={12} />
          </button>
        )}
      </div>
      <p className="whitespace-pre-wrap text-ink">{text}</p>
      {state.pinned && state.editable && (
        <div className="mt-1 flex items-center gap-0.5">
          <button type="button" onClick={onEdit} className={SMALL}>
            <Pencil size={12} /> Edit
          </button>
          <CopyButton value={text} label="Copy" className="h-7 border-0 px-2 text-[12px]" />
          <button type="button" onClick={onDelete} className={cn(SMALL, "ml-auto hover:text-danger")}>
            <Trash2 size={12} />
          </button>
        </div>
      )}
      <Copy size={0} className="hidden" aria-hidden />
    </div>
  );
}
