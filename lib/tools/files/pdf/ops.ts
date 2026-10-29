/**
 * Everything that changes a document's bytes, as one operation type run by the worker (components/widgets/
 * pdf-ops.worker.ts) and by Node checks. An operation mutates a loaded pdf-lib document; the caller saves.
 */
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, PDFRef, rgb } from "@cantoo/pdf-lib";
import { addNote, addReply, addTextMarkup, deleteAnnotation, moveNote, removeAnnotations, setContents, setReviewState, stampAuthor, type Rgb, type TextMarkupSubtype } from "./annots";
import { writeInfo, type PdfInfo } from "./meta";
import { cropPages, deletePages, duplicatePages, extractPages, insertBlankPage, insertPdfPages, loadPdf, reorderPages, rotatePages, uncropPages, type CropInset } from "./pages";
import { rewriteTextOps, type TextOpEdit } from "./textops";
import type { FontSource } from "./fonts";
import { addText, attachFile, detachFile, flattenAnnotations, headerFooter, pagesFromImages, replacePageWithImage, setCropBox, watermark, type AddTextInput, type AttachInput, type FromImagesInput, type HeaderFooterInput, type ImageFile, type WatermarkInput } from "./stamps";
import { compressDocument, type CompressOptions, type CompressReport, type ImageCodec } from "./compress";

export interface Permissions {
  printing?: boolean | "lowResolution" | "highResolution";
  modifying?: boolean;
  copying?: boolean;
  annotating?: boolean;
  fillingForms?: boolean;
  contentAccessibility?: boolean;
  documentAssembly?: boolean;
}

export type PdfOp =
  | { type: "note"; page: number; x: number; y: number; text: string; author: string; color: Rgb }
  | { type: "move-note"; id: string; x: number; y: number }
  | { type: "reply"; parentId: string; text: string; author: string }
  | { type: "resolve"; parentId: string; resolved: boolean; author: string }
  | { type: "contents"; id: string; text: string }
  | { type: "delete-annot"; id: string }
  | { type: "markup"; page: number; subtype: TextMarkupSubtype; quads: number[]; color: Rgb; author: string; text?: string; opacity?: number }
  | { type: "author"; author: string }
  | { type: "clear-annots"; which: "markup" | "all" }
  | { type: "reorder"; order: number[] }
  | { type: "rotate"; pages: number[]; delta: 90 | -90 | 180 }
  | { type: "delete-pages"; pages: number[] }
  | { type: "duplicate"; pages: number[] }
  | { type: "blank"; at: number; width?: number; height?: number }
  | { type: "insert-pdf"; at: number; bytes: Uint8Array; password?: string; pages?: number[] }
  | { type: "crop"; pages: number[]; inset: CropInset }
  | { type: "crop-box"; pages: number[]; box: [number, number, number, number] }
  | { type: "uncrop"; pages: number[] }
  | { type: "extract"; pages: number[]; name: string }
  | { type: "split"; runs: number[][]; names: string[] }
  | { type: "info"; patch: Partial<PdfInfo> }
  | { type: "flatten"; forms: boolean; annots: boolean }
  | { type: "flatten-annots"; pages?: number[] }
  | { type: "encrypt"; userPassword: string; ownerPassword: string; permissions?: Permissions }
  | { type: "decrypt" }
  | { type: "edit-text"; page: number; ops: TextOpEdit[] }
  | { type: "add-text"; input: AddTextInput }
  | { type: "redact"; page: number; ops: TextOpEdit[]; rects: [number, number, number, number][]; image?: ImageFile }
  | { type: "watermark"; input: WatermarkInput }
  | { type: "header-footer"; input: HeaderFooterInput }
  | { type: "from-images"; input: FromImagesInput }
  | { type: "page-image"; page: number; image: ImageFile }
  | { type: "attach"; input: AttachInput }
  | { type: "detach"; name: string }
  | { type: "compress"; options: CompressOptions }
  | { type: "resave" };

export interface OpApplied {
  /** True when the document was changed and must be saved. */
  changed: boolean;
  /** The id of an annotation the operation made. */
  id?: string;
  /** Files the operation produced beside the document (extract, split). */
  files?: { name: string; bytes: Uint8Array }[];
  /** How many things the operation touched, for a status line. */
  count?: number;
  /** Something the user should hear about (characters a font lacked, say). */
  warnings?: string[];
  /** What a compression did. */
  report?: CompressReport;
}

/** What operations need from the outside: font bytes, and a canvas for pictures when there is one. */
export interface OpEnv {
  fonts: FontSource;
  codec?: ImageCodec | null;
}

const NO_FONTS: FontSource = { bytes: () => Promise.reject(new Error("No font source: only the standard fonts are available here.")) };

const missingWarning = (missing: string[]) => (missing.length ? [`These characters are not in the fonts PDF Studio can write with and were left blank: ${missing.join(" ")}`] : undefined);

/** Runs one operation on a loaded document. Throws with a message meant for the user. */
export async function applyOp(doc: PDFDocument, op: PdfOp, env: OpEnv = { fonts: NO_FONTS }): Promise<OpApplied> {
  switch (op.type) {
    case "note":
      return { changed: true, id: addNote(doc, op) };
    case "move-note":
      return { changed: moveNote(doc, op.id, op.x, op.y) };
    case "reply": {
      const id = addReply(doc, op);
      if (!id) throw new Error("The comment this replies to is no longer in the file");
      return { changed: true, id };
    }
    case "resolve": {
      const id = setReviewState(doc, op);
      if (!id) throw new Error("The comment is no longer in the file");
      return { changed: true, id };
    }
    case "contents":
      if (!setContents(doc, op.id, op.text)) throw new Error("The comment is no longer in the file");
      return { changed: true };
    case "delete-annot": {
      const n = deleteAnnotation(doc, op.id, { replies: true });
      return { changed: n > 0, count: n };
    }
    case "markup": {
      const id = addTextMarkup(doc, op);
      if (!id) throw new Error("Nothing is selected");
      return { changed: true, id };
    }
    case "author": {
      const n = stampAuthor(doc, op.author);
      return { changed: n > 0, count: n };
    }
    case "clear-annots": {
      const n = removeAnnotations(doc, op.which);
      return { changed: n > 0, count: n };
    }
    case "reorder":
      reorderPages(doc, op.order);
      return { changed: true };
    case "rotate":
      rotatePages(doc, op.pages, op.delta);
      return { changed: true, count: op.pages.length };
    case "delete-pages":
      deletePages(doc, op.pages);
      return { changed: true, count: op.pages.length };
    case "duplicate":
      await duplicatePages(doc, op.pages);
      return { changed: true, count: op.pages.length };
    case "blank":
      insertBlankPage(doc, op);
      return { changed: true, count: 1 };
    case "insert-pdf": {
      const other = await loadPdf(op.bytes, { password: op.password });
      const n = await insertPdfPages(doc, op.at, other, op.pages);
      return { changed: n > 0, count: n };
    }
    case "crop":
      cropPages(doc, op.pages, op.inset);
      return { changed: true, count: op.pages.length };
    case "crop-box":
      setCropBox(doc, op.pages, op.box);
      return { changed: true, count: op.pages.length };
    case "uncrop":
      uncropPages(doc, op.pages);
      return { changed: true, count: op.pages.length };
    case "extract":
      return { changed: false, files: [{ name: op.name, bytes: await extractPages(doc, op.pages) }] };
    case "split": {
      const files: { name: string; bytes: Uint8Array }[] = [];
      for (let i = 0; i < op.runs.length; i++) files.push({ name: op.names[i] ?? `part-${i + 1}.pdf`, bytes: await extractPages(doc, op.runs[i]) });
      return { changed: false, files };
    }
    case "info":
      writeInfo(doc, op.patch);
      return { changed: true };
    case "flatten": {
      let n = 0;
      if (op.forms) {
        try {
          doc.getForm().flatten();
        } catch (e) {
          throw new Error(`The form could not be flattened: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (op.annots) n = flattenAnnotations(doc);
      return { changed: true, count: n };
    }
    case "flatten-annots": {
      const n = flattenAnnotations(doc, op.pages);
      return { changed: n > 0, count: n };
    }
    case "encrypt":
      doc.encrypt({ userPassword: op.userPassword, ownerPassword: op.ownerPassword || op.userPassword, permissions: op.permissions });
      return { changed: true };
    case "decrypt":
      return { changed: true };
    case "edit-text": {
      const r = await rewriteTextOps(doc, op.page, op.ops, env.fonts);
      return { changed: r.count > 0, count: r.count, warnings: missingWarning(r.missing) };
    }
    case "add-text": {
      const missing = await addText(doc, env.fonts, op.input);
      return { changed: true, count: 1, warnings: missingWarning(missing) };
    }
    case "redact": {
      let n = 0;
      if (op.ops.length) n = (await rewriteTextOps(doc, op.page, op.ops, env.fonts)).count;
      const page = doc.getPage(op.page);
      n += removeAnnotationsIn(doc, op.page, op.rects);
      for (const [x0, y0, x1, y1] of op.rects) page.drawRectangle({ x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0), color: rgb(0, 0, 0) });
      if (op.image) await replacePageWithImage(doc, op.page, op.image);
      return { changed: true, count: n };
    }
    case "watermark": {
      const missing = await watermark(doc, env.fonts, op.input);
      return { changed: true, count: op.input.pages.length, warnings: missingWarning(missing) };
    }
    case "header-footer": {
      const missing = await headerFooter(doc, env.fonts, op.input);
      return { changed: true, count: op.input.pages.length, warnings: missingWarning(missing) };
    }
    case "from-images": {
      const n = await pagesFromImages(doc, op.input);
      return { changed: n > 0, count: n };
    }
    case "page-image":
      await replacePageWithImage(doc, op.page, op.image);
      return { changed: true, count: 1 };
    case "attach":
      await attachFile(doc, op.input);
      return { changed: true, count: 1 };
    case "detach": {
      const ok = detachFile(doc, op.name);
      if (!ok) throw new Error("That attachment is not in the file.");
      return { changed: true, count: 1 };
    }
    case "compress": {
      const report = await compressDocument(doc, op.options, env.codec ?? null);
      return { changed: true, report, warnings: report.notes.length ? report.notes : undefined };
    }
    case "resave":
      return { changed: true };
  }
}

/** Removes the annotations whose rectangle meets one of the given boxes (and their popups). */
function removeAnnotationsIn(doc: PDFDocument, pageIndex: number, rects: [number, number, number, number][]): number {
  const page = doc.getPage(pageIndex);
  const annots = page.node.Annots();
  if (!annots) return 0;
  const hit = new Set<string>();
  const kept: PDFRef[] = [];
  for (let i = 0; i < annots.size(); i++) {
    const ref = annots.get(i);
    const d = annots.lookup(i);
    if (!(ref instanceof PDFRef) || !(d instanceof PDFDict)) continue;
    const r = d.lookup(PDFName.of("Rect"));
    const box = r instanceof PDFArray ? r.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : 0)) : null;
    const sub = d.lookup(PDFName.of("Subtype"));
    const isPopup = sub instanceof PDFName && sub.decodeText() === "Popup";
    const inside = box && box.length === 4 && rects.some(([x0, y0, x1, y1]) => Math.min(box[0], box[2]) < Math.max(x0, x1) && Math.max(box[0], box[2]) > Math.min(x0, x1) && Math.min(box[1], box[3]) < Math.max(y0, y1) && Math.max(box[1], box[3]) > Math.min(y0, y1));
    if (inside && !isPopup) hit.add(ref.tag);
    else kept.push(ref);
  }
  if (!hit.size) return 0;
  const final = kept.filter((ref) => {
    const d = doc.context.lookup(ref);
    const parent = d instanceof PDFDict ? d.get(PDFName.of("Parent")) : null;
    return !(parent instanceof PDFRef && hit.has(parent.tag));
  });
  page.node.set(PDFName.of("Annots"), doc.context.obj(final));
  return hit.size;
}

/** The whole round trip for Node checks: bytes in, bytes out. */
export async function runOp(bytes: Uint8Array, op: PdfOp, password?: string, env?: OpEnv): Promise<{ bytes: Uint8Array } & OpApplied> {
  const doc = await loadPdf(bytes, { password });
  const applied = await applyOp(doc, op, env);
  if (applied.changed && password !== undefined && op.type !== "decrypt" && op.type !== "encrypt") doc.encrypt({ userPassword: password, ownerPassword: password });
  return { bytes: applied.changed ? await doc.save() : bytes, ...applied };
}
