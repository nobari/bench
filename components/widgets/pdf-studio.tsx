"use client";

/**
 * PDF Studio: open a PDF, read it, search it, fill its forms, mark it up and comment on it, organise its pages, and
 * save it — all in the browser. pdf.js draws and edits; pdf-lib (in a worker) changes the document's structure; every
 * change is bytes → bytes with an undo stack of snapshots. The file never leaves the device.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Download,
  FileText,
  FolderOpen,
  Highlighter,
  ImagePlus,
  Info,
  LayoutGrid,
  List,
  Loader,
  Lock,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  MousePointer2,
  PanelLeft,
  Paperclip,
  Pencil,
  Printer,
  Redo2,
  RotateCw,
  Save,
  Search,
  Square,
  StretchVertical,
  Strikethrough,
  Type,
  Underline,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { SplitPane } from "@/components/ui/split-pane";
import { useUnsavedWork } from "@/lib/unsaved-work";
import { readShareState, useShareState } from "@/lib/share-state";
import { formatBytes } from "@/lib/tools/bytes";
import { buildZip } from "@/lib/tools/files/zip-write";
import { buildComments, commentsJson, commentsMarkdown, kindOf, type PdfComment, type RawAnnotation, type TextItem } from "@/lib/tools/files/pdf/comments";
import type { PdfOp } from "@/lib/tools/files/pdf/ops";
import type { PdfInfo } from "@/lib/tools/files/pdf/meta";
import { chunkPages, chunksFrom, parsePageRanges, runLabel } from "@/lib/tools/files/pdf/ranges";
import { SAMPLE_NAME } from "@/lib/tools/files/pdf/sample";
import { parsePdfDate } from "@/lib/tools/files/pdf/dates";
import { AUTOSAVE_LIMIT, clearAutosave, derivedName, downloadBytes, ensurePermission, hasFilePicker, hasSavePicker, loadAutosave, pickPdf, pickSaveTarget, readAuthor, recentFiles, rememberRecent, saveAutosave, writeAuthor, writeToHandle, type Autosave, type RecentEntry } from "@/lib/tools/files/pdf/store";
import { cn } from "@/lib/utils";
import { BenchCommentManager, type LiveComment } from "./pdf-comment-manager";
import { PdfOpsClient } from "./pdf-ops-client";
import { PdfViewerHost, ZOOM_STEPS, type EditorParams, type EditorState, type FindResult, type PdfViewerApi, type ViewMode } from "./pdf-viewer";
import { CommentDialog, CommentPopup, CommentsPanel, type CommentFilter } from "./pdf-comments";
import { AttachmentList, InfoPanel, OutlineList, SidebarTabs, ThumbList, type Attachment, type DocInfo, type OutlineNode } from "./pdf-sidebar";
import { PagesPanel } from "./pdf-pages";
import { useThumbnails } from "./pdf-thumbs";

/* ------------------------------------------------------------------ types */

interface DocState {
  bytes: Uint8Array;
  name: string;
  /** Bumped on every change of the bytes. */
  version: number;
  /** Changes when a different file is opened (the viewer keeps its place while it stays). */
  docKey: string;
  handle: FileSystemFileHandle | null;
  password?: string;
  /** True when the bytes differ from the file they came from. */
  dirty: boolean;
  source: "file" | "sample" | "restore";
}

type Phase = "empty" | "loading" | "password" | "ready" | "error";

type Dialog =
  | { kind: "split" }
  | { kind: "crop"; pages: number[] }
  | { kind: "protect" }
  | { kind: "note"; page: number; x: number; y: number; clientX: number; clientY: number }
  | { kind: "insert"; at: number; bytes: Uint8Array; name: string; wrong: boolean };

const VIEWS = ["continuous", "single", "two-up", "wrapped"] as const;
const TOOLS = ["select", "highlight", "note", "text", "draw", "image"] as const;
const TABS = ["pages", "outline", "comments", "info", "attachments", "organise"] as const;
const VIEW_LABELS: Record<ViewMode, string> = { continuous: "Continuous", single: "Single page", "two-up": "Two-up", wrapped: "Wrapped" };
const HIGHLIGHT_COLORS = ["#FFFF98", "#53FFBC", "#80EBFF", "#FFCBE6", "#FF4F5F"];
const NOTE_COLORS = ["#ffd54a", "#ff8a80", "#8ce99a", "#8ab4f8"];
const MAX_HISTORY_BYTES = 400 * 1024 * 1024;
const MAX_HISTORY = 30;

const DEFAULT_PARAMS: EditorParams = { highlightColor: "#FFFF98", highlightThickness: 12, inkColor: "#e5484d", inkThickness: 2, inkOpacity: 1, textColor: "#1b1b1f", textSize: 12 };

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const isPdf = (bytes: Uint8Array) => {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF");
};

const NAMED_SIZES: [string, number, number][] = [
  ["A4", 595, 842],
  ["A3", 842, 1191],
  ["A5", 420, 595],
  ["Letter", 612, 792],
  ["Legal", 612, 1008],
  ["Tabloid", 792, 1224],
];
function sizeName(w: number, h: number): string {
  const [a, b] = w <= h ? [w, h] : [h, w];
  for (const [name, nw, nh] of NAMED_SIZES) if (Math.abs(a - nw) < 3 && Math.abs(b - nh) < 3) return `${name}${w > h ? " landscape" : ""}`;
  return `${Math.round((w / 72) * 25.4)}×${Math.round((h / 72) * 25.4)} mm`;
}

const BTN = "inline-flex h-8 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-edge px-2 text-[12px] text-muted transition-colors hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40";
const ICON_BTN = "flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-edge text-muted transition-colors hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40";
const TOOL_BTN = "flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border text-muted transition-colors hover:text-ink disabled:pointer-events-none disabled:opacity-40";
const PRIMARY = "inline-flex h-8 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] bg-accent px-2.5 text-[12px] font-medium text-on-accent transition-[filter] hover:brightness-110 disabled:pointer-events-none disabled:opacity-40";

/* --------------------------------------------------------------- widget */

export function PdfStudioWidget() {
  /* url state */
  const [pageParam, setPageParam] = useQueryState("p", parseAsInteger.withDefault(1).withOptions({ history: "replace", throttleMs: 300 }));
  const [zoom, setZoom] = useQueryState("z", parseAsString.withDefault("auto").withOptions({ history: "replace", throttleMs: 300 }));
  const [view, setView] = useQueryState("view", parseAsStringLiteral(VIEWS).withDefault("continuous").withOptions({ history: "replace" }));
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(TABS).withDefault("pages").withOptions({ history: "replace" }));
  const [tool, setTool] = useQueryState("tool", parseAsStringLiteral(TOOLS).withDefault("select").withOptions({ history: "replace" }));
  const [sampleParam, setSampleParam] = useQueryState("sample", parseAsInteger.withOptions({ history: "replace" }));

  /* document */
  const [doc, setDoc] = useState<DocState | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [phase, setPhase] = useState<Phase>("empty");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ bytes: Uint8Array; name: string; handle: FileSystemFileHandle | null; wrong: boolean } | null>(null);
  const [password, setPassword] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [editorState, setEditorState] = useState<EditorState>({ isEditing: false, isEmpty: true, hasSomethingToUndo: false, hasSomethingToRedo: false, hasSelectedEditor: false });
  const [editorDirty, setEditorDirty] = useState(false);
  const [params, setParams] = useState<EditorParams>(DEFAULT_PARAMS);
  const [noteColor, setNoteColor] = useState(NOTE_COLORS[0]);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [restorable, setRestorable] = useState<Autosave | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [author, setAuthorState] = useState(() => readAuthor());
  const [sidebarOpen, setSidebarOpen] = useState(() => readShareState<{ side: boolean }>("pdf")?.side ?? (typeof window === "undefined" ? true : window.innerWidth >= 1024));
  useShareState("pdf", { side: sidebarOpen });
  const [find, setFind] = useState<{ open: boolean; query: string; caseSensitive: boolean; entireWord: boolean; result: FindResult }>({ open: false, query: "", caseSensitive: false, entireWord: false, result: { status: "idle", current: 0, total: 0 } });
  const [menuOpen, setMenuOpen] = useState<"open" | "more" | null>(null);

  /* document-derived */
  const [outline, setOutline] = useState<OutlineNode[] | null>(null);
  const [attachments, setAttachments] = useState<Attachment[] | null>(null);
  const [labels, setLabels] = useState<string[] | null>(null);
  const [meta, setMeta] = useState<{ info: Record<string, unknown>; permissions: Set<number> | null } | null>(null);
  const [pageGeom, setPageGeom] = useState<{ ratios: number[]; sizes: string[] }>({ ratios: [], sizes: [] });
  const [comments, setComments] = useState<PdfComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [selectedComment, setSelectedComment] = useState<string | null>(null);
  const [filter, setFilter] = useState<CommentFilter>({ unresolved: false, withText: false, page: null });
  const [pagesSelected, setPagesSelected] = useState<Set<number>>(new Set());

  const api = useRef<PdfViewerApi>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /** The viewer pane's element, for placing comment popovers (state, since it is read while rendering). */
  const [viewerHost, setViewerHost] = useState<HTMLDivElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const insertInput = useRef<HTMLInputElement>(null);
  const history = useRef<{ past: Uint8Array[]; future: Uint8Array[] }>({ past: [], future: [] });
  /** How deep the undo and redo stacks are (a ref is not read while rendering). */
  const [depth, setDepth] = useState({ past: 0, future: 0 });
  const findInput = useRef<HTMLInputElement>(null);
  const versionRef = useRef(0);

  const ops = useMemo(() => new PdfOpsClient(), []);
  const manager = useMemo(() => new BenchCommentManager(), []);
  const liveSnap = useSyncExternalStore(manager.subscribe, manager.snapshot, manager.snapshot);
  const thumbs = useThumbnails(pdf, rotation, 128);

  useEffect(() => () => ops.dispose(), [ops]);

  const dirty = !!doc && (doc.dirty || editorDirty || liveSnap.live.length > 0);
  useUnsavedWork(busy ? "A change to the PDF is being written." : dirty ? "The changes to this PDF have not been saved." : null);

  const pageLabel = useCallback(
    (i: number) => {
      const l = labels?.[i];
      return l && l !== String(i + 1) ? `${l} (${i + 1})` : String(i + 1);
    },
    [labels],
  );

  const say = useCallback((text: string) => setStatus(text), []);
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 5000);
    return () => clearTimeout(t);
  }, [status]);

  /* ----------------------------------------------------------- opening */

  const openBytes = useCallback(
    (bytes: Uint8Array, name: string, handle: FileSystemFileHandle | null, source: DocState["source"], pw?: string, dirtyFromStart = false) => {
      history.current = { past: [], future: [] };
      setDepth({ past: 0, future: 0 });
      ops.invalidate();
      manager.destroy();
      const version = ++versionRef.current;
      setDoc({ bytes, name, version, docKey: `${name}:${version}`, handle, password: pw, dirty: dirtyFromStart, source });
      setPending(null);
      setPassword("");
      setError(null);
      setPhase("ready");
      setRotation(0);
      setSelectedComment(null);
      setPagesSelected(new Set());
      setEditorDirty(false);
      setFind((f) => ({ ...f, open: false, result: { status: "idle", current: 0, total: 0 } }));
      if (source === "file") void rememberRecent({ name, size: bytes.length, openedAt: Date.now(), handle }).then(() => recentFiles().then(setRecent));
    },
    [ops, manager],
  );

  const openFile = useCallback(
    async (file: File, handle: FileSystemFileHandle | null = null) => {
      setPhase("loading");
      setError(null);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!isPdf(bytes)) throw new Error(`“${file.name}” does not look like a PDF (no %PDF header).`);
        openBytes(bytes, file.name, handle, "file");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase(doc ? "ready" : "error");
      }
    },
    [doc, openBytes],
  );

  const guardReplace = useCallback(() => !dirty || window.confirm("The open PDF has unsaved changes. Replace it anyway?"), [dirty]);

  const pick = useCallback(async () => {
    if (!guardReplace()) return;
    if (hasFilePicker()) {
      const handles = await pickPdf().catch(() => null);
      if (!handles?.length) return;
      const file = await handles[0].getFile();
      await openFile(file, handles[0]);
    } else fileInput.current?.click();
  }, [guardReplace, openFile]);

  const openSample = useCallback(async () => {
    if (!guardReplace()) return;
    setPhase("loading");
    try {
      const bytes = await ops.sample();
      openBytes(bytes, SAMPLE_NAME, null, "sample");
      say("The sample opened — look at page 2's comments, the form on page 3, and the Organise tab.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [guardReplace, ops, openBytes, say]);

  const openRecent = useCallback(
    async (entry: RecentEntry) => {
      if (!entry.handle) return;
      if (!(await ensurePermission(entry.handle, "read"))) {
        say("The browser did not grant access to that file; open it again.");
        return;
      }
      await openFile(await entry.handle.getFile(), entry.handle);
    },
    [openFile, say],
  );

  const restore = useCallback(() => {
    if (!restorable) return;
    openBytes(new Uint8Array(restorable.bytes), restorable.name, restorable.handle, "restore", undefined, restorable.dirty);
    setRestorable(null);
  }, [restorable, openBytes]);

  // On mount: the sample when the link asks for it, else what the browser remembers.
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      if (sampleParam === 1) {
        void openSample();
        void setSampleParam(null);
      }
    });
    void loadAutosave().then((a) => active && a && setRestorable(a));
    void recentFiles().then((r) => active && setRecent(r));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave the working copy (debounced) so a reload can bring it back.
  useEffect(() => {
    if (!doc || doc.bytes.length > AUTOSAVE_LIMIT) return;
    const t = setTimeout(() => {
      void saveAutosave({ name: doc.name, bytes: doc.bytes.slice().buffer as ArrayBuffer, savedAt: Date.now(), dirty: doc.dirty, handle: doc.handle });
    }, 1500);
    return () => clearTimeout(t);
  }, [doc]);

  /* ----------------------------------------------------- document info */

  useEffect(() => {
    if (!pdf) {
      queueMicrotask(() => {
        setOutline(null);
        setAttachments(null);
        setLabels(null);
        setMeta(null);
        setPageGeom({ ratios: [], sizes: [] });
      });
      return;
    }
    let active = true;
    const p = pdf;
    void p.getOutline().then(async (o) => {
      const nodes = toOutline(o ?? []);
      // Top-level chapters get their page index (for splitting by chapter); a few hundred lookups at most.
      for (const n of nodes.slice(0, 300)) n.pageIndex = await destinationPage(p, n.dest);
      if (active) setOutline(nodes);
    });
    void p.getAttachments().then((a) => {
      if (!active) return;
      const list: Attachment[] = [];
      const entries = (a instanceof Map ? [...a.entries()] : a ? Object.entries(a) : []) as [string, { filename?: string; content?: unknown; description?: string }][];
      for (const [name, v] of entries) list.push({ name, filename: v?.filename ?? name, size: v?.content instanceof Uint8Array ? v.content.length : null, description: v?.description });
      setAttachments(list);
    });
    void p.getPageLabels().then((l) => active && setLabels(l));
    void Promise.all([p.getMetadata(), p.getPermissions()]).then(([m, perms]) => active && setMeta({ info: (m.info ?? {}) as Record<string, unknown>, permissions: perms ? new Set(perms) : null }));
    (async () => {
      const ratios: number[] = [], sizes: string[] = [];
      for (let i = 0; i < p.numPages; i++) {
        const pg = await p.getPage(i + 1);
        if (!active) return;
        const [x0, y0, x1, y1] = pg.view;
        const w = x1 - x0, h = y1 - y0;
        const turned = (pg.rotate + rotation) % 180 !== 0;
        ratios.push(turned ? h / w : w / h);
        sizes.push(sizeName(pg.rotate % 180 ? h : w, pg.rotate % 180 ? w : h));
        if (i % 40 === 39 || i === p.numPages - 1) setPageGeom({ ratios: [...ratios], sizes: [...sizes] });
      }
    })();
    return () => {
      active = false;
    };
  }, [pdf, rotation]);

  // The comments: every page's annotations, with the text under text markups.
  useEffect(() => {
    if (!pdf) {
      queueMicrotask(() => setComments([]));
      return;
    }
    let active = true;
    const p = pdf;
    queueMicrotask(() => active && setCommentsLoading(true));
    (async () => {
      const pages: { page: number; annots: RawAnnotation[]; text?: TextItem[] }[] = [];
      for (let i = 0; i < p.numPages; i++) {
        const pg = await p.getPage(i + 1);
        const annots = (await pg.getAnnotations({ intent: "any" })) as RawAnnotation[];
        if (!active) return;
        const markup = annots.filter((a) => kindOf(a.subtype) !== null);
        if (!markup.length) continue;
        let text: TextItem[] | undefined;
        if (markup.some((a) => a.quadPoints && a.quadPoints.length >= 8)) {
          const tc = await pg.getTextContent();
          if (!active) return;
          text = tc.items.filter((it) => "str" in it) as unknown as TextItem[];
        }
        pages.push({ page: i, annots: markup, text });
      }
      if (!active) return;
      setComments(buildComments(pages));
      setCommentsLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [pdf]);

  // Whether a text selection sits inside the viewer (for Underline / Strike-out).
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      const c = api.current?.container();
      setHasSelection(!!sel && !sel.isCollapsed && !!c && !!sel.anchorNode && c.contains(sel.anchorNode) && sel.toString().trim().length > 0);
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  /* ------------------------------------------------------------ changes */

  const pushHistory = useCallback((bytes: Uint8Array) => {
    const h = history.current;
    h.past.push(bytes);
    h.future = [];
    let total = h.past.reduce((n, b) => n + b.length, 0);
    while (h.past.length > MAX_HISTORY || (total > MAX_HISTORY_BYTES && h.past.length > 1)) total -= h.past.shift()!.length;
    setDepth({ past: h.past.length, future: 0 });
  }, []);

  /** The editors' and form fields' changes written into the bytes (and the author named on them). */
  const bake = useCallback(
    async (current: DocState): Promise<Uint8Array> => {
      const baked = await api.current?.save();
      if (!baked) return current.bytes;
      if (!author.trim()) return baked;
      const r = await ops.run(baked, { type: "author", author }, current.password);
      return r.bytes;
    },
    [author, ops],
  );

  const applyBytes = useCallback((bytes: Uint8Array, patch: Partial<DocState> = {}) => {
    const version = ++versionRef.current;
    manager.destroy();
    setEditorDirty(false);
    setDoc((d) => (d ? { ...d, bytes, version, dirty: true, ...patch } : d));
  }, [manager]);

  /** Bakes, snapshots, runs the operations, and swaps the bytes in. Files an operation produces are handed back. */
  const runOps = useCallback(
    async (op: PdfOp | PdfOp[], label: string, opts: { quiet?: boolean } = {}) => {
      if (!doc || busy) return null;
      setBusy(label);
      let bytes = doc.bytes;
      try {
        bytes = await bake(doc);
        pushHistory(bytes);
        const r = await ops.run(bytes, op, doc.password);
        if (r.changed) applyBytes(r.bytes);
        else if (bytes !== doc.bytes) applyBytes(bytes);
        if (!opts.quiet) say(`${label} · ${Math.round(r.ms)} ms`);
        return r;
      } catch (e) {
        if (bytes !== doc.bytes) applyBytes(bytes);
        setError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setBusy(null);
      }
    },
    [doc, busy, bake, pushHistory, ops, applyBytes, say],
  );

  const undo = useCallback(() => {
    if (editorState.hasSomethingToUndo) {
      api.current?.undo();
      return;
    }
    const h = history.current;
    const prev = h.past.pop();
    if (!prev || !doc) return;
    h.future.push(doc.bytes);
    setDepth({ past: h.past.length, future: h.future.length });
    applyBytes(prev);
    say("Undone");
  }, [editorState.hasSomethingToUndo, doc, applyBytes, say]);

  const redo = useCallback(() => {
    if (editorState.hasSomethingToRedo) {
      api.current?.redo();
      return;
    }
    const h = history.current;
    const next = h.future.pop();
    if (!next || !doc) return;
    h.past.push(doc.bytes);
    setDepth({ past: h.past.length, future: h.future.length });
    applyBytes(next);
    say("Redone");
  }, [editorState.hasSomethingToRedo, doc, applyBytes, say]);

  /* ------------------------------------------------------------- saving */

  const finalBytes = useCallback(async (): Promise<Uint8Array | null> => {
    if (!doc) return null;
    const bytes = await bake(doc);
    if (bytes !== doc.bytes) applyBytes(bytes);
    return bytes;
  }, [doc, bake, applyBytes]);

  const save = useCallback(async () => {
    if (!doc || busy) return;
    setBusy("Saving");
    try {
      const bytes = await finalBytes();
      if (!bytes) return;
      let handle = doc.handle;
      if (handle && !(await ensurePermission(handle, "readwrite"))) handle = null;
      if (!handle && hasSavePicker()) handle = await pickSaveTarget(doc.source === "file" ? doc.name : derivedName(doc.name, "edited"));
      if (handle) {
        await writeToHandle(handle, bytes);
        setDoc((d) => (d ? { ...d, bytes, dirty: false, handle, name: handle!.name, source: "file" } : d));
        say(`Saved ${handle.name}`);
      } else {
        downloadBytes(bytes, derivedName(doc.name, "edited"));
        setDoc((d) => (d ? { ...d, bytes, dirty: false } : d));
        say("Downloaded");
      }
      void clearAutosave();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [doc, busy, finalBytes, say]);

  const saveAs = useCallback(async () => {
    if (!doc || busy) return;
    setBusy("Saving");
    try {
      const bytes = await finalBytes();
      if (!bytes) return;
      const name = derivedName(doc.name, "edited");
      if (hasSavePicker()) {
        const handle = await pickSaveTarget(name);
        if (!handle) return;
        await writeToHandle(handle, bytes);
        setDoc((d) => (d ? { ...d, bytes, dirty: false, handle, name: handle.name, source: "file" } : d));
        say(`Saved ${handle.name}`);
      } else {
        downloadBytes(bytes, name);
        say("Downloaded");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [doc, busy, finalBytes, say]);

  const download = useCallback(async () => {
    if (!doc || busy) return;
    setBusy("Preparing");
    try {
      const bytes = await finalBytes();
      if (bytes) downloadBytes(bytes, doc.dirty || bytes !== doc.bytes ? derivedName(doc.name, "edited") : doc.name);
    } finally {
      setBusy(null);
    }
  }, [doc, busy, finalBytes]);

  const print = useCallback(async () => {
    if (!doc || busy) return;
    setBusy("Preparing");
    try {
      const bytes = await finalBytes();
      if (!bytes) return;
      const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }));
      const w = window.open(url, "_blank");
      if (!w) downloadBytes(bytes, doc.name);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      say("Opened in a new tab — print from there.");
    } finally {
      setBusy(null);
    }
  }, [doc, busy, finalBytes, say]);

  const pagePng = useCallback(async () => {
    if (!pdf) return;
    const pg = await pdf.getPage(page);
    const viewport = pg.getViewport({ scale: 2, rotation: (pg.rotate + rotation) % 360 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    await pg.render({ canvasContext: ctx, canvas, viewport }).promise;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(doc?.name ?? "page").replace(/\.pdf$/i, "")}-p${page}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }, "image/png");
  }, [pdf, page, rotation, doc]);

  /** pdf.js lists attachments without their bytes; they are fetched when one is downloaded. */
  const downloadAttachment = useCallback(
    async (a: Attachment) => {
      if (!pdf) return;
      try {
        const got = (await (pdf as unknown as { getAttachmentContent(id: string): Promise<unknown> }).getAttachmentContent(a.name)) as Uint8Array | { content?: Uint8Array | null } | null;
        const bytes = got instanceof Uint8Array ? got : got?.content instanceof Uint8Array ? got.content : null;
        if (!bytes) throw new Error("The attachment's data could not be read.");
        downloadBytes(bytes, a.filename, "application/octet-stream");
        setAttachments((list) => list?.map((x) => (x.name === a.name ? { ...x, size: bytes.length } : x)) ?? list);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [pdf],
  );

  const close = useCallback(() => {
    if (!guardReplace()) return;
    setDoc(null);
    setPdf(null);
    setPhase("empty");
    setError(null);
    manager.destroy();
    history.current = { past: [], future: [] };
    setDepth({ past: 0, future: 0 });
    void clearAutosave();
    void setPageParam(1);
  }, [guardReplace, manager, setPageParam]);

  /* ----------------------------------------------------------- comments */

  const setAuthor = useCallback((name: string) => {
    setAuthorState(name);
    writeAuthor(name);
  }, []);

  const commentActions = useMemo(
    () => ({
      onReveal: (c: PdfComment) => api.current?.reveal(c.page, c.rect, c.id),
      onReply: async (c: PdfComment, text: string) => {
        await runOps({ type: "reply", parentId: c.id, text, author: author || "Anonymous" }, "Reply added");
      },
      onResolve: async (c: PdfComment, resolved: boolean) => {
        await runOps({ type: "resolve", parentId: c.id, resolved, author: author || "Anonymous" }, resolved ? "Resolved" : "Reopened");
      },
      onEdit: async (c: PdfComment, text: string) => {
        await runOps({ type: "contents", id: c.id, text }, "Comment edited");
      },
      onDelete: async (c: PdfComment) => {
        if (!window.confirm(c.replies.length ? "Delete this comment and its replies?" : "Delete this comment?")) return;
        await runOps({ type: "delete-annot", id: c.id }, "Comment deleted");
        setSelectedComment(null);
      },
    }),
    [runOps, author],
  );

  const liveActions = useMemo(
    () => ({
      onReveal: (l: LiveComment) => {
        api.current?.selectEditor(l.pageIndex, l.uid);
        manager.show(l.target);
      },
      onEdit: (l: LiveComment) => manager.edit(l.target),
      onDelete: (l: LiveComment) => manager.deleteComment(l.target),
    }),
    [manager],
  );

  const addNote = useCallback(
    async (text: string) => {
      if (dialog?.kind !== "note") return;
      const { page: p, x, y } = dialog;
      setDialog(null);
      const r = await runOps({ type: "note", page: p, x, y, text, author: author || "Anonymous", color: hexToRgb(noteColor) }, "Note added");
      if (r?.annotId) setSelectedComment(r.annotId);
      setTab("comments");
    },
    [dialog, runOps, author, noteColor, setTab],
  );

  const markupSelection = useCallback(
    async (subtype: "Underline" | "StrikeOut") => {
      const sel = api.current?.selectionQuads();
      if (!sel) {
        say("Select some text first.");
        return;
      }
      api.current?.clearSelection();
      window.getSelection()?.removeAllRanges();
      const r = await runOps({ type: "markup", page: sel.page, subtype, quads: sel.quads, color: subtype === "Underline" ? [0.16, 0.45, 0.9] : [0.86, 0.2, 0.2], author: author || "Anonymous", opacity: 1 }, subtype === "Underline" ? "Underlined" : "Struck out");
      if (r?.annotId) setSelectedComment(r.annotId);
    },
    [runOps, author, say],
  );

  const markdown = useMemo(() => commentsMarkdown(comments, (p) => `Page ${pageLabel(p)}`), [comments, pageLabel]);

  /* -------------------------------------------------------------- pages */

  const pagesActions = useMemo(
    () => ({
      onRotate: (pages: number[], delta: 90 | -90) => void runOps({ type: "rotate", pages, delta }, `Rotated ${pages.length} page${pages.length > 1 ? "s" : ""}`),
      onDelete: (pages: number[]) => {
        if (!window.confirm(`Delete ${pages.length === 1 ? `page ${pages[0] + 1}` : `${pages.length} pages`}?`)) return;
        void runOps({ type: "delete-pages", pages }, "Pages deleted").then(() => setPagesSelected(new Set()));
      },
      onDuplicate: (pages: number[]) => void runOps({ type: "duplicate", pages }, "Pages duplicated"),
      onBlank: (at: number) => void runOps({ type: "blank", at }, "Blank page inserted"),
      onInsertPdf: (at: number) => {
        insertInput.current?.setAttribute("data-at", String(at));
        insertInput.current?.click();
      },
      onExtract: (pages: number[]) => {
        const name = `${(doc?.name ?? "pages").replace(/\.pdf$/i, "")}-${runLabel(pages.map((p) => p + 1))}.pdf`;
        void runOps({ type: "extract", pages, name }, "Extracted").then((r) => r?.files?.forEach((f) => downloadBytes(f.bytes, f.name)));
      },
      onSplit: () => setDialog({ kind: "split" }),
      onCrop: (pages: number[]) => setDialog({ kind: "crop", pages }),
      onMove: (order: number[]) => void runOps({ type: "reorder", order }, "Pages reordered"),
    }),
    [runOps, doc],
  );

  const insertPdf = useCallback(
    async (file: File, at: number, pw?: string) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!isPdf(bytes)) {
        setError(`“${file.name}” does not look like a PDF.`);
        return;
      }
      const r = await runOps({ type: "insert-pdf", at, bytes, password: pw }, `Inserted ${file.name}`);
      if (r) setDialog(null);
      else setDialog({ kind: "insert", at, bytes, name: file.name, wrong: pw !== undefined });
    },
    [runOps],
  );

  const split = useCallback(
    async (mode: "every" | "ranges" | "chapters", every: number, ranges: string) => {
      if (!doc) return;
      const count = pageCount;
      let runs: number[][] = [];
      if (mode === "every") runs = chunkPages(count, every);
      else if (mode === "ranges") {
        for (const part of ranges.split(/\s*[|;]\s*|\n/)) {
          if (!part.trim()) continue;
          const r = parsePageRanges(part, count);
          if (!r.ok) {
            setError(r.error);
            return;
          }
          runs.push(r.pages);
        }
      } else {
        const starts = (outline ?? []).map((n) => n.pageIndex).filter((p): p is number => typeof p === "number").map((p) => p + 1);
        runs = chunksFrom(count, starts);
      }
      if (!runs.length) return;
      setDialog(null);
      const base = doc.name.replace(/\.pdf$/i, "");
      const names = runs.map((run, i) => `${base}-${String(i + 1).padStart(2, "0")}-${runLabel(run)}.pdf`);
      const r = await runOps({ type: "split", runs: runs.map((run) => run.map((p) => p - 1)), names }, `Split into ${runs.length} files`);
      if (!r?.files) return;
      if (r.files.length === 1) downloadBytes(r.files[0].bytes, r.files[0].name);
      else downloadBytes(await buildZip(r.files.map((f) => ({ name: f.name, data: f.bytes, mtime: Date.now() }))), `${base}-split.zip`, "application/zip");
    },
    [doc, pageCount, outline, runOps],
  );

  /* ----------------------------------------------------------- keyboard */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!doc) return;
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (e.shiftKey) void saveAs();
        else void save();
        return;
      }
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFind((f) => ({ ...f, open: true }));
        setTimeout(() => findInput.current?.select(), 0);
        return;
      }
      if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void pick();
        return;
      }
      if (typing || e.defaultPrevented) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod) return;
      switch (e.key) {
        case "Escape":
          if (dialog) setDialog(null);
          else if (find.open) {
            api.current?.closeFind();
            setFind((f) => ({ ...f, open: false }));
          } else if (tool !== "select") void setTool("select");
          else manager.closePopup();
          break;
        case "ArrowLeft":
        case "PageUp":
          if (view === "single" || e.key === "PageUp") {
            e.preventDefault();
            api.current?.goTo(page - 1);
          }
          break;
        case "ArrowRight":
        case "PageDown":
          if (view === "single" || e.key === "PageDown") {
            e.preventDefault();
            api.current?.goTo(page + 1);
          }
          break;
        case "Home":
          e.preventDefault();
          api.current?.goTo(1);
          break;
        case "End":
          e.preventDefault();
          api.current?.goTo(pageCount);
          break;
        case "+":
        case "=":
          api.current?.zoomIn();
          break;
        case "-":
          api.current?.zoomOut();
          break;
        case "0":
          void setZoom("auto");
          break;
        case "h":
          void setTool(tool === "highlight" ? "select" : "highlight");
          break;
        case "n":
          void setTool(tool === "note" ? "select" : "note");
          break;
        case "t":
          void setTool(tool === "text" ? "select" : "text");
          break;
        case "d":
          void setTool(tool === "draw" ? "select" : "draw");
          break;
        case "v":
          void setTool("select");
          break;
        case "r":
          setRotation((r) => (r + 90) % 360);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, dialog, find.open, tool, view, page, pageCount, save, saveAs, pick, undo, redo, setTool, setZoom, manager]);

  // A handle for headless checks: the pdf.js document, the bytes, and the operations.
  useEffect(() => {
    const w = window as unknown as { __benchPdf?: unknown };
    w.__benchPdf = {
      document: () => pdf,
      bytes: () => doc?.bytes ?? null,
      name: () => doc?.name ?? null,
      run: (op: PdfOp | PdfOp[], label = "Check") => runOps(op, label),
      api: () => api.current,
      comments: () => comments,
    };
    return () => {
      delete w.__benchPdf;
    };
  }, [pdf, doc, runOps, comments]);

  // Menus close on an outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest("[data-menu]")) setMenuOpen(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

  /* ---------------------------------------------------------------- info */

  const info = useMemo<DocInfo | null>(() => {
    if (!doc || !pdf || !meta) return null;
    const i = meta.info;
    const s = (k: string) => (typeof i[k] === "string" ? (i[k] as string) : "");
    const perms = meta.permissions;
    const PERM: [number, string][] = [
      [4, "print"],
      [8, "modify"],
      [16, "copy"],
      [32, "annotate"],
      [256, "fill forms"],
      [1024, "assemble"],
    ];
    const uniq = [...new Set(pageGeom.sizes)];
    return {
      name: doc.name,
      size: doc.bytes.length,
      pages: pdf.numPages,
      pdfVersion: s("PDFFormatVersion"),
      title: s("Title"),
      author: s("Author"),
      subject: s("Subject"),
      keywords: s("Keywords"),
      creator: s("Creator"),
      producer: s("Producer"),
      created: parsePdfDate(s("CreationDate")),
      modified: parsePdfDate(s("ModDate")),
      encrypted: !!doc.password || !!s("EncryptFilterName"),
      permissions: perms ? PERM.filter(([bit]) => perms.has(bit)).map(([, n]) => n) : null,
      form: i.IsAcroFormPresent === true,
      xfa: i.IsXFAPresent === true,
      signatures: i.IsSignaturesPresent === true,
      linearized: i.IsLinearized === true,
      language: s("Language"),
      pageSizes: uniq.length === 1 ? uniq[0] : uniq.length ? `${uniq.length} sizes (${uniq.slice(0, 3).join(", ")}${uniq.length > 3 ? "…" : ""})` : "",
      annotations: comments.length,
    };
  }, [doc, pdf, meta, pageGeom.sizes, comments.length]);

  /* ------------------------------------------------------------- render */

  const current = doc;
  const tabs = [
    { id: "pages" as const, label: "Pages", icon: <FileText size={14} /> },
    { id: "outline" as const, label: "Outline", icon: <List size={14} />, count: outline?.length || undefined },
    { id: "comments" as const, label: "Comments", icon: <MessageSquare size={14} />, count: comments.length + liveSnap.live.length || undefined },
    { id: "organise" as const, label: "Organise", icon: <LayoutGrid size={14} /> },
    { id: "attachments" as const, label: "Files", icon: <Paperclip size={14} />, count: attachments?.length || undefined },
    { id: "info" as const, label: "Info", icon: <Info size={14} /> },
  ];

  const onDropFiles = (files: FileList | File[]) => {
    const file = Array.from(files).find((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf") ?? Array.from(files)[0];
    if (file && guardReplace()) void openFile(file);
  };

  const sidebar = (
    <div className="panel flex h-full min-h-0 flex-col overflow-hidden" data-pdf-sidebar>
      <SidebarTabs tab={tab} onTab={(t) => void setTab(t)} tabs={tabs} />
      <div className="min-h-0 flex-1">
        {tab === "pages" && <ThumbList count={pageCount} current={page} ratios={pageGeom.ratios} thumbs={thumbs} onGoTo={(p) => api.current?.goTo(p)} pageLabel={pageLabel} />}
        {tab === "outline" && (
          <OutlineList
            outline={outline}
            onGo={(n) => {
              if (n.url) window.open(n.url, "_blank", "noopener,noreferrer");
              else if (n.dest) api.current?.goToDestination(n.dest);
            }}
          />
        )}
        {tab === "comments" && (
          <CommentsPanel
            comments={comments}
            live={liveSnap.live}
            selected={selectedComment}
            onSelect={setSelectedComment}
            actions={commentActions}
            liveActions={liveActions}
            busy={!!busy}
            author={author}
            onAuthor={setAuthor}
            pageLabel={(p) => `p. ${pageLabel(p)}`}
            filter={filter}
            onFilter={setFilter}
            pageCount={pageCount}
            markdown={markdown}
            onExportJson={() => downloadBytes(new TextEncoder().encode(commentsJson(comments, current?.name ?? "")), `${(current?.name ?? "comments").replace(/\.pdf$/i, "")}-comments.json`, "application/json")}
            loading={commentsLoading}
          />
        )}
        {tab === "organise" && <PagesPanel count={pageCount} ratios={pageGeom.ratios} sizes={pageGeom.sizes} current={page} thumbs={thumbs} selected={pagesSelected} onSelected={setPagesSelected} onGoTo={(p) => api.current?.goTo(p)} busy={!!busy} actions={pagesActions} pageLabel={pageLabel} />}
        {tab === "attachments" && <AttachmentList attachments={attachments} onDownload={(a) => void downloadAttachment(a)} />}
        {tab === "info" && <InfoPanel info={info} busy={!!busy} onEdit={async (patch: Partial<PdfInfo>) => void (await runOps({ type: "info", patch }, "Document info saved"))} />}
      </div>
    </div>
  );

  const viewerPane = (
    <div ref={setViewerHost} className="panel relative flex h-full min-h-0 flex-col overflow-hidden" data-pdf-viewer-pane>
      {find.open && (
        <form
          className="flex flex-wrap items-center gap-1.5 border-b border-edge px-2 py-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            api.current?.findAgain(false);
          }}
          data-find-bar
        >
          <Search size={13} className="text-faint" />
          <input
            ref={findInput}
            value={find.query}
            onChange={(e) => {
              const query = e.target.value;
              setFind((f) => ({ ...f, query }));
              api.current?.find(query, { caseSensitive: find.caseSensitive, entireWord: find.entireWord });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.shiftKey) {
                e.preventDefault();
                api.current?.findAgain(true);
              }
            }}
            placeholder="Find in document"
            className="input h-7 w-52 px-2 py-0 text-[12.5px]"
            data-find-input
          />
          <span className="tabular text-[12px] text-muted" data-find-count>
            {find.result.status === "notfound" ? "No matches" : find.result.total ? `${find.result.current} of ${find.result.total}` : find.result.status === "pending" ? "…" : ""}
          </span>
          <button type="button" onClick={() => api.current?.findAgain(true)} className={ICON_BTN} title="Previous (⇧↵)">
            <ChevronLeft size={14} />
          </button>
          <button type="button" onClick={() => api.current?.findAgain(false)} className={ICON_BTN} title="Next (↵)">
            <ChevronRight size={14} />
          </button>
          <label className="inline-flex items-center gap-1 text-[12px] text-muted">
            <input type="checkbox" checked={find.caseSensitive} onChange={(e) => setFind((f) => ({ ...f, caseSensitive: e.target.checked }))} className="accent-[var(--accent)]" /> Match case
          </label>
          <label className="inline-flex items-center gap-1 text-[12px] text-muted">
            <input type="checkbox" checked={find.entireWord} onChange={(e) => setFind((f) => ({ ...f, entireWord: e.target.checked }))} className="accent-[var(--accent)]" /> Whole words
          </label>
          <button
            type="button"
            onClick={() => {
              api.current?.closeFind();
              setFind((f) => ({ ...f, open: false }));
            }}
            className={cn(ICON_BTN, "ml-auto")}
            title="Close (Esc)"
          >
            <X size={14} />
          </button>
        </form>
      )}
      <div className="relative min-h-0 flex-1 bg-base-2" data-pdf-stage>
        {current && (
          <PdfViewerHost
            ref={api}
            bytes={current.bytes}
            version={current.version}
            docKey={current.docKey}
            password={current.password}
            page={pageParam}
            zoom={zoom}
            view={view}
            rotation={rotation}
            tool={tool}
            params={params}
            commentManager={manager}
            onDocument={setPdf}
            onPage={(p, n) => {
              setPage(p);
              setPageCount(n);
              void setPageParam(p);
            }}
            onZoom={(z) => void setZoom(z)}
            onToolChange={(t) => void setTool(t)}
            onEditorState={setEditorState}
            onFind={(result) => setFind((f) => ({ ...f, result }))}
            onDirty={setEditorDirty}
            onPassword={(wrong) => {
              setPending({ bytes: current.bytes, name: current.name, handle: current.handle, wrong });
              setDoc(null);
              setPhase("password");
            }}
            onError={(m) => {
              setError(m);
              setPhase("error");
            }}
            onNoteClick={({ page: p, x, y }) => setDialog({ kind: "note", page: p, x, y, clientX: 0, clientY: 0 })}
            onAnnotationClick={(id) => {
              setSelectedComment(id);
              if (tab !== "comments") void setTab("comments");
            }}
          />
        )}
        {/* pdf.js points its comment buttons' aria-controls at this element and keeps keyboard focus inside it. */}
        <div
          ref={(el) => manager.setDialogHost(el)}
          className="contents"
          data-comment-dialog-host
        >
          {liveSnap.dialog && (
            <CommentDialog
              state={liveSnap.dialog}
              host={viewerHost}
              author={author}
              onSave={(text) => manager.saveDialog(text)}
              onCancel={() => manager.cancelDialog()}
              onDelete={() => {
                const t = liveSnap.dialog!.target;
                manager.cancelDialog();
                manager.deleteComment(t);
              }}
            />
          )}
        </div>
        {liveSnap.popup && !liveSnap.dialog && <CommentPopup state={liveSnap.popup} host={viewerHost} author={author} onEdit={() => manager.edit(liveSnap.popup!.target)} onDelete={() => manager.deleteComment(liveSnap.popup!.target)} onClose={() => manager.closePopup()} />}
        {dialog?.kind === "note" && <NoteDialog color={noteColor} onColor={setNoteColor} author={author} onSave={addNote} onCancel={() => setDialog(null)} />}
        {busy && (
          <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-edge bg-base px-3 py-1 text-[12px] text-muted shadow-pop" data-pdf-busy>
              <Loader size={12} className="animate-spin" /> {busy}…
            </span>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div
      ref={rootRef}
      className="flex h-[82vh] min-h-[560px] flex-col gap-2"
      data-pdf-studio
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragOver(false);
        onDropFiles(e.dataTransfer.files);
      }}
      onPaste={(e) => {
        const files = Array.from(e.clipboardData.files);
        if (files.length) onDropFiles(files);
      }}
    >
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) void openFile(e.target.files[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={insertInput}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const at = Number(e.target.getAttribute("data-at") ?? pageCount);
          if (e.target.files?.[0]) void insertPdf(e.target.files[0], at);
          e.target.value = "";
        }}
      />

      {phase !== "ready" || !current ? (
        <EmptyState
          phase={phase}
          error={error}
          dragOver={dragOver}
          pending={pending}
          password={password}
          onPassword={setPassword}
          onUnlock={() => {
            if (pending && password) openBytes(pending.bytes, pending.name, pending.handle, "file", password);
          }}
          onPick={() => void pick()}
          onSample={() => void openSample()}
          restorable={restorable}
          onRestore={restore}
          onForgetRestore={() => {
            void clearAutosave();
            setRestorable(null);
          }}
          recent={recent}
          onRecent={(r) => void openRecent(r)}
          onReset={() => {
            setPending(null);
            setError(null);
            setPhase("empty");
          }}
        />
      ) : (
        <>
          {/* toolbar */}
          <div className="panel flex flex-wrap items-center gap-1 px-2 py-1.5" data-pdf-toolbar>
            <div className="relative" data-menu>
              <button type="button" onClick={() => setMenuOpen((m) => (m === "open" ? null : "open"))} className={BTN} title="Open (⌘O)" data-open-menu>
                <FolderOpen size={14} /> <span className="hidden sm:inline">Open</span>
              </button>
              {menuOpen === "open" && (
                <Menu onClose={() => setMenuOpen(null)}>
                  <MenuItem onClick={() => void pick()}>Open a PDF…</MenuItem>
                  <MenuItem onClick={() => void openSample()}>Open the sample</MenuItem>
                  {recent.filter((r) => r.handle).length > 0 && <div className="my-1 border-t border-edge" />}
                  {recent
                    .filter((r) => r.handle)
                    .slice(0, 6)
                    .map((r) => (
                      <MenuItem key={`${r.name}-${r.openedAt}`} onClick={() => void openRecent(r)}>
                        <span className="truncate">{r.name}</span>
                        <span className="ml-auto pl-3 text-[11px] text-faint">{formatBytes(r.size)}</span>
                      </MenuItem>
                    ))}
                  <div className="my-1 border-t border-edge" />
                  <MenuItem onClick={close}>Close the document</MenuItem>
                </Menu>
              )}
            </div>
            <button type="button" onClick={() => void save()} disabled={!!busy || (!dirty && !!current.handle)} className={cn(dirty ? PRIMARY : BTN)} title={current.handle ? `Save to ${current.name} (⌘S)` : "Save (⌘S)"} data-save>
              <Save size={14} /> <span className="hidden sm:inline">Save</span>
            </button>
            <button type="button" onClick={() => void saveAs()} disabled={!!busy} className={ICON_BTN} title="Save as… (⇧⌘S)" data-save-as>
              <Download size={14} />
            </button>
            <button type="button" onClick={() => void print()} disabled={!!busy} className={ICON_BTN} title="Print — opens the PDF in a new tab" data-print>
              <Printer size={14} />
            </button>
            <span className="mx-0.5 h-5 w-px bg-edge" />
            <button type="button" onClick={undo} disabled={!!busy || (!editorState.hasSomethingToUndo && depth.past === 0)} className={ICON_BTN} title="Undo (⌘Z)" data-undo>
              <Undo2 size={14} />
            </button>
            <button type="button" onClick={redo} disabled={!!busy || (!editorState.hasSomethingToRedo && depth.future === 0)} className={ICON_BTN} title="Redo (⇧⌘Z)" data-redo>
              <Redo2 size={14} />
            </button>
            <span className="mx-0.5 h-5 w-px bg-edge" />
            <div className="flex items-center gap-0.5 rounded-[var(--radius-sm)] border border-edge p-0.5" role="group" aria-label="Tools" data-tools>
              {(
                [
                  ["select", MousePointer2, "Select (V)"],
                  ["highlight", Highlighter, "Highlight text (H)"],
                  ["note", MessageSquarePlus, "Sticky note — click the page (N)"],
                  ["text", Type, "Text box (T)"],
                  ["draw", Pencil, "Draw (D)"],
                  ["image", ImagePlus, "Add an image"],
                ] as const
              ).map(([id, Icon, title]) => (
                <button key={id} type="button" onClick={() => void setTool(id)} className={cn(TOOL_BTN, "border-transparent", tool === id && "bg-accent text-on-accent hover:text-on-accent")} title={title} aria-pressed={tool === id} data-tool-button={id}>
                  <Icon size={14} />
                </button>
              ))}
            </div>
            {hasSelection && (
              <>
                <button type="button" onClick={() => void markupSelection("Underline")} disabled={!!busy} className={ICON_BTN} title="Underline the selection" data-underline>
                  <Underline size={14} />
                </button>
                <button type="button" onClick={() => void markupSelection("StrikeOut")} disabled={!!busy} className={ICON_BTN} title="Strike out the selection" data-strikeout>
                  <Strikethrough size={14} />
                </button>
              </>
            )}
            <span className="mx-0.5 h-5 w-px bg-edge" />
            <button
              type="button"
              onClick={() => {
                setFind((f) => ({ ...f, open: !f.open }));
                setTimeout(() => findInput.current?.select(), 0);
              }}
              className={cn(ICON_BTN, find.open && "border-accent text-accent")}
              title="Find (⌘F)"
              data-find-toggle
            >
              <Search size={14} />
            </button>
            <div className="ml-auto flex flex-wrap items-center gap-1">
              <button type="button" onClick={() => api.current?.zoomOut()} className={ICON_BTN} title="Zoom out (−)">
                <ZoomOut size={14} />
              </button>
              <select value={ZOOM_STEPS.includes(Number(zoom)) || ["auto", "fit", "width"].includes(zoom) ? zoom : "custom"} onChange={(e) => void setZoom(e.target.value)} className="input h-8 px-2 py-0 pr-6 text-[12px]" style={{ width: 104 }} aria-label="Zoom" data-zoom>
                <option value="auto">Auto</option>
                <option value="fit">Fit page</option>
                <option value="width">Fit width</option>
                {ZOOM_STEPS.map((z) => (
                  <option key={z} value={String(z)}>
                    {z}%
                  </option>
                ))}
                {!(ZOOM_STEPS.includes(Number(zoom)) || ["auto", "fit", "width"].includes(zoom)) && <option value="custom">{zoom}%</option>}
              </select>
              <button type="button" onClick={() => api.current?.zoomIn()} className={ICON_BTN} title="Zoom in (+)">
                <ZoomIn size={14} />
              </button>
              <span className="mx-0.5 h-5 w-px bg-edge" />
              <button type="button" onClick={() => api.current?.goTo(page - 1)} disabled={page <= 1} className={ICON_BTN} title="Previous page">
                <ChevronLeft size={14} />
              </button>
              <form
                className="flex items-center gap-1 text-[12px] tabular text-muted"
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = Number((e.currentTarget.elements.namedItem("page") as HTMLInputElement).value);
                  if (n) api.current?.goTo(n);
                }}
              >
                <input name="page" key={page} defaultValue={page} inputMode="numeric" className="input h-8 px-1 py-0 text-center text-[12px]" style={{ width: 48 }} aria-label="Page" data-page-input />
                <span>/ {pageCount}</span>
              </form>
              <button type="button" onClick={() => api.current?.goTo(page + 1)} disabled={page >= pageCount} className={ICON_BTN} title="Next page">
                <ChevronRight size={14} />
              </button>
              <span className="mx-0.5 h-5 w-px bg-edge" />
              <div className="flex items-center gap-0.5 rounded-[var(--radius-sm)] border border-edge p-0.5" role="group" aria-label="Layout">
                {(
                  [
                    ["continuous", StretchVertical],
                    ["single", Square],
                    ["two-up", Columns2],
                  ] as const
                ).map(([id, Icon]) => (
                  <button key={id} type="button" onClick={() => void setView(id)} className={cn(TOOL_BTN, "h-7 w-7 border-transparent", view === id && "bg-raised text-ink")} title={VIEW_LABELS[id]} aria-pressed={view === id} data-view={id}>
                    <Icon size={13} />
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setRotation((r) => (r + 90) % 360)} className={ICON_BTN} title="Rotate the view (R) — the Organise tab rotates pages for good" data-rotate-view>
                <RotateCw size={14} />
              </button>
              <button type="button" onClick={() => setSidebarOpen((o) => !o)} className={cn(ICON_BTN, sidebarOpen && "border-accent text-accent")} title={sidebarOpen ? "Hide the side panel" : "Show the side panel"} aria-pressed={sidebarOpen} data-sidebar-toggle>
                <PanelLeft size={14} />
              </button>
              <div className="relative" data-menu>
                <button type="button" onClick={() => setMenuOpen((m) => (m === "more" ? null : "more"))} className={ICON_BTN} title="More" data-more-menu>
                  <MoreHorizontal size={14} />
                </button>
                {menuOpen === "more" && (
                  <Menu onClose={() => setMenuOpen(null)} align="right">
                    <MenuItem onClick={() => void download()}>Download a copy</MenuItem>
                    <MenuItem onClick={() => void pagePng()}>Save page {page} as PNG</MenuItem>
                    <div className="my-1 border-t border-edge" />
                    <MenuItem onClick={() => void runOps({ type: "flatten", forms: true, annots: false }, "Form flattened")}>Flatten the form fields</MenuItem>
                    <MenuItem onClick={() => window.confirm("Remove every comment and mark-up from the document?") && void runOps({ type: "clear-annots", which: "markup" }, "Comments removed")}>Remove all comments</MenuItem>
                    <div className="my-1 border-t border-edge" />
                    {current.password ? <MenuItem onClick={() => void runOps({ type: "decrypt" }, "Password removed").then(() => setDoc((d) => (d ? { ...d, password: undefined } : d)))}>Remove the password</MenuItem> : <MenuItem onClick={() => setDialog({ kind: "protect" })}>Protect with a password…</MenuItem>}
                  </Menu>
                )}
              </div>
            </div>
            {tool !== "select" && tool !== "note" && tool !== "image" && (
              <div className="flex w-full flex-wrap items-center gap-2 border-t border-edge pt-1.5 text-[12px] text-muted" data-tool-options>
                {tool === "highlight" && (
                  <>
                    <span>Colour</span>
                    {HIGHLIGHT_COLORS.map((c) => (
                      <button key={c} type="button" onClick={() => setParams((p) => ({ ...p, highlightColor: c }))} className={cn("h-5 w-5 rounded-full border border-black/15", params.highlightColor === c && "ring-2 ring-accent ring-offset-1 ring-offset-[var(--color-surface)]")} style={{ background: c }} aria-label={`Highlight in ${c}`} aria-pressed={params.highlightColor === c} />
                    ))}
                    <label className="inline-flex items-center gap-1">
                      Free-hand width <input type="range" min={8} max={24} value={params.highlightThickness} onChange={(e) => setParams((p) => ({ ...p, highlightThickness: Number(e.target.value) }))} className="w-24 accent-[var(--accent)]" />
                    </label>
                    <span className="text-faint">Select text to highlight it; drag on empty space for a free-hand mark. Each highlight has a comment button.</span>
                  </>
                )}
                {tool === "draw" && (
                  <>
                    <label className="inline-flex items-center gap-1">
                      Colour <input type="color" value={params.inkColor} onChange={(e) => setParams((p) => ({ ...p, inkColor: e.target.value }))} className="h-6 w-8 cursor-pointer rounded border border-edge bg-transparent" />
                    </label>
                    <label className="inline-flex items-center gap-1">
                      Width <input type="range" min={1} max={20} value={params.inkThickness} onChange={(e) => setParams((p) => ({ ...p, inkThickness: Number(e.target.value) }))} className="w-24 accent-[var(--accent)]" />
                    </label>
                    <label className="inline-flex items-center gap-1">
                      Opacity <input type="range" min={10} max={100} value={Math.round(params.inkOpacity * 100)} onChange={(e) => setParams((p) => ({ ...p, inkOpacity: Number(e.target.value) / 100 }))} className="w-24 accent-[var(--accent)]" />
                    </label>
                  </>
                )}
                {tool === "text" && (
                  <>
                    <label className="inline-flex items-center gap-1">
                      Colour <input type="color" value={params.textColor} onChange={(e) => setParams((p) => ({ ...p, textColor: e.target.value }))} className="h-6 w-8 cursor-pointer rounded border border-edge bg-transparent" />
                    </label>
                    <label className="inline-flex items-center gap-1">
                      Size <input type="range" min={6} max={48} value={params.textSize} onChange={(e) => setParams((p) => ({ ...p, textSize: Number(e.target.value) }))} className="w-24 accent-[var(--accent)]" /> <span className="tabular">{params.textSize}</span>
                    </label>
                    <span className="text-faint">Click the page to place a text box.</span>
                  </>
                )}
              </div>
            )}
            {tool === "note" && (
              <div className="flex w-full flex-wrap items-center gap-2 border-t border-edge pt-1.5 text-[12px] text-muted" data-tool-options>
                <span>Note colour</span>
                {NOTE_COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => setNoteColor(c)} className={cn("h-5 w-5 rounded-full border border-black/15", noteColor === c && "ring-2 ring-accent ring-offset-1 ring-offset-[var(--color-surface)]")} style={{ background: c }} aria-label={`Notes in ${c}`} aria-pressed={noteColor === c} />
                ))}
                <span className="text-faint">Click anywhere on a page to leave a note there.</span>
              </div>
            )}
            {tool === "image" && <p className="w-full border-t border-edge pt-1.5 text-[12px] text-faint">Choose an image file when asked; it is placed on the page as a stamp you can move and resize.</p>}
          </div>

          <SplitPane id="pdf-studio" className="min-h-0 flex-1" defaultRatio={0.24} minFirst={240} minSecond={320} collapsible="first" firstLabel="side panel" secondLabel="document" stackBelow="never" gap={8} hidden={sidebarOpen ? null : "first"} first={sidebar} second={viewerPane} />

          {/* status */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11.5px] text-faint" data-pdf-status>
            <span className="truncate text-muted">{current.name}</span>
            <span className="tabular">{formatBytes(current.bytes.length)}</span>
            {current.password && (
              <span className="inline-flex items-center gap-1">
                <Lock size={10} /> protected
              </span>
            )}
            {dirty && <span className="text-warn">unsaved changes</span>}
            {status && <span className="text-ink">{status}</span>}
            {error && (
              <span className="inline-flex items-center gap-1 text-danger">
                {error}
                <button type="button" onClick={() => setError(null)} className="text-faint hover:text-ink" aria-label="Dismiss">
                  <X size={11} />
                </button>
              </span>
            )}
            <span className="ml-auto hidden sm:inline">⌘F find · ⌘S save · H N T D tools · R rotate view</span>
          </div>
        </>
      )}

      {dialog?.kind === "split" && <SplitDialog count={pageCount} hasOutline={(outline?.length ?? 0) > 1} onClose={() => setDialog(null)} onSplit={split} />}
      {dialog?.kind === "crop" && (
        <CropDialog
          pages={dialog.pages}
          onClose={() => setDialog(null)}
          onCrop={(inset) => {
            setDialog(null);
            void runOps({ type: "crop", pages: dialog.pages, inset }, "Cropped");
          }}
          onUncrop={() => {
            setDialog(null);
            void runOps({ type: "uncrop", pages: dialog.pages }, "Crop removed");
          }}
        />
      )}
      {dialog?.kind === "protect" && (
        <ProtectDialog
          onClose={() => setDialog(null)}
          onProtect={(user, owner) => {
            setDialog(null);
            void runOps({ type: "encrypt", userPassword: user, ownerPassword: owner }, "Protected").then((r) => r && setDoc((d) => (d ? { ...d, password: user } : d)));
          }}
        />
      )}
      {dialog?.kind === "insert" && (
        <PasswordDialog
          title={`“${dialog.name}” is protected`}
          wrong={dialog.wrong}
          onClose={() => setDialog(null)}
          onSubmit={(pw) => void insertPdf(new File([dialog.bytes as unknown as BlobPart], dialog.name), dialog.at, pw)}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------------- pieces */

function toOutline(items: { title: string; dest: string | unknown[] | null; url: string | null; items: unknown[]; bold?: boolean; italic?: boolean }[]): OutlineNode[] {
  return items.map((it) => ({ title: it.title, dest: it.dest, url: it.url, items: toOutline((it.items ?? []) as typeof items), bold: it.bold, italic: it.italic }));
}

/** The 0-based page an outline destination points at, or undefined when it cannot be resolved. */
async function destinationPage(pdf: PDFDocumentProxy, dest: string | unknown[] | null): Promise<number | undefined> {
  try {
    const arr = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
    const ref = arr?.[0];
    if (!ref || typeof ref !== "object") return undefined;
    return await pdf.getPageIndex(ref as { num: number; gen: number });
  } catch {
    return undefined;
  }
}

function Menu({ children, onClose, align = "left" }: { children: React.ReactNode; onClose(): void; align?: "left" | "right" }) {
  return (
    <div role="menu" className={cn("absolute top-full z-40 mt-1 min-w-52 rounded-[var(--radius)] border border-edge bg-base p-1 shadow-pop", align === "right" ? "right-0" : "left-0")} onClick={onClose} data-menu-list>
      {children}
    </div>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick(): void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex w-full items-center rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[12.5px] text-ink hover:bg-raised">
      {children}
    </button>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose(): void }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose} role="presentation">
      <div role="dialog" aria-label={title} className="w-full max-w-md rounded-[var(--radius)] border border-edge bg-base p-4 shadow-dialog" onClick={(e) => e.stopPropagation()} data-pdf-dialog={title}>
        <div className="mb-3 flex items-center">
          <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
          <button type="button" onClick={onClose} className={cn(ICON_BTN, "ml-auto h-7 w-7 border-0")} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function NoteDialog({ color, onColor, author, onSave, onCancel }: { color: string; onColor(c: string): void; author: string; onSave(text: string): void; onCancel(): void }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div role="dialog" aria-label="New note" className="absolute left-1/2 top-4 z-30 w-[min(320px,calc(100%-16px))] -translate-x-1/2 rounded-[var(--radius)] border border-edge bg-base p-2 shadow-pop" data-note-dialog onPointerDown={(e) => e.stopPropagation()}>
      <div className="mb-1 flex items-center gap-1.5 text-[11.5px] text-faint">
        <MessageSquarePlus size={12} />
        <span>{author || "New note"}</span>
        <span className="ml-auto flex items-center gap-1">
          {NOTE_COLORS.map((c) => (
            <button key={c} type="button" onClick={() => onColor(c)} className={cn("h-4 w-4 rounded-full border border-black/15", color === c && "ring-2 ring-accent")} style={{ background: c }} aria-label={`Colour ${c}`} />
          ))}
        </span>
      </div>
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
            onSave(text);
          }
        }}
        rows={3}
        placeholder="Write the note…"
        className="w-full resize-y rounded-[var(--radius-sm)] border border-edge bg-base px-2 py-1.5 text-[13px] leading-snug text-ink outline-none placeholder:text-faint focus:border-accent"
        data-note-text
      />
      <div className="mt-1.5 flex items-center gap-1">
        <button type="button" disabled={!text.trim()} onClick={() => onSave(text)} className={PRIMARY} data-note-save>
          Add note
        </button>
        <button type="button" onClick={onCancel} className={BTN}>
          Cancel
        </button>
        <span className="ml-auto text-[11px] text-faint">⌘↵</span>
      </div>
    </div>
  );
}

function SplitDialog({ count, hasOutline, onClose, onSplit }: { count: number; hasOutline: boolean; onClose(): void; onSplit(mode: "every" | "ranges" | "chapters", every: number, ranges: string): void }) {
  const [mode, setMode] = useState<"every" | "ranges" | "chapters">("every");
  const [every, setEvery] = useState(1);
  const [ranges, setRanges] = useState("");
  const n = mode === "every" ? Math.ceil(count / Math.max(1, every)) : null;
  return (
    <Modal title="Split the document" onClose={onClose}>
      <form
        className="space-y-3 text-[13px]"
        onSubmit={(e) => {
          e.preventDefault();
          onSplit(mode, every, ranges);
        }}
      >
        <label className="flex items-center gap-2">
          <input type="radio" name="mode" checked={mode === "every"} onChange={() => setMode("every")} className="accent-[var(--accent)]" />
          <span>Every</span>
          <input type="number" min={1} max={count} value={every} onChange={(e) => setEvery(Math.max(1, Number(e.target.value) || 1))} className="input h-8 w-20 px-2 py-0" disabled={mode !== "every"} />
          <span className="text-muted">page{every > 1 ? "s" : ""} → {n} file{n === 1 ? "" : "s"}</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="mode" checked={mode === "ranges"} onChange={() => setMode("ranges")} className="mt-1 accent-[var(--accent)]" />
          <span className="flex-1">
            <span>By ranges, one file per line</span>
            <textarea value={ranges} onChange={(e) => setRanges(e.target.value)} rows={3} placeholder={"1-3\n4-6, 9\n7-"} className="input mt-1 font-mono text-[12.5px]" disabled={mode !== "ranges"} />
          </span>
        </label>
        <label className={cn("flex items-center gap-2", !hasOutline && "opacity-50")}>
          <input type="radio" name="mode" checked={mode === "chapters"} onChange={() => setMode("chapters")} disabled={!hasOutline} className="accent-[var(--accent)]" />
          <span>By the outline&apos;s top-level chapters</span>
        </label>
        <p className="text-[12px] text-faint">Several files download as one zip; the originals keep their comments and form values.</p>
        <div className="flex gap-2 pt-1">
          <button type="submit" className={PRIMARY} data-split-go>
            Split
          </button>
          <button type="button" onClick={onClose} className={BTN}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CropDialog({ pages, onClose, onCrop, onUncrop }: { pages: number[]; onClose(): void; onCrop(inset: { top: number; right: number; bottom: number; left: number }): void; onUncrop(): void }) {
  const [mm, setMm] = useState({ top: 10, right: 10, bottom: 10, left: 10 });
  const pt = (v: number) => (v / 25.4) * 72;
  return (
    <Modal title={`Crop ${pages.length === 1 ? `page ${pages[0] + 1}` : `${pages.length} pages`}`} onClose={onClose}>
      <form
        className="space-y-3 text-[13px]"
        onSubmit={(e) => {
          e.preventDefault();
          onCrop({ top: pt(mm.top), right: pt(mm.right), bottom: pt(mm.bottom), left: pt(mm.left) });
        }}
      >
        <p className="text-muted">Trim this much from each edge, in millimetres. Nothing is deleted: the crop box is what viewers show, and it can be removed again.</p>
        <div className="grid grid-cols-2 gap-2">
          {(["top", "right", "bottom", "left"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2">
              <span className="w-14 capitalize text-muted">{k}</span>
              <input type="number" min={0} max={200} step={0.5} value={mm[k]} onChange={(e) => setMm((m) => ({ ...m, [k]: Number(e.target.value) || 0 }))} className="input h-8 px-2 py-0" data-crop={k} />
            </label>
          ))}
        </div>
        <div className="flex gap-2 pt-1">
          <button type="submit" className={PRIMARY} data-crop-go>
            Crop
          </button>
          <button type="button" onClick={onUncrop} className={BTN}>
            Remove crop
          </button>
          <button type="button" onClick={onClose} className={cn(BTN, "ml-auto")}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ProtectDialog({ onClose, onProtect }: { onClose(): void; onProtect(user: string, owner: string): void }) {
  const [user, setUser] = useState("");
  const [owner, setOwner] = useState("");
  return (
    <Modal title="Protect with a password" onClose={onClose}>
      <form
        className="space-y-3 text-[13px]"
        onSubmit={(e) => {
          e.preventDefault();
          if (user) onProtect(user, owner || user);
        }}
      >
        <p className="text-muted">The document is encrypted with AES-256. Anyone opening it will need the password; PDF Studio keeps it while you work and the file stays protected when you save.</p>
        <label className="block">
          <span className="text-muted">Password to open</span>
          <input type="password" value={user} onChange={(e) => setUser(e.target.value)} className="input mt-1 h-9" autoFocus data-protect-user />
        </label>
        <label className="block">
          <span className="text-muted">Owner password (optional, for changing permissions later)</span>
          <input type="password" value={owner} onChange={(e) => setOwner(e.target.value)} className="input mt-1 h-9" data-protect-owner />
        </label>
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={!user} className={PRIMARY} data-protect-go>
            Protect
          </button>
          <button type="button" onClick={onClose} className={BTN}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PasswordDialog({ title, wrong, onClose, onSubmit }: { title: string; wrong: boolean; onClose(): void; onSubmit(pw: string): void }) {
  const [pw, setPw] = useState("");
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="space-y-3 text-[13px]"
        onSubmit={(e) => {
          e.preventDefault();
          if (pw) onSubmit(pw);
        }}
      >
        {wrong && <p className="text-danger">Wrong password — try again.</p>}
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" className="input h-9" autoFocus />
        <div className="flex gap-2">
          <button type="submit" disabled={!pw} className={PRIMARY}>
            Unlock
          </button>
          <button type="button" onClick={onClose} className={BTN}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EmptyState({
  phase,
  error,
  dragOver,
  pending,
  password,
  onPassword,
  onUnlock,
  onPick,
  onSample,
  restorable,
  onRestore,
  onForgetRestore,
  recent,
  onRecent,
  onReset,
}: {
  phase: Phase;
  error: string | null;
  dragOver: boolean;
  pending: { name: string; wrong: boolean } | null;
  password: string;
  onPassword(v: string): void;
  onUnlock(): void;
  onPick(): void;
  onSample(): void;
  restorable: Autosave | null;
  onRestore(): void;
  onForgetRestore(): void;
  recent: RecentEntry[];
  onRecent(r: RecentEntry): void;
  onReset(): void;
}) {
  if (phase === "loading")
    return (
      <div className="panel flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8">
        <Loader size={22} className="animate-spin text-accent" />
        <p className="readout">Opening…</p>
      </div>
    );
  if (phase === "password" && pending)
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onUnlock();
        }}
        className="panel flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full border border-edge text-accent">
          <Lock size={18} />
        </span>
        <p className="font-display text-base font-semibold text-ink">“{pending.name}” is password-protected</p>
        {pending.wrong && <p className="font-mono text-xs text-danger">Wrong password — try again.</p>}
        <div className="flex w-full max-w-sm gap-2">
          <input type="password" value={password} onChange={(e) => onPassword(e.target.value)} placeholder="Password" className="input h-10 flex-1" autoFocus data-password-input />
          <button type="submit" disabled={!password} className="inline-flex h-10 items-center rounded-[var(--radius)] bg-accent px-4 font-mono text-sm font-semibold text-on-accent disabled:opacity-40" data-password-unlock>
            Unlock
          </button>
        </div>
        <p className="max-w-sm text-center text-[12px] text-faint">The password is used only by the PDF engine in this tab; it is not sent anywhere.</p>
        <button type="button" onClick={onReset} className="font-mono text-xs text-faint hover:text-ink">
          Choose a different file
        </button>
      </form>
    );
  if (phase === "error")
    return (
      <div className="panel flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="font-display text-base font-semibold text-danger">Could not open this PDF</p>
        <p className="max-w-md font-mono text-xs text-muted">{error}</p>
        <button type="button" onClick={onReset} className="mt-2 inline-flex h-9 items-center gap-2 rounded-[var(--radius)] border border-edge px-3 font-mono text-xs text-ink hover:border-accent hover:text-accent">
          <Upload size={13} /> Try another file
        </button>
      </div>
    );
  return (
    <div className={cn("panel flex min-h-0 flex-1 flex-col items-center justify-center gap-3 border-dashed p-8 text-center", dragOver && "border-accent")} data-pdf-empty>
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-edge text-accent">
        <FileText size={20} />
      </span>
      <p className="font-display text-base font-semibold text-ink">Drop a PDF here</p>
      <p className="max-w-sm font-mono text-xs text-faint">or open one, paste it, or try the sample. Read, search, fill forms, highlight, comment, organise pages — nothing is uploaded.</p>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={onPick} className="inline-flex h-9 items-center gap-2 rounded-[var(--radius)] bg-accent px-4 text-sm font-medium text-on-accent hover:brightness-110" data-open-file>
          <FolderOpen size={14} /> Open a PDF
        </button>
        <button type="button" onClick={onSample} className="inline-flex h-9 items-center gap-2 rounded-[var(--radius)] border border-edge px-3 text-sm text-ink hover:border-accent hover:text-accent" data-open-sample>
          Try the sample
        </button>
      </div>
      {restorable && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-[12.5px] text-muted" data-restore>
          <span>
            Last time: <span className="text-ink">{restorable.name}</span> ({formatBytes(restorable.bytes.byteLength)}){restorable.dirty ? ", with unsaved changes" : ""}
          </span>
          <button type="button" onClick={onRestore} className={BTN} data-restore-open>
            Open it again
          </button>
          <button type="button" onClick={onForgetRestore} className="text-faint hover:text-ink">
            Forget
          </button>
        </div>
      )}
      {recent.some((r) => r.handle) && (
        <div className="mt-2 w-full max-w-sm text-left" data-recent>
          <p className="readout mb-1">Recent</p>
          <ul className="divide-y divide-edge border-y border-edge">
            {recent
              .filter((r) => r.handle)
              .slice(0, 5)
              .map((r) => (
                <li key={`${r.name}-${r.openedAt}`}>
                  <button type="button" onClick={() => onRecent(r)} className="flex w-full items-center gap-2 px-1 py-1.5 text-[12.5px] text-ink hover:bg-raised">
                    <FileText size={12} className="shrink-0 text-faint" />
                    <span className="truncate">{r.name}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-faint">{formatBytes(r.size)}</span>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
      {error && <p className="font-mono text-xs text-danger">{error}</p>}
    </div>
  );
}
