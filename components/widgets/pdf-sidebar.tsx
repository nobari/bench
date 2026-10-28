"use client";

/**
 * The side panel of PDF Studio: its tab strip, the page thumbnails, the outline, the attachments and the Info panel.
 * The Comments and Pages panels have files of their own.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Download, ExternalLink, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/tools/bytes";
import { formatDate } from "@/lib/tools/files/pdf/comments";
import type { PdfInfo } from "@/lib/tools/files/pdf/meta";

export type SidebarTab = "pages" | "outline" | "comments" | "info" | "attachments" | "organise";

export function SidebarTabs({ tab, onTab, tabs }: { tab: SidebarTab; onTab(t: SidebarTab): void; tabs: { id: SidebarTab; label: string; icon: ReactNode; count?: number }[] }) {
  const active = tabs.find((t) => t.id === tab);
  return (
    <div className="shrink-0 border-b border-edge">
      <div className="flex items-stretch" role="tablist" data-sidebar-tabs>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-label={t.label}
            onClick={() => onTab(t.id)}
            title={t.label}
            className={cn("relative flex h-9 min-w-0 flex-1 items-center justify-center border-b-2 transition-colors", tab === t.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")}
            data-sidebar-tab={t.id}
          >
            {t.icon}
            {t.count ? <span className="absolute right-0.5 top-0.5 rounded-full bg-raised px-1 text-[9.5px] leading-4 tabular text-muted">{t.count}</span> : null}
          </button>
        ))}
      </div>
      <div className="readout px-2.5 py-1" data-sidebar-title>
        {active?.label}
        {active?.count ? ` · ${active.count}` : ""}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- thumbs */

export interface ThumbsApi {
  thumb(index: number): string | null;
  request(index: number): void;
  tick: number;
}

export function ThumbTile({ index, label, ratio, thumbs, active, onClick, className, children }: { index: number; label: string; ratio: number; thumbs: ThumbsApi; active?: boolean; onClick?: () => void; className?: string; children?: ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  const url = thumbs.thumb(index);
  const { request, tick } = thumbs;
  useEffect(() => {
    const el = ref.current;
    if (!el || url) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          request(index);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [index, request, url, tick]);
  return (
    <button ref={ref} type="button" onClick={onClick} className={cn("group relative block w-full text-left", className)} data-page-thumb={index + 1} aria-current={active ? "page" : undefined}>
      <span className={cn("block overflow-hidden rounded-[var(--radius-sm)] border bg-white transition-colors", active ? "border-accent ring-2 ring-accent/30" : "border-edge group-hover:border-edge-bright")} style={{ aspectRatio: String(ratio) }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url ? <img src={url} alt={label} draggable={false} className="h-full w-full object-contain" /> : <span className="block h-full w-full animate-pulse bg-raised" />}
      </span>
      <span className="mt-0.5 block text-center text-[11px] tabular text-muted">{label}</span>
      {children}
    </button>
  );
}

export function ThumbList({ count, current, ratios, thumbs, onGoTo, pageLabel }: { count: number; current: number; ratios: number[]; thumbs: ThumbsApi; onGoTo(page: number): void; pageLabel(index: number): string }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector(`[data-page-thumb="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);
  return (
    <div ref={listRef} className="h-full overflow-auto p-2" data-thumb-list>
      <div className="mx-auto grid max-w-[220px] gap-3">
        {Array.from({ length: count }, (_, i) => (
          <ThumbTile key={i} index={i} label={pageLabel(i)} ratio={ratios[i] ?? 0.773} thumbs={thumbs} active={current === i + 1} onClick={() => onGoTo(i + 1)} />
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- outline */

export interface OutlineNode {
  title: string;
  dest: string | unknown[] | null;
  url: string | null;
  items: OutlineNode[];
  bold?: boolean;
  italic?: boolean;
  /** 0-based page the destination resolves to, once looked up. */
  pageIndex?: number;
}

function OutlineItem({ node, depth, onGo }: { node: OutlineNode; depth: number; onGo(node: OutlineNode): void }) {
  const [open, setOpen] = useState(depth < 1);
  const has = node.items.length > 0;
  return (
    <li>
      <div className="flex items-center" style={{ paddingLeft: depth * 12 }}>
        {has ? (
          <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-6 w-5 shrink-0 items-center justify-center text-faint hover:text-ink" aria-label={open ? "Collapse" : "Expand"}>
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <button type="button" onClick={() => onGo(node)} className={cn("flex min-w-0 flex-1 items-center gap-1 rounded-[var(--radius-sm)] px-1 py-1 text-left text-[12.5px] text-ink hover:bg-raised", node.bold && "font-semibold", node.italic && "italic")} data-outline-item>
          <span className="truncate">{node.title || "Untitled"}</span>
          {node.url && <ExternalLink size={11} className="shrink-0 text-faint" />}
        </button>
      </div>
      {has && open && (
        <ul>
          {node.items.map((n, i) => (
            <OutlineItem key={i} node={n} depth={depth + 1} onGo={onGo} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function OutlineList({ outline, onGo }: { outline: OutlineNode[] | null; onGo(node: OutlineNode): void }) {
  if (!outline) return <p className="px-3 py-3 text-[12.5px] text-faint">Reading the outline…</p>;
  if (!outline.length) return <p className="px-3 py-3 text-[12.5px] text-faint">This document has no outline (bookmarks).</p>;
  return (
    <ul className="h-full overflow-auto px-1.5 py-1.5" data-outline-list>
      {outline.map((n, i) => (
        <OutlineItem key={i} node={n} depth={0} onGo={onGo} />
      ))}
    </ul>
  );
}

/* ----------------------------------------------------------- attachments */

export interface Attachment {
  /** pdf.js's key, used to fetch the bytes. */
  name: string;
  filename: string;
  /** Known once the bytes were fetched. */
  size: number | null;
  description?: string;
}

export function AttachmentList({ attachments, onDownload }: { attachments: Attachment[] | null; onDownload(a: Attachment): void }) {
  if (!attachments) return <p className="px-3 py-3 text-[12.5px] text-faint">Looking for attachments…</p>;
  if (!attachments.length) return <p className="px-3 py-3 text-[12.5px] text-faint">No files are attached to this document.</p>;
  return (
    <ul className="h-full space-y-0.5 overflow-auto px-1.5 py-1.5" data-attachment-list>
      {attachments.map((a) => (
        <li key={a.name}>
          <button type="button" onClick={() => onDownload(a)} className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left hover:bg-raised" data-attachment={a.filename}>
            <Download size={13} className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] text-ink">{a.filename}</span>
              <span className="block text-[11px] text-faint">
                {[a.size !== null ? formatBytes(a.size) : "", a.description ?? ""].filter(Boolean).join(" · ") || "Click to download"}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ info */

export interface DocInfo {
  name: string;
  size: number;
  pages: number;
  pdfVersion: string;
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  created: Date | null;
  modified: Date | null;
  encrypted: boolean;
  permissions: string[] | null;
  form: boolean;
  xfa: boolean;
  signatures: boolean;
  linearized: boolean;
  language: string;
  pageSizes: string;
  annotations: number;
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  if (v === "" || v === null || v === undefined) return null;
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 py-1 text-[12.5px]">
      <dt className="text-faint">{k}</dt>
      <dd className="min-w-0 break-words text-ink">{v}</dd>
    </div>
  );
}

export function InfoPanel({ info, onEdit, busy }: { info: DocInfo | null; onEdit(patch: Partial<PdfInfo>): Promise<void>; busy: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<PdfInfo>>({});
  if (!info) return <p className="px-3 py-3 text-[12.5px] text-faint">Reading the document…</p>;
  const start = () => {
    setDraft({ title: info.title, author: info.author, subject: info.subject, keywords: info.keywords });
    setEditing(true);
  };
  return (
    <div className="h-full overflow-auto px-3 py-2" data-info-panel>
      {editing ? (
        <form
          className="space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            setEditing(false);
            void onEdit(draft);
          }}
        >
          {(["title", "author", "subject", "keywords"] as const).map((k) => (
            <label key={k} className="block text-[11.5px] text-muted">
              <span className="capitalize">{k}</span>
              <input value={draft[k] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} className="input mt-0.5 h-8 px-2 py-0 text-[12.5px]" data-info-field={k} />
            </label>
          ))}
          <div className="flex items-center gap-1 pt-1">
            <button type="submit" disabled={busy} className="inline-flex h-7 items-center rounded-[var(--radius-sm)] bg-accent px-2.5 text-[12px] font-medium text-on-accent disabled:opacity-40" data-info-save>
              Save to the document
            </button>
            <button type="button" onClick={() => setEditing(false)} className="inline-flex h-7 items-center rounded-[var(--radius-sm)] px-2 text-[12px] text-muted hover:bg-raised hover:text-ink">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <dl className="divide-y divide-edge">
          <Row k="File" v={info.name} />
          <Row k="Size" v={formatBytes(info.size)} />
          <Row k="Pages" v={`${info.pages} · ${info.pageSizes}`} />
          <Row k="PDF" v={info.pdfVersion} />
          <Row k="Title" v={info.title} />
          <Row k="Author" v={info.author} />
          <Row k="Subject" v={info.subject} />
          <Row k="Keywords" v={info.keywords} />
          <Row k="Creator" v={info.creator} />
          <Row k="Producer" v={info.producer} />
          <Row k="Created" v={info.created ? formatDate(info.created) : ""} />
          <Row k="Modified" v={info.modified ? formatDate(info.modified) : ""} />
          <Row k="Language" v={info.language} />
          <Row k="Comments" v={info.annotations ? `${info.annotations}` : "none"} />
          <Row k="Form" v={info.form ? (info.xfa ? "AcroForm + XFA" : "AcroForm") : info.xfa ? "XFA" : "none"} />
          <Row k="Signatures" v={info.signatures ? "present" : ""} />
          <Row k="Protection" v={info.encrypted ? `Encrypted${info.permissions ? ` · ${info.permissions.join(", ")}` : ""}` : "none"} />
          <Row k="Fast web view" v={info.linearized ? "yes" : ""} />
        </dl>
      )}
      {!editing && (
        <button type="button" onClick={start} disabled={busy} className="mt-2 inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-edge px-2 text-[12px] text-muted hover:border-accent hover:text-accent disabled:opacity-40" data-info-edit>
          <Pencil size={12} /> Edit title, author, subject, keywords
        </button>
      )}
    </div>
  );
}
