"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import {
  ArrowLeftRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Eraser,
  FileText,
  ListChecks,
  MessageSquareText,
  Printer,
  RotateCcw,
  Sparkles,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import {
  acceptChange,
  changeFits,
  countWords,
  DEFAULT_META,
  describeChange,
  GRANULARITIES,
  GRANULARITY_LABELS,
  MAX_COMMENT,
  MAX_NOTE,
  MAX_REVIEWER,
  orphanComments,
  parseMeta,
  quote,
  redline as makeRedline,
  rejectChange,
  repeatIndex,
  SAMPLE_ORIGINAL,
  SAMPLE_REVISION,
  swappedKey,
  toHtmlFragment,
  toMarkdown,
  toPlainMarkup,
  toStandaloneHtml,
  type Change,
  type Granularity,
  type Piece,
  type TrackMeta,
} from "@/lib/tools/web/track-changes";
import { CopyButton } from "@/components/copy-button";
import { SHARE_SYNC_EVENT } from "@/components/share-button";
import { readShareState, useShareState } from "@/lib/share-state";
import { cn } from "@/lib/utils";

const DRAFT_KEY = "bench:track-changes:draft";
const VIEWS = ["inline", "split", "final"] as const;
type View = (typeof VIEWS)[number];
const MAX_HISTORY = 60;
/** In the link, an empty revision (everything deleted) is this, since an empty value reads as "no revision". */
const EMPTY_REVISION = "~";

interface Snapshot {
  original: string;
  revision: string | null;
  comments: Record<string, string>;
}

interface Initial {
  original: string;
  /** null: the revision mirrors the original — nothing has been edited yet. */
  revision: string | null;
  meta: TrackMeta;
  source: "link" | "draft" | "empty";
}

/** Texts come from the compressed hash (Share), plain `o`/`r`/`g` query params (examples), or the local draft. */
function readInitial(): Initial {
  const empty: Initial = { original: "", revision: null, meta: { ...DEFAULT_META, comments: {} }, source: "empty" };
  if (typeof window === "undefined") return empty;
  const dec = (v: string | null) => {
    if (!v) return null;
    try {
      return decompressFromEncodedURIComponent(v) ?? null;
    } catch {
      return null;
    }
  };
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const o = dec(hash.get("o"));
  if (o !== null) {
    const rRaw = hash.get("r");
    const m = dec(hash.get("m"));
    let meta = { ...DEFAULT_META, comments: {} };
    if (m) {
      try {
        meta = parseMeta(JSON.parse(m));
      } catch {
        /* a link from another version — compare with the defaults */
      }
    }
    return { original: o, revision: rRaw === EMPTY_REVISION ? "" : dec(rRaw), meta, source: "link" };
  }
  const q = new URLSearchParams(window.location.search);
  if (q.has("o") || q.has("r")) return { original: q.get("o") ?? "", revision: q.get("r"), meta: parseMeta({ granularity: q.get("g") }), source: "link" };
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const d = JSON.parse(raw) as { o?: unknown; r?: unknown; m?: unknown };
      if (typeof d.o === "string") return { original: d.o, revision: typeof d.r === "string" ? d.r : null, meta: parseMeta(d.m), source: "draft" };
    }
  } catch {
    /* storage unavailable */
  }
  return empty;
}

/** Only what differs from the defaults goes into the link. */
function metaForLink(meta: TrackMeta): Partial<TrackMeta> | null {
  const out: Partial<TrackMeta> = {};
  if (meta.granularity !== "word") out.granularity = meta.granularity;
  if (meta.ignoreWhitespace) out.ignoreWhitespace = true;
  if (Object.keys(meta.comments).length) out.comments = meta.comments;
  if (meta.reviewer.trim()) out.reviewer = meta.reviewer.trim();
  if (meta.note.trim()) out.note = meta.note;
  return Object.keys(out).length ? out : null;
}

const SEL =
  "h-7 rounded-[var(--radius-sm)] border border-edge bg-base px-1.5 pr-6 text-[12px] text-ink outline-none focus:border-accent";
const GHOST =
  "inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-edge px-2 text-[12px] text-muted transition-colors hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40";
const ICON =
  "inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-muted transition-colors hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-40";
const KIND: Record<Change["kind"], string> = {
  insert: "bg-positive/15 text-positive",
  delete: "bg-danger/15 text-danger",
  replace: "bg-warn/15 text-warn",
};

export function TrackChangesWidget() {
  const [initial] = useState(readInitial);
  const [original, setOriginal] = useState(initial.original);
  const [revision, setRevision] = useState<string | null>(initial.revision);
  const [meta, setMeta] = useState<TrackMeta>(initial.meta);
  // How the link's reader looked at it, applied softly.
  const [view, setView] = useState<View>(() => {
    const v = readShareState<{ view: unknown }>("track")?.view;
    return VIEWS.includes(v as View) ? (v as View) : "inline";
  });
  const [listOpen, setListOpen] = useState(() => readShareState<{ list: unknown }>("track")?.list === true);
  useShareState("track", { view, list: listOpen });
  const [selected, setSelected] = useState<number | null>(null);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [rich, setRich] = useState<"idle" | "done" | "fail">("idle");
  const redlineRef = useRef<HTMLDivElement | null>(null);
  const commentRef = useRef<HTMLTextAreaElement | null>(null);
  const urlsRef = useRef<string[]>([]);

  const rev = revision ?? original;
  const dOriginal = useDeferredValue(original);
  const dRev = useDeferredValue(rev);
  const opts = useMemo(
    () => ({ granularity: meta.granularity, ignoreWhitespace: meta.ignoreWhitespace }),
    [meta.granularity, meta.ignoreWhitespace],
  );
  const result = useMemo(() => makeRedline(dOriginal, dRev, opts), [dOriginal, dRev, opts]);
  const { changes, pieces, stats } = result;
  const sel = selected !== null && selected < changes.length ? selected : null;
  const current = sel !== null ? changes[sel] : null;
  const orphans = useMemo(() => orphanComments(meta, changes), [meta, changes]);
  /** Comment numbers in document order, for the markers. */
  const numbers = useMemo(() => {
    const m = new Map<string, number>();
    let n = 0;
    for (const c of changes) if (meta.comments[c.key]?.trim()) m.set(c.key, ++n);
    return m;
  }, [changes, meta.comments]);
  const exportInput = useMemo(
    () => ({ redline: result, comments: meta.comments, reviewer: meta.reviewer, note: meta.note }),
    [result, meta.comments, meta.reviewer, meta.note],
  );
  const markdown = useMemo(() => (changes.length ? toMarkdown(exportInput) : ""), [changes.length, exportInput]);
  const plain = useMemo(() => (changes.length ? toPlainMarkup(exportInput) : ""), [changes.length, exportInput]);
  const empty = !original && revision === null;

  // The draft is kept in this browser (debounced).
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        if (original || revision !== null) {
          localStorage.setItem(DRAFT_KEY, JSON.stringify({ o: original, r: revision, m: meta }));
          setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
        } else {
          localStorage.removeItem(DRAFT_KEY);
          setSavedAt(null);
        }
      } catch {
        /* storage unavailable */
      }
    }, 500);
    return () => clearTimeout(id);
  }, [original, revision, meta]);

  // Share: both texts, the comments and the cover note go into the link, compressed.
  useEffect(() => {
    const sync = () => {
      const h = new URLSearchParams();
      if (original || revision !== null) {
        h.set("o", compressToEncodedURIComponent(original));
        if (revision !== null) h.set("r", revision === "" ? EMPTY_REVISION : compressToEncodedURIComponent(revision));
        const m = metaForLink(meta);
        if (m) h.set("m", compressToEncodedURIComponent(JSON.stringify(m)));
      }
      const q = new URLSearchParams(window.location.search);
      for (const k of ["o", "r", "g"]) q.delete(k);
      const qs = q.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${h.toString() ? `#${h}` : ""}`);
    };
    window.addEventListener(SHARE_SYNC_EVENT, sync);
    return () => window.removeEventListener(SHARE_SYNC_EVENT, sync);
  }, [original, revision, meta]);

  useEffect(() => {
    if (sel === null) return;
    const el = redlineRef.current?.querySelector<HTMLElement>(`[data-change="${sel}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [sel, view]);

  useEffect(() => {
    const urls = urlsRef.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  /* ----------------------------------------------------------- decisions */

  const pushHistory = () => setHistory((h) => [...h.slice(-(MAX_HISTORY - 1)), { original, revision, comments: meta.comments }]);
  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    setOriginal(last.original);
    setRevision(last.revision);
    setMeta((m) => ({ ...m, comments: last.comments }));
  };
  const dropComment = (key: string) =>
    setMeta((m) => {
      if (!(key in m.comments)) return m;
      const comments = { ...m.comments };
      delete comments[key];
      return { ...m, comments };
    });
  const act = (i: number | null, how: "accept" | "reject") => {
    const c = i !== null ? changes[i] : undefined;
    // The redline can lag a step behind fast typing; a change that no longer fits the texts is left alone.
    if (!c || !changeFits(original, rev, c)) return;
    pushHistory();
    if (how === "accept") setOriginal(acceptChange(original, c));
    else setRevision(rejectChange(rev, c));
    dropComment(c.key);
    setSelected(i); // the next change now sits at this index
  };
  const acceptAll = () => {
    if (!changes.length) return;
    pushHistory();
    setOriginal(rev);
    setMeta((m) => ({ ...m, comments: {} }));
    setSelected(null);
  };
  const rejectAll = () => {
    if (!changes.length) return;
    pushHistory();
    setRevision(null);
    setMeta((m) => ({ ...m, comments: {} }));
    setSelected(null);
  };
  const setComment = (text: string) => {
    if (!current) return;
    const key = current.key;
    setMeta((m) => {
      const comments = { ...m.comments };
      if (text.trim()) comments[key] = text.slice(0, MAX_COMMENT);
      else delete comments[key];
      return { ...m, comments };
    });
  };
  const step = (d: 1 | -1) => {
    if (!changes.length) return;
    setSelected((s) => {
      const base = s === null || s >= changes.length ? (d > 0 ? -1 : changes.length) : s;
      return Math.max(0, Math.min(changes.length - 1, base + d));
    });
  };
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case "ArrowRight":
      case "n":
      case "j":
        e.preventDefault();
        step(1);
        break;
      case "ArrowLeft":
      case "p":
      case "k":
        e.preventDefault();
        step(-1);
        break;
      case "a":
        act(sel, "accept");
        break;
      case "r":
        act(sel, "reject");
        break;
      case "c":
        if (current) {
          e.preventDefault();
          commentRef.current?.focus();
        }
        break;
      case "Escape":
        setSelected(null);
        break;
    }
  };

  /* --------------------------------------------------------------- texts */

  const swap = () => {
    if (revision === null) return;
    pushHistory();
    const idx = repeatIndex(changes);
    const comments: Record<string, string> = {};
    for (const c of changes) {
      const t = meta.comments[c.key];
      if (t) comments[swappedKey(c, idx.get(c.key) ?? 0)] = t;
    }
    setOriginal(rev);
    setRevision(original);
    setMeta((m) => ({ ...m, comments }));
  };
  const resetRevision = () => {
    if (revision === null) return;
    pushHistory();
    setRevision(null);
    setMeta((m) => ({ ...m, comments: {} }));
    setSelected(null);
  };
  const clearAll = () => {
    pushHistory();
    setOriginal("");
    setRevision(null);
    setMeta({ ...DEFAULT_META, comments: {} });
    setSelected(null);
  };
  const loadSample = () => {
    pushHistory();
    setOriginal(SAMPLE_ORIGINAL);
    setRevision(SAMPLE_REVISION);
    setMeta((m) => ({ ...m, granularity: "word", ignoreWhitespace: false, comments: {} }));
    setSelected(null);
  };

  /* ------------------------------------------------------------- exports */

  const docTitle = () => (rev.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 80) || "Tracked changes";
  const standalone = () => toStandaloneHtml({ ...exportInput, title: docTitle(), date: new Date().toISOString() });
  const copyRich = async () => {
    const html = toHtmlFragment(exportInput);
    try {
      if (typeof ClipboardItem !== "undefined" && typeof navigator.clipboard.write === "function")
        await navigator.clipboard.write([
          new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([plain], { type: "text/plain" }) }),
        ]);
      else await navigator.clipboard.writeText(plain);
      setRich("done");
    } catch {
      setRich("fail");
    }
    setTimeout(() => setRich("idle"), 1800);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([standalone()], { type: "text/html" }));
    urlsRef.current.push(url);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${docTitle().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "document"}-tracked-changes.html`;
    a.click();
  };
  const print = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(standalone());
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  return (
    <div className="space-y-3">
      {/* control bar */}
      <div className="panel flex flex-wrap items-center gap-x-3 gap-y-2 p-2">
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          Compare by
          <select
            data-track-granularity
            value={meta.granularity}
            onChange={(e) => setMeta((m) => ({ ...m, granularity: e.target.value as Granularity }))}
            className={SEL}
          >
            {GRANULARITIES.map((g) => (
              <option key={g} value={g}>
                {GRANULARITY_LABELS[g].toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        {meta.granularity === "word" && (
          <Toggle
            label="Ignore whitespace changes"
            checked={meta.ignoreWhitespace}
            onChange={(v) => setMeta((m) => ({ ...m, ignoreWhitespace: v }))}
            title="Reflowed lines and doubled spaces are not shown as changes"
          />
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button onClick={loadSample} className={GHOST} title="Load a short text and a revision of it">
            <Sparkles size={13} /> Sample
          </button>
          <button onClick={swap} disabled={revision === null} className={GHOST} title="The revision becomes the original and the original the revision">
            <ArrowLeftRight size={13} /> Swap
          </button>
          <button onClick={resetRevision} disabled={revision === null} className={GHOST} title="Discard the revision — it mirrors the original again">
            <RotateCcw size={13} /> Reset revision
          </button>
          <button onClick={clearAll} disabled={empty} className={GHOST} title="Clear both texts, the comments and the note">
            <Eraser size={13} /> Clear
          </button>
        </div>
      </div>

      {/* texts */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Pane id="original" label="Original" placeholder="Paste the text you were given…" value={original} onChange={setOriginal} />
        <Pane
          id="revision"
          label="Revision"
          placeholder="Edit the text here — every change shows below"
          value={rev}
          onChange={setRevision}
          mirrored={revision === null}
          spell
        />
      </div>

      {/* redline */}
      <div className="panel flex flex-col" data-track-redline>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-edge px-3 py-2">
          <span className="readout">Changes</span>
          {changes.length > 0 ? (
            <span className="flex flex-wrap items-center gap-x-2 text-[12.5px] tabular" data-track-stats>
              <span className="text-positive" title="Insertions">
                +{stats.inserts}
              </span>
              <span className="text-danger" title="Deletions">
                −{stats.deletes}
              </span>
              <span className="text-warn" title="Replacements">
                ~{stats.replaces}
              </span>
              <span className="text-faint">
                {Math.round(stats.changed * 100)}% changed · {stats.wordsIn} {stats.wordsIn === 1 ? "word" : "words"} in, {stats.wordsOut} out
              </span>
            </span>
          ) : (
            !empty && <span className="text-[12.5px] text-faint">{revision === null ? "No changes yet" : "The revision reads exactly like the original"}</span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Segmented
              value={view}
              onChange={setView}
              items={[
                ["inline", "Inline"],
                ["split", "Side by side"],
                ["final", "Final"],
              ]}
            />
            <button onClick={() => setListOpen((o) => !o)} className={cn(GHOST, listOpen && "border-accent text-accent")} title="Every change, in order" data-track-list>
              <ListChecks size={13} /> List
            </button>
            <button onClick={() => setExportOpen((o) => !o)} className={cn(GHOST, exportOpen && "border-accent text-accent")} title="Copy, download or print" data-track-export>
              <Download size={13} /> Export
            </button>
          </div>
        </div>

        {/* the selected change */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-edge px-3 py-1.5 text-[12px]">
          <button onClick={() => step(-1)} disabled={!changes.length} className={ICON} title="Previous change (←)" aria-label="Previous change" data-track-prev>
            <ChevronLeft size={14} />
          </button>
          <span className="min-w-[4.5rem] text-center tabular text-muted" data-track-position>
            {sel !== null ? `${sel + 1} / ${changes.length}` : `${changes.length} ${changes.length === 1 ? "change" : "changes"}`}
          </span>
          <button onClick={() => step(1)} disabled={!changes.length} className={ICON} title="Next change (→)" aria-label="Next change" data-track-next>
            <ChevronRight size={14} />
          </button>
          {current ? (
            <>
              <span className={cn("rounded-[3px] px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide", KIND[current.kind])}>{current.kind}</span>
              <span className="max-w-[40ch] truncate text-muted" title={describeChange(current)}>
                {describeChange(current)}
              </span>
              <button onClick={() => act(sel, "accept")} className={cn(GHOST, "border-positive/40 text-positive hover:border-positive hover:text-positive")} title="Accept this change (a)" data-track-accept>
                <Check size={13} /> Accept
              </button>
              <button onClick={() => act(sel, "reject")} className={cn(GHOST, "border-danger/40 text-danger hover:border-danger hover:text-danger")} title="Reject this change (r)" data-track-reject>
                <X size={13} /> Reject
              </button>
              <textarea
                ref={commentRef}
                data-track-comment
                value={meta.comments[current.key] ?? ""}
                onChange={(e) => setComment(e.target.value)}
                rows={1}
                maxLength={MAX_COMMENT}
                placeholder="Comment on this change… (c)"
                className="input min-w-[12rem] flex-1 resize-none py-1 text-[12.5px] leading-snug"
              />
            </>
          ) : (
            <span className="text-faint">
              {changes.length ? "Click a change, or use ← → to move, a to accept, r to reject, c to comment." : "Decisions on single changes appear here."}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={undo} disabled={!history.length} className={GHOST} title="Undo the last decision or edit made here" data-track-undo>
              <Undo2 size={13} /> Undo
            </button>
            <button onClick={acceptAll} disabled={!changes.length} className={GHOST} title="The original takes every change" data-track-accept-all>
              Accept all
            </button>
            <button onClick={rejectAll} disabled={!changes.length} className={GHOST} title="The revision goes back to the original" data-track-reject-all>
              Reject all
            </button>
          </div>
        </div>

        {exportOpen && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-edge bg-base-2/50 px-3 py-2" data-track-exports>
            <CopyButton value={rev} label="Copy final text" className="h-7 text-[12px]" />
            <CopyButton value={original} label="Copy original" className="h-7 text-[12px]" />
            <button
              onClick={copyRich}
              disabled={!changes.length}
              className={cn(GHOST, rich === "done" && "border-positive text-positive", rich === "fail" && "border-danger text-danger")}
              title="Copy the redline as rich text — paste into Word, Google Docs or an email and the marks come along"
            >
              {rich === "done" ? <Check size={13} /> : <FileText size={13} />}
              {rich === "done" ? "Copied" : rich === "fail" ? "Clipboard refused" : "Copy redline (rich text)"}
            </button>
            <CopyButton value={markdown} label="Copy Markdown" className="h-7 text-[12px]" />
            <CopyButton value={plain} label="Copy plain markup" className="h-7 text-[12px]" />
            <button onClick={download} disabled={!changes.length} className={GHOST} title="A standalone HTML page with the redline, the note and the comments">
              <Download size={13} /> .html
            </button>
            <button onClick={print} disabled={!changes.length} className={GHOST} title="Print, or save as PDF from the print dialog">
              <Printer size={13} /> Print / PDF
            </button>
            <span className="text-[11.5px] text-faint">Markdown: ~~deleted~~ **inserted** with footnotes · plain: [-deleted-]{"{+inserted+}"}</span>
          </div>
        )}

        <div className="flex flex-col lg:flex-row">
          <div
            ref={redlineRef}
            tabIndex={0}
            onKeyDown={onKey}
            aria-label="Tracked changes"
            className="max-h-[600px] min-w-0 flex-1 overflow-auto p-4 text-[15px] leading-[1.75] text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {empty ? (
              <div className="py-8 text-center text-[13.5px] text-faint">
                <p>Paste the text you were given in Original and edit it in Revision: every change shows here as a redline.</p>
                <p className="mt-1">Share sends both texts, your comments and your note in the link; the reader accepts or rejects each change here.</p>
                <button onClick={loadSample} className={cn(GHOST, "mx-auto mt-4")}>
                  <Sparkles size={13} /> Load a sample
                </button>
              </div>
            ) : view === "final" ? (
              <div className="whitespace-pre-wrap break-words" data-track-final>
                {rev || <span className="text-faint">The revision is empty.</span>}
              </div>
            ) : view === "split" ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="min-w-0 whitespace-pre-wrap break-words border-r border-edge pr-4" data-track-side="original">
                  <Marked pieces={pieces} side="a" sel={sel} onSelect={setSelected} numbers={numbers} />
                </div>
                <div className="min-w-0 whitespace-pre-wrap break-words" data-track-side="revision">
                  <Marked pieces={pieces} side="b" sel={sel} onSelect={setSelected} numbers={numbers} />
                </div>
              </div>
            ) : (
              <div className="whitespace-pre-wrap break-words" data-track-inline>
                <Marked pieces={pieces} side="both" sel={sel} onSelect={setSelected} numbers={numbers} />
              </div>
            )}
          </div>
          {listOpen && (
            <ChangeList
              changes={changes}
              sel={sel}
              comments={meta.comments}
              orphans={orphans}
              onSelect={setSelected}
              onAct={act}
              onDropOrphans={() => setMeta((m) => ({ ...m, comments: Object.fromEntries(Object.entries(m.comments).filter(([k]) => !orphans.includes(k))) }))}
            />
          )}
        </div>
      </div>

      {/* cover note */}
      <div className="panel grid gap-3 p-3 sm:grid-cols-[14rem_1fr]">
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Reviewer
          <input
            data-track-reviewer
            value={meta.reviewer}
            onChange={(e) => setMeta((m) => ({ ...m, reviewer: e.target.value.slice(0, MAX_REVIEWER) }))}
            maxLength={MAX_REVIEWER}
            placeholder="Your name (optional)"
            className="input h-8 text-[13px]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Note to the author
          <textarea
            data-track-note
            value={meta.note}
            onChange={(e) => setMeta((m) => ({ ...m, note: e.target.value.slice(0, MAX_NOTE) }))}
            maxLength={MAX_NOTE}
            rows={2}
            placeholder="What you changed and why, in a sentence or two — it travels with the link and heads the exports"
            className="input min-h-[2.25rem] resize-y text-[13px]"
          />
        </label>
      </div>
      <p className="text-[11.5px] text-faint">
        {savedAt ? `Draft saved in this browser at ${savedAt}. ` : "Nothing leaves your browser. "}
        Share puts both texts, the comments and the note in the link; long links are shortened.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------- sub-pieces */

function Marked({
  pieces,
  side,
  sel,
  onSelect,
  numbers,
}: {
  pieces: Piece[];
  side: "a" | "b" | "both";
  sel: number | null;
  onSelect: (i: number) => void;
  numbers: Map<string, number>;
}) {
  return (
    <>
      {pieces.map((p, i) => {
        if (p.type === "eq") return <span key={i}>{side === "a" ? p.a : p.b}</span>;
        const c = p.change;
        const del = side !== "b" ? c.del : "";
        const ins = side !== "a" ? c.ins : "";
        if (!del && !ins) return null;
        return (
          <span
            key={c.key}
            data-change={c.index}
            role="button"
            onClick={() => onSelect(c.index)}
            title={describeChange(c)}
            className={cn("cursor-pointer rounded-[2px]", sel === c.index && "outline outline-2 outline-offset-1 outline-accent")}
          >
            {del ? <del className={cn("bg-danger/10 text-danger decoration-danger/60", !del.trim() && "bg-danger/30")}>{del}</del> : null}
            {ins ? <ins className={cn("bg-positive/10 text-positive decoration-positive/60", !ins.trim() && "bg-positive/30")}>{ins}</ins> : null}
            {numbers.get(c.key) ? <sup className="ml-px select-none text-[0.68em] font-semibold text-accent">{numbers.get(c.key)}</sup> : null}
          </span>
        );
      })}
    </>
  );
}

function ChangeList({
  changes,
  sel,
  comments,
  orphans,
  onSelect,
  onAct,
  onDropOrphans,
}: {
  changes: Change[];
  sel: number | null;
  comments: Record<string, string>;
  orphans: string[];
  onSelect: (i: number) => void;
  onAct: (i: number, how: "accept" | "reject") => void;
  onDropOrphans: () => void;
}) {
  return (
    <div className="max-h-[600px] overflow-auto border-t border-edge text-[12.5px] lg:w-80 lg:shrink-0 lg:border-l lg:border-t-0" data-track-change-list>
      {changes.length === 0 && <p className="p-3 text-faint">No changes.</p>}
      <ol>
        {changes.map((c) => (
          <li
            key={c.key}
            data-change-row={c.index}
            onClick={() => onSelect(c.index)}
            className={cn("flex cursor-pointer items-start gap-2 border-b border-edge px-3 py-2 hover:bg-raised", sel === c.index && "bg-raised")}
          >
            <span className="w-5 shrink-0 text-right tabular text-faint">{c.index + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                {c.del && <del className="text-danger">{quote(c.del)}</del>}
                {c.del && c.ins && " "}
                {c.ins && <ins className="text-positive">{quote(c.ins)}</ins>}
              </span>
              {comments[c.key] && (
                <span className="mt-0.5 flex items-start gap-1 text-muted">
                  <MessageSquareText size={11} className="mt-[3px] shrink-0" />
                  <span className="line-clamp-2">{comments[c.key]}</span>
                </span>
              )}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAct(c.index, "accept");
              }}
              className="rounded p-0.5 text-positive hover:bg-positive/10"
              title="Accept"
              aria-label={`Accept change ${c.index + 1}`}
            >
              <Check size={14} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAct(c.index, "reject");
              }}
              className="rounded p-0.5 text-danger hover:bg-danger/10"
              title="Reject"
              aria-label={`Reject change ${c.index + 1}`}
            >
              <X size={14} />
            </button>
          </li>
        ))}
      </ol>
      {orphans.length > 0 && (
        <p className="p-3 text-faint">
          {orphans.length} {orphans.length === 1 ? "comment belongs" : "comments belong"} to changes that are no longer here.{" "}
          <button onClick={onDropOrphans} className="underline hover:text-ink">
            Remove
          </button>
        </p>
      )}
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) {
  return (
    <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5" data-track-view>
      {items.map(([id, label]) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={cn("h-6 rounded-[3px] px-2.5 text-[12.5px] transition-colors", value === id ? "bg-accent font-medium text-on-accent" : "text-muted hover:text-ink")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, checked, onChange, title }: { label: string; checked: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-muted" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--accent)]" />
      {label}
    </label>
  );
}

function Pane({
  id,
  label,
  placeholder,
  value,
  onChange,
  mirrored,
  spell,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  mirrored?: boolean;
  spell?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const read = (f: File | undefined) => {
    if (f) f.text().then(onChange);
  };
  return (
    <div className="panel flex min-w-0 flex-col">
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <span className="readout">{label}</span>
        {mirrored && <span className="text-[11.5px] text-faint">mirrors the original until you edit it</span>}
        <div className="ml-auto flex items-center gap-2.5">
          <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 text-[12px] text-faint hover:text-ink" title="Open a .txt or .md file (or drop one on the text)">
            <Upload size={12} /> Open file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.markdown,.text,text/*"
            className="hidden"
            onChange={(e) => {
              read(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {value && !mirrored && (
            <button onClick={() => onChange("")} className="inline-flex items-center gap-1 text-[12px] text-faint hover:text-danger">
              <X size={12} /> Clear
            </button>
          )}
        </div>
      </div>
      <textarea
        data-pane={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onDrop={(e) => {
          const f = e.dataTransfer.files?.[0];
          if (f) {
            e.preventDefault();
            read(f);
          }
        }}
        spellCheck={!!spell}
        placeholder={placeholder}
        className="min-h-[220px] resize-y bg-transparent p-3 text-[14px] leading-relaxed text-ink outline-none placeholder:text-faint"
      />
      <div className="flex items-center gap-3 border-t border-edge px-3 py-1.5 readout tabular">
        <span>{countWords(value).toLocaleString()} words</span>
        <span className="ml-auto">{value.length.toLocaleString()} ch</span>
      </div>
    </div>
  );
}
