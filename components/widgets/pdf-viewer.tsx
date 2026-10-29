"use client";

/**
 * pdf.js's viewer component inside Bench: pages, text layer, links, forms, the annotation editors (highlight, text,
 * ink, stamp) and their comments, search. Imperative underneath — an instance lives in a ref and the props drive it
 * — with an API for the widget: go to a page, find, save the edits into bytes, read the selection as quads.
 */
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { EventBus, PDFFindController, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import { PDF_ICONS, PdfPasswordError, ensureViewerStyles, loadPdfJs, openPdf, type PdfJs } from "@/lib/tools/files/pdf/pdfjs";
import type { BenchCommentManager } from "./pdf-comment-manager";
import { cn } from "@/lib/utils";

export type ViewMode = "continuous" | "single" | "two-up" | "wrapped";
export type Tool = "select" | "highlight" | "note" | "text" | "draw" | "image" | "edittext" | "crop" | "redact";

/** A pdf.js page view, as far as overlays need it. */
export interface PageViewInfo {
  index: number;
  div: HTMLElement;
  viewport: PageViewport;
  rendered: boolean;
}

export interface PageViewport {
  width: number;
  height: number;
  scale: number;
  rotation: number;
  convertToViewportPoint(x: number, y: number): number[];
  convertToPdfPoint(x: number, y: number): number[];
}
/** "auto", "fit" (whole page), "width", or a percentage as a string. */
export type Zoom = string;

export interface EditorParams {
  highlightColor: string;
  highlightThickness: number;
  inkColor: string;
  inkThickness: number;
  inkOpacity: number;
  textColor: string;
  textSize: number;
}

export interface EditorState {
  isEditing: boolean;
  isEmpty: boolean;
  hasSomethingToUndo: boolean;
  hasSomethingToRedo: boolean;
  hasSelectedEditor: boolean;
}

export type FindStatus = "idle" | "pending" | "found" | "notfound" | "wrapped";
export interface FindResult {
  status: FindStatus;
  current: number;
  total: number;
}

export interface SelectionQuads {
  page: number;
  quads: number[];
  text: string;
}

export interface PdfViewerApi {
  goTo(page: number): void;
  goToDestination(dest: string | unknown[]): void;
  /** Scroll a page so a rectangle (PDF user space) is in view, and flash the annotation with that id. */
  reveal(page: number, rect: [number, number, number, number] | null, annotationId?: string): void;
  selectEditor(pageIndex: number, uid: string): void;
  find(query: string, opts?: { caseSensitive?: boolean; entireWord?: boolean }): void;
  findAgain(previous: boolean): void;
  closeFind(): void;
  zoomIn(): void;
  zoomOut(): void;
  /** The editors' and form fields' changes written into the document; null when there are none. */
  save(): Promise<Uint8Array | null>;
  hasEdits(): boolean;
  undo(): void;
  redo(): void;
  deleteSelected(): void;
  selectionQuads(): SelectionQuads | null;
  clearSelection(): void;
  document(): PDFDocumentProxy | null;
  container(): HTMLDivElement | null;
  /** pdf.js's editor manager, for checks. */
  uiManager(): unknown;
  /** The visible area's page and offset, to put back after a reload. */
  location(): Location | null;
  /** A page's view (its element and viewport), once the document's pages exist. */
  pageView(index: number): PageViewInfo | null;
  pages(): PageViewInfo[];
  /** Listen on the viewer's event bus; returns the unsubscribe. */
  on(event: string, handler: (e: never) => void): () => void;
  /** Place an image file as a stamp editor on the current page (movable and resizable). */
  pasteImage(file: File): Promise<boolean>;
  /** The element overlays render into (inside the scrolling container, over the pages). */
  overlayRoot(): HTMLDivElement | null;
}

export interface Location {
  pageNumber: number;
  scale: string | number;
  left: number;
  top: number;
}

interface Props {
  ref: Ref<PdfViewerApi>;
  bytes: Uint8Array | null;
  /** Bumped whenever the bytes change; the viewer reloads and keeps its place when `docKey` is unchanged. */
  version: number;
  docKey: string;
  password?: string;
  page: number;
  zoom: Zoom;
  view: ViewMode;
  rotation: number;
  tool: Tool;
  params: EditorParams;
  commentManager: BenchCommentManager;
  onDocument(doc: PDFDocumentProxy | null): void;
  onPage(page: number, count: number): void;
  onZoom(zoom: Zoom): void;
  onToolChange(tool: Tool): void;
  onEditorState(state: EditorState): void;
  onFind(result: FindResult): void;
  onDirty(dirty: boolean): void;
  onPassword(wrong: boolean): void;
  onError(message: string): void;
  onNoteClick(hit: { page: number; x: number; y: number }): void;
  onAnnotationClick(id: string, page: number): void;
  /** The overlay root element, once mounted. */
  onOverlayRoot?(el: HTMLDivElement | null): void;
  className?: string;
}

interface Inst {
  lib: PdfJs;
  eventBus: EventBus;
  linkService: PDFLinkService;
  findController: PDFFindController;
  viewer: PDFViewer;
  uiManager: UiManager | null;
  doc: PDFDocumentProxy | null;
  docKey: string | null;
  /** Set once pagesinit ran for the current document. */
  initialized: boolean;
  location: Location | null;
  loading: number;
}

/** The parts of pdf.js's AnnotationEditorUIManager this host calls. */
interface EditorLayer {
  getEditorByUID(uid: string): { div?: HTMLElement | null } | null;
  pasteEditor(options: { mode: number }, params: { bitmapFile: File }): Promise<void>;
}

interface UiManager {
  updateParams(type: number, value: unknown): void;
  undo(): void;
  redo(): void;
  delete(): void;
  setSelected(editor: unknown): void;
  getLayer(pageIndex: number): EditorLayer | undefined;
  readonly currentLayer: EditorLayer | undefined;
  readonly currentPageIndex: number;
  unselectAll(): void;
}

const ZOOM_PRESETS: Record<string, string> = { auto: "auto", fit: "page-fit", width: "page-width", actual: "page-actual" };
const NOT_EDITORS = new Set<Tool>(["note", "edittext", "crop", "redact"]);

export function toScaleValue(zoom: Zoom): string {
  if (ZOOM_PRESETS[zoom]) return ZOOM_PRESETS[zoom];
  const n = Number(zoom);
  return Number.isFinite(n) && n > 0 ? String(n / 100) : "auto";
}

export function zoomFromScale(presetValue: string | null | undefined, scale: number): Zoom {
  if (presetValue) {
    for (const [k, v] of Object.entries(ZOOM_PRESETS)) if (v === presetValue) return k;
  }
  return String(Math.round(scale * 100));
}

export const ZOOM_STEPS = [25, 33, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 600, 800];

/** A tiny localisation for the editors' own buttons (pdf.js otherwise fetches Fluent files Bench does not ship). */
const L10N: Record<string, Record<string, string>> = {
  "pdfjs-editor-remove-button": { title: "Remove", "aria-label": "Remove" },
  "pdfjs-editor-remove-highlight-button": { title: "Remove the highlight", "aria-label": "Remove the highlight" },
  "pdfjs-editor-remove-ink-button": { title: "Remove the drawing", "aria-label": "Remove the drawing" },
  "pdfjs-editor-remove-freetext-button": { title: "Remove the text", "aria-label": "Remove the text" },
  "pdfjs-editor-remove-stamp-button": { title: "Remove the image", "aria-label": "Remove the image" },
  "pdfjs-editor-remove-signature-button": { title: "Remove the signature", "aria-label": "Remove the signature" },
  "pdfjs-editor-highlight-editor": { "aria-label": "Highlight" },
  "pdfjs-editor-ink-editor": { "aria-label": "Drawing" },
  "pdfjs-editor-free-text-editor": { "aria-label": "Text" },
  "pdfjs-editor-stamp-editor": { "aria-label": "Image" },
  "pdfjs-editor-add-comment-button": { title: "Add a comment", "aria-label": "Add a comment" },
  "pdfjs-show-comment-button": { title: "Show the comment", "aria-label": "Show the comment" },
  "pdfjs-editor-colorpicker-button": { title: "Change colour", "aria-label": "Change colour" },
  "pdfjs-editor-colorpicker-dropdown": { "aria-label": "Colour choices" },
  "pdfjs-editor-alt-text-button": { title: "Alt text", "aria-label": "Alt text" },
  "pdfjs-editor-alt-text-button-label": { title: "Alt text" },
  "pdfjs-editor-alt-text-edit-button": { title: "Edit alt text", "aria-label": "Edit alt text" },
  "pdfjs-editor-alt-text-decorative-tooltip": { title: "Marked as decorative" },
  "pdfjs-free-text2": { "default-content": "Start typing…", "aria-label": "Text" },
  "pdfjs-text-annotation-type": { alt: "Note" },
  "pdfjs-editor-highlight-button-label": { title: "Highlight", "aria-label": "Highlight" },
  "pdfjs-highlight-floating-button1": { title: "Highlight", "aria-label": "Highlight" },
  "pdfjs-highlight-floating-button-label": { title: "Highlight" },
  "pdfjs-editor-colorpicker-yellow": { title: "Yellow", "aria-label": "Yellow" },
  "pdfjs-editor-colorpicker-green": { title: "Green", "aria-label": "Green" },
  "pdfjs-editor-colorpicker-blue": { title: "Blue", "aria-label": "Blue" },
  "pdfjs-editor-colorpicker-pink": { title: "Pink", "aria-label": "Pink" },
  "pdfjs-editor-colorpicker-red": { title: "Red", "aria-label": "Red" },
};

function translate(element: Element) {
  const nodes = element.matches("[data-l10n-id]") ? [element, ...element.querySelectorAll("[data-l10n-id]")] : [...element.querySelectorAll("[data-l10n-id]")];
  for (const el of nodes) {
    const id = el.getAttribute("data-l10n-id");
    if (!id) continue;
    if (id === "pdfjs-page-landmark") {
      try {
        const args = JSON.parse(el.getAttribute("data-l10n-args") ?? "{}") as { page?: number };
        el.setAttribute("aria-label", `Page ${args.page ?? ""}`.trim());
      } catch {
        /* no args */
      }
      continue;
    }
    const attrs = L10N[id];
    if (!attrs) continue;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  }
}

class StubL10n {
  getLanguage() {
    return "en-US";
  }
  getDirection() {
    return "ltr";
  }
  async get(ids: string | { id: string }[], _args?: unknown, fallback?: string) {
    const id = typeof ids === "string" ? ids : ids[0]?.id;
    return fallback ?? L10N[id ?? ""]?.title ?? id ?? "";
  }
  async translate(element: Element) {
    translate(element);
  }
  async translateOnce(element: Element) {
    translate(element);
  }
  async destroy() {}
  pause() {}
  resume() {}
}

export function PdfViewerHost(props: Props) {
  const { ref, bytes, version, docKey, password, className } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const inst = useRef<Inst | null>(null);
  const latest = useRef(props);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    latest.current = props;
  });

  /* ---------------------------------------------------------------- setup */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let built: Inst | null = null;
    (async () => {
      try {
        await ensureViewerStyles();
        const lib = await loadPdfJs();
        if (cancelled) return;
        const { viewer: V } = lib;
        const eventBus = new V.EventBus();
        const linkService = new V.PDFLinkService({ eventBus, externalLinkTarget: V.LinkTarget.BLANK, externalLinkRel: "noopener noreferrer" });
        const findController = new V.PDFFindController({ eventBus, linkService, updateMatchesCountOnProgress: true });
        const viewer = new V.PDFViewer({
          container,
          eventBus,
          linkService,
          findController,
          annotationEditorMode: lib.api.AnnotationEditorType.NONE,
          annotationEditorHighlightColors: "yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFCBE6,red=#FF4F5F",
          enableHighlightFloatingButton: true,
          commentManager: latest.current.commentManager,
          imageResourcesPath: PDF_ICONS,
          l10n: new StubL10n() as never,
          textLayerMode: 1,
          annotationMode: lib.api.AnnotationMode.ENABLE_FORMS,
          maxCanvasPixels: 2 ** 25,
          enablePermissions: false,
          supportsPinchToZoom: true,
        } as never);
        linkService.setViewer(viewer);
        built = { lib, eventBus, linkService, findController, viewer, uiManager: null, doc: null, docKey: null, initialized: false, location: null, loading: 0 };
        inst.current = built;

        eventBus.on("pagesinit", () => {
          const i = inst.current;
          if (!i || !i.doc) return;
          const p = latest.current;
          const restore = i.initialized === false && i.location && i.docKey === p.docKey ? i.location : null;
          viewer.currentScaleValue = restore ? String(restore.scale) : toScaleValue(p.zoom);
          applyView(i, p.view);
          viewer.pagesRotation = p.rotation;
          if (restore) viewer.scrollPageIntoView({ pageNumber: Math.min(restore.pageNumber, i.doc.numPages), destArray: [null, { name: "XYZ" }, restore.left, restore.top, null], allowNegativeOffset: true });
          else if (p.page > 1) viewer.currentPageNumber = Math.min(p.page, i.doc.numPages);
          i.initialized = true;
          i.docKey = p.docKey;
          applyTool(i, p.tool);
          applyParams(i, p.params);
          p.onPage(viewer.currentPageNumber, i.doc.numPages);
        });
        eventBus.on("pagechanging", (e: { pageNumber: number }) => {
          const i = inst.current;
          if (i?.doc) latest.current.onPage(e.pageNumber, i.doc.numPages);
        });
        eventBus.on("scalechanging", (e: { scale: number; presetValue?: string }) => {
          if (inst.current?.initialized) latest.current.onZoom(zoomFromScale(e.presetValue, e.scale));
        });
        eventBus.on("updateviewarea", (e: { location: Location | null }) => {
          const i = inst.current;
          if (i && e.location) i.location = { pageNumber: e.location.pageNumber, scale: e.location.scale, left: e.location.left, top: e.location.top };
        });
        eventBus.on("annotationeditoruimanager", (e: { uiManager: UiManager }) => {
          const i = inst.current;
          if (i) i.uiManager = e.uiManager;
        });
        eventBus.on("annotationeditorstateschanged", (e: { isEditing: boolean; isEmpty: boolean; hasSomethingToUndo: boolean; hasSomethingToRedo: boolean; hasSelectedEditor: boolean }) => {
          latest.current.onEditorState({ isEditing: e.isEditing, isEmpty: e.isEmpty, hasSomethingToUndo: e.hasSomethingToUndo, hasSomethingToRedo: e.hasSomethingToRedo, hasSelectedEditor: e.hasSelectedEditor });
        });
        eventBus.on("annotationeditormodechanged", (e: { mode: number }) => {
          const i = inst.current;
          if (!i) return;
          const T = i.lib.api.AnnotationEditorType;
          const p = latest.current;
          // Tools that are not pdf.js editors (note, text editing, crop, redaction) survive a "no editor" report.
          const tool: Tool | null = e.mode === T.HIGHLIGHT ? "highlight" : e.mode === T.FREETEXT ? "text" : e.mode === T.INK ? "draw" : e.mode === T.STAMP ? "image" : e.mode === T.NONE ? (NOT_EDITORS.has(p.tool) ? p.tool : "select") : null;
          if (tool && tool !== p.tool) p.onToolChange(tool);
        });
        eventBus.on("updatefindcontrolstate", (e: { state: number; matchesCount?: { current: number; total: number } }) => {
          const F = lib.viewer.FindState;
          const status: FindStatus = e.state === F.FOUND ? "found" : e.state === F.NOT_FOUND ? "notfound" : e.state === F.WRAPPED ? "wrapped" : "pending";
          latest.current.onFind({ status, current: e.matchesCount?.current ?? 0, total: e.matchesCount?.total ?? 0 });
        });
        eventBus.on("updatefindmatchescount", (e: { matchesCount: { current: number; total: number } }) => {
          latest.current.onFind({ status: e.matchesCount.total ? "found" : "pending", current: e.matchesCount.current, total: e.matchesCount.total });
        });
        setReady(true);
      } catch (e) {
        if (!cancelled) setFailed(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      const i = built;
      if (i) {
        try {
          i.viewer.setDocument(null);
          i.linkService.setDocument(null);
          const doc = i.doc;
          i.doc = null;
          void doc?.loadingTask.destroy();
        } catch {
          /* already gone */
        }
      }
      inst.current = null;
    };
  }, []);

  /* ------------------------------------------------------------- document */
  useEffect(() => {
    const i = inst.current;
    if (!ready || !i) return;
    const p = latest.current;
    if (!bytes) {
      const old = i.doc;
      i.doc = null;
      i.initialized = false;
      i.docKey = null;
      i.viewer.setDocument(null);
      i.linkService.setDocument(null);
      p.onDocument(null);
      void old?.loadingTask.destroy();
      return;
    }
    const seq = ++i.loading;
    let cancelled = false;
    (async () => {
      try {
        const doc = await openPdf(bytes, password);
        const cur = inst.current;
        if (cancelled || !cur || cur.loading !== seq) {
          void doc.loadingTask.destroy();
          return;
        }
        const old = cur.doc;
        if (cur.docKey !== docKey) cur.location = null;
        cur.initialized = false;
        cur.doc = doc;
        cur.uiManager = null;
        const storage = doc.annotationStorage as unknown as { onSetModified: (() => void) | null; onResetModified: (() => void) | null };
        storage.onSetModified = () => latest.current.onDirty(true);
        storage.onResetModified = () => latest.current.onDirty(false);
        cur.viewer.setDocument(doc);
        cur.linkService.setDocument(doc, null);
        cur.findController.setDocument(doc);
        latest.current.onDocument(doc);
        latest.current.onDirty(false);
        void old?.loadingTask.destroy();
      } catch (e) {
        if (cancelled) return;
        if (e instanceof PdfPasswordError) latest.current.onPassword(e.wrong);
        else latest.current.onError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, bytes, version, docKey, password]);

  /* ---------------------------------------------------------- live props */
  const { zoom, view, rotation, tool, params } = props;
  useEffect(() => {
    const i = inst.current;
    if (!i?.initialized) return;
    const want = toScaleValue(zoom);
    if (i.viewer.currentScaleValue !== want) i.viewer.currentScaleValue = want;
  }, [zoom, version]);
  useEffect(() => {
    const i = inst.current;
    if (i?.initialized) applyView(i, view);
  }, [view, version]);
  useEffect(() => {
    const i = inst.current;
    if (i?.initialized && i.viewer.pagesRotation !== rotation) i.viewer.pagesRotation = rotation;
  }, [rotation, version]);
  useEffect(() => {
    const i = inst.current;
    if (i?.initialized) applyTool(i, tool);
  }, [tool, version]);
  useEffect(() => {
    const i = inst.current;
    if (i?.initialized) applyParams(i, params);
  }, [params, version]);

  /* ------------------------------------------------------------------ api */
  useImperativeHandle(
    ref,
    (): PdfViewerApi => ({
      goTo: (page) => {
        const i = inst.current;
        if (i?.doc) i.viewer.currentPageNumber = Math.max(1, Math.min(page, i.doc.numPages));
      },
      goToDestination: (dest) => {
        void inst.current?.linkService.goToDestination(dest as string | unknown[]);
      },
      reveal: (page, rect, annotationId) => {
        const i = inst.current;
        if (!i?.doc) return;
        const pageNumber = Math.max(1, Math.min(page + 1, i.doc.numPages));
        if (rect) i.viewer.scrollPageIntoView({ pageNumber, destArray: [null, { name: "XYZ" }, Math.max(0, rect[0] - 48), rect[3] + 48, null], allowNegativeOffset: true });
        else i.viewer.currentPageNumber = pageNumber;
        if (annotationId) {
          const flash = () => {
            const el = containerRef.current?.querySelector<HTMLElement>(`[data-annotation-id="${CSS.escape(annotationId)}"]`);
            if (!el) return false;
            el.classList.add("bench-flash");
            setTimeout(() => el.classList.remove("bench-flash"), 1600);
            return true;
          };
          if (!flash()) setTimeout(flash, 350);
        }
      },
      selectEditor: (pageIndex, uid) => {
        const i = inst.current;
        const editor = i?.uiManager?.getLayer(pageIndex)?.getEditorByUID(uid);
        if (!editor || !i) return;
        if (i.doc) i.viewer.currentPageNumber = pageIndex + 1;
        i.uiManager?.setSelected(editor);
        editor.div?.scrollIntoView({ block: "center", inline: "nearest" });
      },
      find: (query, opts = {}) => {
        inst.current?.eventBus.dispatch("find", { source: null, type: "", query, caseSensitive: !!opts.caseSensitive, entireWord: !!opts.entireWord, highlightAll: true, findPrevious: false, matchDiacritics: false });
      },
      findAgain: (previous) => {
        const i = inst.current;
        if (!i) return;
        const state = (i.findController as unknown as { state: { query: string; caseSensitive: boolean; entireWord: boolean } | null }).state;
        if (!state) return;
        i.eventBus.dispatch("find", { source: null, type: "again", query: state.query, caseSensitive: state.caseSensitive, entireWord: state.entireWord, highlightAll: true, findPrevious: previous, matchDiacritics: false });
      },
      closeFind: () => {
        inst.current?.eventBus.dispatch("findbarclose", { source: null });
      },
      zoomIn: () => inst.current?.viewer.increaseScale({ steps: 1 }),
      zoomOut: () => inst.current?.viewer.decreaseScale({ steps: 1 }),
      save: async () => {
        const i = inst.current;
        if (!i?.doc) return null;
        if (i.doc.annotationStorage.size === 0) return null;
        return i.doc.saveDocument();
      },
      hasEdits: () => (inst.current?.doc?.annotationStorage.size ?? 0) > 0,
      undo: () => inst.current?.uiManager?.undo(),
      redo: () => inst.current?.uiManager?.redo(),
      deleteSelected: () => inst.current?.uiManager?.delete(),
      selectionQuads: () => selectionQuads(inst.current, containerRef.current),
      clearSelection: () => {
        inst.current?.viewer.clearSelection();
        inst.current?.uiManager?.unselectAll();
      },
      document: () => inst.current?.doc ?? null,
      container: () => containerRef.current,
      uiManager: () => inst.current?.uiManager ?? null,
      location: () => inst.current?.location ?? null,
      pageView: (index) => pageInfo(inst.current, index),
      pages: () => {
        const i = inst.current;
        if (!i?.doc || !i.initialized) return [];
        const out: PageViewInfo[] = [];
        for (let k = 0; k < i.doc.numPages; k++) {
          const v = pageInfo(i, k);
          if (v) out.push(v);
        }
        return out;
      },
      on: (event, handler) => {
        const i = inst.current;
        if (!i) return () => {};
        const h = handler as (e: unknown) => void;
        i.eventBus.on(event, h as never);
        return () => i.eventBus.off(event, h as never);
      },
      pasteImage: async (file) => {
        const i = inst.current;
        const ui = i?.uiManager;
        if (!i || !ui) return false;
        const layer = ui.currentLayer ?? ui.getLayer(ui.currentPageIndex) ?? ui.getLayer(i.viewer.currentPageNumber - 1);
        if (!layer) return false;
        await layer.pasteEditor({ mode: i.lib.api.AnnotationEditorType.STAMP }, { bitmapFile: file });
        return true;
      },
      overlayRoot: () => overlayRef.current,
    }),
    [],
  );

  /* --------------------------------------------------------------- clicks */
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const i = inst.current;
    const target = e.target as HTMLElement;
    if (!i?.doc) return;
    const p = latest.current;
    const section = target.closest<HTMLElement>(".annotationLayer [data-annotation-id]");
    if (section && p.tool !== "note") {
      const pageEl = section.closest<HTMLElement>(".page");
      const n = Number(pageEl?.dataset.pageNumber ?? 0);
      const id = section.dataset.annotationId;
      if (id && n) p.onAnnotationClick(id, n - 1);
      return;
    }
    if (p.tool !== "note") return;
    if (target.closest(".annotationEditorLayer .selectedEditor, .editToolbar, .annotationCommentButton")) return;
    const pageEl = target.closest<HTMLElement>(".page");
    if (!pageEl) return;
    const n = Number(pageEl.dataset.pageNumber ?? 0);
    if (!n) return;
    const view = i.viewer.getPageView(n - 1) as { viewport: { convertToPdfPoint(x: number, y: number): number[] }; div: HTMLElement } | undefined;
    if (!view) return;
    const r = view.div.getBoundingClientRect();
    const [x, y] = view.viewport.convertToPdfPoint(e.clientX - r.left, e.clientY - r.top);
    p.onNoteClick({ page: n - 1, x, y });
  };

  return (
    <div className={cn("relative h-full w-full", className)} data-pdf-viewer data-tool={tool}>
      <div ref={containerRef} className="absolute inset-0 overflow-auto" onClick={onClick} data-pdf-container tabIndex={-1}>
        <div className="pdfViewer" />
        {/* Overlays (text editing, crop, redaction) are portalled in here, positioned over the pages. */}
        <div
          ref={(el) => {
            overlayRef.current = el;
            props.onOverlayRoot?.(el);
          }}
          className="pointer-events-none absolute left-0 top-0 z-10 h-0 w-0 overflow-visible"
          data-pdf-overlays
        />
      </div>
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[13px] text-danger">
          The PDF engine could not be loaded: {failed}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ helpers */

function pageInfo(i: Inst | null, index: number): PageViewInfo | null {
  if (!i?.doc || !i.initialized) return null;
  const view = i.viewer.getPageView(index) as { div: HTMLElement; viewport: PageViewport; renderingState: number } | undefined;
  if (!view?.div || !view.viewport) return null;
  return { index, div: view.div, viewport: view.viewport, rendered: view.renderingState === 3 };
}

function applyView(i: Inst, view: ViewMode) {
  const { ScrollMode, SpreadMode } = i.lib.viewer;
  const scroll = view === "single" ? ScrollMode.PAGE : view === "wrapped" ? ScrollMode.WRAPPED : ScrollMode.VERTICAL;
  const spread = view === "two-up" ? SpreadMode.ODD : SpreadMode.NONE;
  if (i.viewer.scrollMode !== scroll) i.viewer.scrollMode = scroll;
  if (i.viewer.spreadMode !== spread) i.viewer.spreadMode = spread;
}

function applyTool(i: Inst, tool: Tool) {
  const T = i.lib.api.AnnotationEditorType;
  const mode = tool === "highlight" ? T.HIGHLIGHT : tool === "text" ? T.FREETEXT : tool === "draw" ? T.INK : tool === "image" ? T.STAMP : T.NONE;
  const current = (i.viewer.annotationEditorMode as { mode: number } | number) ?? T.NONE;
  const cur = typeof current === "number" ? current : current.mode;
  if (cur !== mode) i.viewer.annotationEditorMode = { mode };
}

function applyParams(i: Inst, p: EditorParams) {
  const ui = i.uiManager;
  if (!ui) return;
  const T = i.lib.api.AnnotationEditorParamsType;
  ui.updateParams(T.HIGHLIGHT_COLOR, p.highlightColor);
  ui.updateParams(T.HIGHLIGHT_THICKNESS, p.highlightThickness);
  ui.updateParams(T.INK_COLOR, p.inkColor);
  ui.updateParams(T.INK_THICKNESS, p.inkThickness);
  ui.updateParams(T.INK_OPACITY, p.inkOpacity);
  ui.updateParams(T.FREETEXT_COLOR, p.textColor);
  ui.updateParams(T.FREETEXT_SIZE, p.textSize);
}

/** The current text selection as quad points on one page (the page holding most of it). */
function selectionQuads(i: Inst | null, container: HTMLDivElement | null): SelectionQuads | null {
  if (!i?.doc || !container) return null;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const text = sel.toString();
  if (!text.trim()) return null;
  const pages = [...container.querySelectorAll<HTMLElement>(".page")].map((el) => ({ el, n: Number(el.dataset.pageNumber ?? 0), r: el.getBoundingClientRect() }));
  const byPage = new Map<number, DOMRect[]>();
  for (let k = 0; k < sel.rangeCount; k++) {
    for (const rect of sel.getRangeAt(k).getClientRects()) {
      if (rect.width < 1 || rect.height < 1) continue;
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      const page = pages.find((p) => cx >= p.r.left && cx <= p.r.right && cy >= p.r.top && cy <= p.r.bottom);
      if (!page || !page.n) continue;
      const list = byPage.get(page.n) ?? [];
      list.push(rect);
      byPage.set(page.n, list);
    }
  }
  let best: { n: number; rects: DOMRect[] } | null = null;
  for (const [n, rects] of byPage) if (!best || rects.length > best.rects.length) best = { n, rects };
  if (!best) return null;
  const view = i.viewer.getPageView(best.n - 1) as { viewport: { convertToPdfPoint(x: number, y: number): number[] }; div: HTMLElement } | undefined;
  if (!view) return null;
  const pr = view.div.getBoundingClientRect();
  const quads: number[] = [];
  // Merge rects that sit on one line (the text layer gives one per span).
  const lines: { top: number; bottom: number; left: number; right: number }[] = [];
  for (const r of best.rects.sort((a, b) => a.top - b.top || a.left - b.left)) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.top - r.top) < r.height * 0.5) {
      last.left = Math.min(last.left, r.left);
      last.right = Math.max(last.right, r.right);
      last.top = Math.min(last.top, r.top);
      last.bottom = Math.max(last.bottom, r.bottom);
    } else lines.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
  }
  for (const l of lines) {
    const [x1, y1] = view.viewport.convertToPdfPoint(l.left - pr.left, l.top - pr.top);
    const [x2, y2] = view.viewport.convertToPdfPoint(l.right - pr.left, l.bottom - pr.top);
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2), minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    quads.push(minX, maxY, maxX, maxY, minX, minY, maxX, minY);
  }
  return quads.length ? { page: best.n - 1, quads, text } : null;
}
