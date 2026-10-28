/**
 * Page structure with pdf-lib: order, rotation, deletion, duplicates, blank pages, pages from another PDF, extraction
 * and crop. Indices are 0-based here; the UI speaks 1-based through lib/tools/files/pdf/ranges.ts.
 */
import { PDFDocument, PDFName, PDFNumber, PDFRef, degrees } from "@cantoo/pdf-lib";

export interface LoadOptions {
  password?: string;
}

/** Parse bytes without touching the document's own producer and dates. */
export async function loadPdf(bytes: Uint8Array, opts: LoadOptions = {}): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { password: opts.password, updateMetadata: false });
}

const INHERITED = ["Resources", "MediaBox", "CropBox", "Rotate"].map((n) => PDFName.of(n));

/**
 * The current pages in a new order: `order` lists the old index of every page, each exactly once. The page tree is
 * flattened to one level under the root (attributes pages inherited from intermediate nodes are kept on the pages),
 * which every reader accepts and leaves references to the pages — links, outline, annotations — intact.
 */
export function reorderPages(doc: PDFDocument, order: number[]): void {
  const pages = doc.getPages();
  const seen = new Set(order);
  if (order.length !== pages.length || seen.size !== pages.length || order.some((i) => i < 0 || i >= pages.length)) throw new Error("The new order must name every page once");
  if (order.every((v, i) => v === i)) return;
  const rootRef = doc.catalog.get(PDFName.of("Pages"));
  if (!(rootRef instanceof PDFRef)) throw new Error("The page tree is not an indirect object");
  const root = doc.catalog.Pages();
  for (const p of pages) {
    for (const key of INHERITED) {
      if (p.node.has(key)) continue;
      const v = p.node.getInheritableAttribute(key);
      if (v) p.node.set(key, v);
    }
  }
  root.set(PDFName.of("Kids"), doc.context.obj(order.map((i) => pages[i].ref)));
  root.set(PDFName.of("Count"), PDFNumber.of(order.length));
  for (const p of pages) p.node.setParent(rootRef);
  (doc as unknown as { pageCache: { invalidate(): void } }).pageCache.invalidate();
}

export function rotatePages(doc: PDFDocument, pages: number[], delta: 90 | -90 | 180): void {
  for (const i of pages) {
    const page = doc.getPage(i);
    const angle = (((page.getRotation().angle + delta) % 360) + 360) % 360;
    page.setRotation(degrees(angle));
  }
}

export function deletePages(doc: PDFDocument, pages: number[]): void {
  if (pages.length >= doc.getPageCount()) throw new Error("A document needs at least one page");
  for (const i of [...new Set(pages)].sort((a, b) => b - a)) doc.removePage(i);
}

/** Copies each page in place, the copy right after its original. */
export async function duplicatePages(doc: PDFDocument, pages: number[]): Promise<void> {
  const sorted = [...new Set(pages)].sort((a, b) => b - a);
  const copies = await doc.copyPages(doc, sorted);
  sorted.forEach((i, k) => doc.insertPage(i + 1, copies[k]));
}

export interface BlankPageInput {
  /** Insert before this index; the count appends. */
  at: number;
  /** Points; defaults to the size of the page before (or after) the slot, else Letter. */
  width?: number;
  height?: number;
}

export function insertBlankPage(doc: PDFDocument, input: BlankPageInput): void {
  const count = doc.getPageCount();
  const at = Math.max(0, Math.min(input.at, count));
  let width = input.width, height = input.height;
  if (!width || !height) {
    const like = count ? doc.getPage(Math.min(Math.max(at - 1, 0), count - 1)) : null;
    if (like) {
      const size = like.getSize();
      const turned = like.getRotation().angle % 180 !== 0;
      width = turned ? size.height : size.width;
      height = turned ? size.width : size.height;
    } else {
      width = 612;
      height = 792;
    }
  }
  doc.insertPage(at, [width, height]);
}

/** Pages of another document (all, or the given 0-based ones) inserted before `at`. */
export async function insertPdfPages(doc: PDFDocument, at: number, other: PDFDocument, pages?: number[]): Promise<number> {
  const which = pages ?? other.getPageIndices();
  const copies = await doc.copyPages(other, which);
  const slot = Math.max(0, Math.min(at, doc.getPageCount()));
  copies.forEach((p, k) => doc.insertPage(slot + k, p));
  return copies.length;
}

/** A new document holding copies of the given pages, in that order, with the title carried over. */
export async function extractPages(doc: PDFDocument, pages: number[]): Promise<Uint8Array> {
  const out = await PDFDocument.create({ updateMetadata: false });
  const copies = await out.copyPages(doc, pages);
  for (const p of copies) out.addPage(p);
  const title = doc.getTitle();
  if (title) out.setTitle(title);
  const author = doc.getAuthor();
  if (author) out.setAuthor(author);
  out.setProducer(doc.getProducer() ?? "Bench PDF Studio");
  out.setCreator(doc.getCreator() ?? "Bench PDF Studio");
  return out.save();
}

export interface CropInset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Shrinks the crop box (the area viewers show) by an inset in points, never below 24 points a side. */
export function cropPages(doc: PDFDocument, pages: number[], inset: CropInset): void {
  for (const i of pages) {
    const page = doc.getPage(i);
    const box = page.getCropBox();
    const width = Math.max(24, box.width - inset.left - inset.right);
    const height = Math.max(24, box.height - inset.top - inset.bottom);
    page.setCropBox(box.x + inset.left, box.y + inset.bottom, width, height);
  }
}

/** Puts the crop box back to the full media box. */
export function uncropPages(doc: PDFDocument, pages: number[]): void {
  for (const i of pages) {
    const page = doc.getPage(i);
    const m = page.getMediaBox();
    page.setCropBox(m.x, m.y, m.width, m.height);
  }
}

export interface PageSize {
  /** Points, as laid out (rotation applied). */
  width: number;
  height: number;
  rotation: number;
}

export function pageSizes(doc: PDFDocument): PageSize[] {
  return doc.getPages().map((p) => {
    const box = p.getCropBox();
    const rotation = ((p.getRotation().angle % 360) + 360) % 360;
    const turned = rotation % 180 !== 0;
    return { width: turned ? box.height : box.width, height: turned ? box.width : box.height, rotation };
  });
}
