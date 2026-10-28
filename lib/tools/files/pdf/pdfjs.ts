/**
 * The one place pdf.js is loaded from. The library ships as ES modules and loads its worker, CMaps, standard fonts
 * and wasm decoders by URL — all self-hosted under /vendor/pdfjs/ (scripts/copy-vendor.mjs). Browser-only: call these
 * from a widget, never at module scope.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";

export const PDFJS_BASE = "/vendor/pdfjs/";
/** Icons for note annotations that carry no appearance of their own (app/public/pdf-icons/). */
export const PDF_ICONS = "/pdf-icons/";

type Api = typeof import("pdfjs-dist");
type Viewer = typeof import("pdfjs-dist/web/pdf_viewer.mjs");
export interface PdfJs {
  api: Api;
  viewer: Viewer;
}

let loading: Promise<PdfJs> | null = null;

/**
 * The library and its viewer component, loaded once, with the worker pointed at the self-hosted copy. The viewer
 * module reads the library from globalThis.pdfjsLib, which the library sets as it loads, so the two load in turn.
 */
export function loadPdfJs(): Promise<PdfJs> {
  loading ??= (async () => {
    const api = await import("pdfjs-dist");
    api.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}pdf.worker.min.mjs`;
    const viewer = await import("pdfjs-dist/web/pdf_viewer.mjs");
    return { api, viewer };
  })();
  return loading;
}

let styles: Promise<void> | null = null;

/**
 * The viewer's own stylesheet (page layout, text layer, annotation and editor layers), loaded by a link rather than
 * bundled: it names icons the package does not ship, which a bundler refuses to resolve. Bench's overrides live in
 * globals.css under [data-pdf-studio].
 */
export function ensureViewerStyles(): Promise<void> {
  styles ??= new Promise<void>((resolve) => {
    const existing = document.querySelector<HTMLLinkElement>("link[data-pdfjs-css]");
    if (existing) {
      if (existing.dataset.loaded) resolve();
      else existing.addEventListener("load", () => resolve(), { once: true });
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `${PDFJS_BASE}pdf_viewer.css`;
    link.dataset.pdfjsCss = "1";
    link.addEventListener(
      "load",
      () => {
        link.dataset.loaded = "1";
        resolve();
      },
      { once: true },
    );
    link.addEventListener("error", () => resolve(), { once: true });
    document.head.appendChild(link);
  });
  return styles;
}

export class PdfPasswordError extends Error {
  readonly wrong: boolean;
  constructor(wrong: boolean) {
    super(wrong ? "Wrong password" : "This PDF needs a password");
    this.name = "PdfPasswordError";
    this.wrong = wrong;
  }
}

/** Open a document from bytes; the bytes are copied, since pdf.js takes ownership of what it is handed. */
export async function openPdf(bytes: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  const { api } = await loadPdfJs();
  const task = api.getDocument({
    data: bytes.slice(),
    password,
    cMapUrl: `${PDFJS_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_BASE}standard_fonts/`,
    wasmUrl: `${PDFJS_BASE}wasm/`,
    iccUrl: `${PDFJS_BASE}iccs/`,
    enableXfa: true,
  });
  try {
    return await task.promise;
  } catch (e) {
    const err = e as { name?: string; code?: number } | null;
    if (err && err.name === "PasswordException") throw new PdfPasswordError(err.code === api.PasswordResponses.INCORRECT_PASSWORD);
    throw e;
  }
}
