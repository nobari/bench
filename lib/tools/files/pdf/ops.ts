/**
 * Everything that changes a document's bytes, as one operation type run by the worker (components/widgets/
 * pdf-ops.worker.ts) and by Node checks. An operation mutates a loaded pdf-lib document; the caller saves.
 */
import { PDFDocument } from "@cantoo/pdf-lib";
import { addNote, addReply, addTextMarkup, deleteAnnotation, moveNote, removeAnnotations, setContents, setReviewState, stampAuthor, type Rgb, type TextMarkupSubtype } from "./annots";
import { writeInfo, type PdfInfo } from "./meta";
import { cropPages, deletePages, duplicatePages, extractPages, insertBlankPage, insertPdfPages, loadPdf, reorderPages, rotatePages, uncropPages, type CropInset } from "./pages";

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
  | { type: "uncrop"; pages: number[] }
  | { type: "extract"; pages: number[]; name: string }
  | { type: "split"; runs: number[][]; names: string[] }
  | { type: "info"; patch: Partial<PdfInfo> }
  | { type: "flatten"; forms: boolean; annots: boolean }
  | { type: "encrypt"; userPassword: string; ownerPassword: string }
  | { type: "decrypt" };

export interface OpApplied {
  /** True when the document was changed and must be saved. */
  changed: boolean;
  /** The id of an annotation the operation made. */
  id?: string;
  /** Files the operation produced beside the document (extract, split). */
  files?: { name: string; bytes: Uint8Array }[];
  /** How many things the operation touched, for a status line. */
  count?: number;
}

/** Runs one operation on a loaded document. Throws with a message meant for the user. */
export async function applyOp(doc: PDFDocument, op: PdfOp): Promise<OpApplied> {
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
      if (op.forms) {
        try {
          doc.getForm().flatten();
        } catch (e) {
          throw new Error(`The form could not be flattened: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (op.annots) removeAnnotations(doc, "markup");
      return { changed: true };
    }
    case "encrypt":
      doc.encrypt({ userPassword: op.userPassword, ownerPassword: op.ownerPassword || op.userPassword });
      return { changed: true };
    case "decrypt":
      return { changed: true };
  }
}

/** The whole round trip for Node checks: bytes in, bytes out. */
export async function runOp(bytes: Uint8Array, op: PdfOp, password?: string): Promise<{ bytes: Uint8Array } & OpApplied> {
  const doc = await loadPdf(bytes, { password });
  const applied = await applyOp(doc, op);
  if (applied.changed && password !== undefined && op.type !== "decrypt" && op.type !== "encrypt") doc.encrypt({ userPassword: password, ownerPassword: password });
  return { bytes: applied.changed ? await doc.save() : bytes, ...applied };
}
