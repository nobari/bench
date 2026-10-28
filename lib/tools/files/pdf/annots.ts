/**
 * Annotations written with pdf-lib: sticky notes with a drawn icon and a popup, replies and review states threaded
 * with /IRT the way Acrobat does it, text markup from quad points, and the author stamped onto annotations pdf.js
 * saved without one. Identity is pdf.js's: the object reference as "12R" (generation appended when not zero).
 */
import {
  LineJoinStyle,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
  appendBezierCurve,
  closePath,
  fill,
  fillAndStroke,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  setFillingRgbColor,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  type PDFPage,
} from "@cantoo/pdf-lib";
import { pdfDate } from "./dates";

/** A colour as three 0…1 components. */
export type Rgb = [number, number, number];

export const MARKUP_SUBTYPES = new Set([
  "Text",
  "FreeText",
  "Line",
  "Square",
  "Circle",
  "Polygon",
  "PolyLine",
  "Highlight",
  "Underline",
  "Squiggly",
  "StrikeOut",
  "Stamp",
  "Caret",
  "Ink",
  "FileAttachment",
  "Sound",
  "Redact",
]);

export type TextMarkupSubtype = "Highlight" | "Underline" | "StrikeOut" | "Squiggly";

/* ------------------------------------------------------------------ colours */

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [1, 0.85, 0.2];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/* ---------------------------------------------------------------- identity */

/** The pdf-lib reference an id from pdf.js names, or null for an annotation that is not an indirect object. */
export function refFromId(id: string): PDFRef | null {
  const m = /^(\d+)R(\d*)$/.exec(id);
  return m ? PDFRef.of(Number(m[1]), m[2] ? Number(m[2]) : 0) : null;
}

export function idFromRef(ref: PDFRef): string {
  return `${ref.objectNumber}R${ref.generationNumber || ""}`;
}

const sameRef = (a: PDFRef, b: PDFRef) => a.objectNumber === b.objectNumber && a.generationNumber === b.generationNumber;

interface Found {
  page: PDFPage;
  pageIndex: number;
  annots: PDFArray;
  index: number;
  ref: PDFRef;
  dict: PDFDict;
}

/** Every annotation of a page as [ref, dict] pairs, direct dictionaries skipped (pdf.js cannot name those either). */
function annotsOf(doc: PDFDocument, page: PDFPage): { annots: PDFArray | undefined; entries: { index: number; ref: PDFRef; dict: PDFDict }[] } {
  const annots = page.node.Annots();
  const entries: { index: number; ref: PDFRef; dict: PDFDict }[] = [];
  if (!annots) return { annots, entries };
  for (let i = 0; i < annots.size(); i++) {
    const el = annots.get(i);
    if (!(el instanceof PDFRef)) continue;
    const dict = doc.context.lookup(el);
    if (dict instanceof PDFDict) entries.push({ index: i, ref: el, dict });
  }
  return { annots, entries };
}

export function findAnnotation(doc: PDFDocument, id: string): Found | null {
  const target = refFromId(id);
  if (!target) return null;
  const pages = doc.getPages();
  for (let p = 0; p < pages.length; p++) {
    const { annots, entries } = annotsOf(doc, pages[p]);
    if (!annots) continue;
    for (const e of entries) if (sameRef(e.ref, target)) return { page: pages[p], pageIndex: p, annots, ...e };
  }
  return null;
}

/* ------------------------------------------------------------------ writing */

const text = (s: string) => PDFHexString.fromText(s);
const date = (d: Date) => PDFString.of(pdfDate(d));

const subtypeOf = (dict: PDFDict): string | null => {
  const v = dict.get(PDFName.of("Subtype"));
  return v instanceof PDFName ? v.decodeText() : null;
};

/** Flags: Print (4) for things that show; NoView (32) + NoZoom (8) + NoRotate (16) for replies and states. */
const SHOWN = 4;
const NOTE_FLAGS = 4 + 8 + 16;
const HIDDEN_REPLY = 32 + 8 + 16;

/** The note icon: a speech bubble in the note's colour with a darker outline, 20 × 20 points. */
function noteIcon(doc: PDFDocument, color: Rgb): PDFRef {
  const dark: Rgb = [color[0] * 0.45, color[1] * 0.45, color[2] * 0.45];
  const k = 0.5523; // circle-to-bezier
  const x0 = 1.5, y0 = 5.5, x1 = 18.5, y1 = 18.5, r = 3;
  const ops = [
    pushGraphicsState(),
    setLineWidth(1.1),
    setLineJoin(LineJoinStyle.Round),
    setStrokingRgbColor(dark[0], dark[1], dark[2]),
    setFillingRgbColor(color[0], color[1], color[2]),
    // body: rounded rectangle drawn clockwise from the bottom-left corner, with a tail at the bottom-left
    moveTo(x0 + r, y0),
    lineTo(x0 + r + 2.5, y0),
    lineTo(x0 + 2.5, 1.5),
    lineTo(x0 + r + 6, y0),
    lineTo(x1 - r, y0),
    appendBezierCurve(x1 - r + r * k, y0, x1, y0 + r - r * k, x1, y0 + r),
    lineTo(x1, y1 - r),
    appendBezierCurve(x1, y1 - r + r * k, x1 - r + r * k, y1, x1 - r, y1),
    lineTo(x0 + r, y1),
    appendBezierCurve(x0 + r - r * k, y1, x0, y1 - r + r * k, x0, y1 - r),
    lineTo(x0, y0 + r),
    appendBezierCurve(x0, y0 + r - r * k, x0 + r - r * k, y0, x0 + r, y0),
    closePath(),
    fillAndStroke(),
    // three text lines
    setFillingRgbColor(dark[0], dark[1], dark[2]),
    moveTo(5, 14.6),
    lineTo(15, 14.6),
    lineTo(15, 13.4),
    lineTo(5, 13.4),
    closePath(),
    fill(),
    moveTo(5, 11.6),
    lineTo(15, 11.6),
    lineTo(15, 10.4),
    lineTo(5, 10.4),
    closePath(),
    fill(),
    moveTo(5, 8.6),
    lineTo(11, 8.6),
    lineTo(11, 7.4),
    lineTo(5, 7.4),
    closePath(),
    fill(),
    popGraphicsState(),
  ];
  const stream = doc.context.formXObject(ops, { BBox: [0, 0, 20, 20], Resources: doc.context.obj({}) });
  return doc.context.register(stream);
}

export interface NoteInput {
  /** 0-based page. */
  page: number;
  /** The icon's top-left corner in PDF user space. */
  x: number;
  y: number;
  text: string;
  author: string;
  color: Rgb;
  date?: Date;
  open?: boolean;
}

const NOTE_SIZE = 20;

/** A sticky note (a Text annotation with its Popup); returns its id. */
export function addNote(doc: PDFDocument, input: NoteInput): string {
  const page = doc.getPage(input.page);
  const when = input.date ?? new Date();
  const rect = [input.x, input.y - NOTE_SIZE, input.x + NOTE_SIZE, input.y];
  const noteRef = doc.context.nextRef();
  const popup = doc.context.obj({
    Type: "Annot",
    Subtype: "Popup",
    Rect: [input.x + NOTE_SIZE + 4, input.y - 120, input.x + NOTE_SIZE + 184, input.y],
    Parent: noteRef,
    Open: input.open === true,
    F: 0,
  });
  const popupRef = doc.context.register(popup);
  const note = doc.context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: rect,
    Contents: text(input.text),
    T: text(input.author),
    M: date(when),
    CreationDate: date(when),
    C: input.color,
    CA: 1,
    F: NOTE_FLAGS,
    Name: "Comment",
    Open: input.open === true,
    NM: PDFString.of(`bench-${when.getTime().toString(36)}-${noteRef.objectNumber}`),
    P: page.ref,
    Popup: popupRef,
    AP: doc.context.obj({ N: noteIcon(doc, input.color) }),
  });
  doc.context.assign(noteRef, note);
  page.node.addAnnot(noteRef);
  page.node.addAnnot(popupRef);
  return idFromRef(noteRef);
}

export interface ReplyInput {
  parentId: string;
  text: string;
  author: string;
  date?: Date;
}

/** A reply threaded under an annotation (same rectangle, /IRT, not drawn); returns its id, or null without a parent. */
export function addReply(doc: PDFDocument, input: ReplyInput): string | null {
  const parent = findAnnotation(doc, input.parentId);
  if (!parent) return null;
  const when = input.date ?? new Date();
  const rect = parent.dict.get(PDFName.of("Rect"));
  const color = parent.dict.get(PDFName.of("C"));
  const ref = doc.context.nextRef();
  const reply = doc.context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: rect instanceof PDFArray ? rect.asArray() : [0, 0, 0, 0],
    Contents: text(input.text),
    T: text(input.author),
    M: date(when),
    CreationDate: date(when),
    ...(color instanceof PDFArray ? { C: color.asArray() } : {}),
    F: HIDDEN_REPLY,
    Name: "Comment",
    IRT: parent.ref,
    RT: "R",
    NM: PDFString.of(`bench-${when.getTime().toString(36)}-${ref.objectNumber}`),
    P: parent.page.ref,
  });
  doc.context.assign(ref, reply);
  parent.page.node.addAnnot(ref);
  return idFromRef(ref);
}

export interface StateInput {
  parentId: string;
  resolved: boolean;
  author: string;
  date?: Date;
}

/** A review state ("Completed" or "None") threaded under an annotation, as Acrobat records resolving. */
export function setReviewState(doc: PDFDocument, input: StateInput): string | null {
  const parent = findAnnotation(doc, input.parentId);
  if (!parent) return null;
  const when = input.date ?? new Date();
  const rect = parent.dict.get(PDFName.of("Rect"));
  const state = input.resolved ? "Completed" : "None";
  const ref = doc.context.nextRef();
  const dict = doc.context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: rect instanceof PDFArray ? rect.asArray() : [0, 0, 0, 0],
    Contents: text(state),
    T: text(input.author),
    M: date(when),
    CreationDate: date(when),
    F: HIDDEN_REPLY,
    IRT: parent.ref,
    RT: "R",
    StateModel: PDFString.of("Review"),
    State: PDFString.of(state),
    NM: PDFString.of(`bench-${when.getTime().toString(36)}-${ref.objectNumber}`),
    P: parent.page.ref,
  });
  doc.context.assign(ref, dict);
  parent.page.node.addAnnot(ref);
  return idFromRef(ref);
}

/** Rewrites an annotation's text (and modification date). */
export function setContents(doc: PDFDocument, id: string, contents: string, when = new Date()): boolean {
  const found = findAnnotation(doc, id);
  if (!found) return false;
  found.dict.set(PDFName.of("Contents"), text(contents));
  found.dict.set(PDFName.of("M"), date(when));
  found.dict.delete(PDFName.of("RC"));
  return true;
}

/** Moves a note's icon so its top-left corner sits at (x, y); its popup follows. */
export function moveNote(doc: PDFDocument, id: string, x: number, y: number): boolean {
  const found = findAnnotation(doc, id);
  if (!found) return false;
  const rect = found.dict.get(PDFName.of("Rect"));
  const [x0, y0, x1, y1] = rect instanceof PDFArray ? (rect.asArray().map((v) => (v as { asNumber?: () => number }).asNumber?.() ?? 0) as number[]) : [0, 0, NOTE_SIZE, NOTE_SIZE];
  const w = x1 - x0 || NOTE_SIZE, h = y1 - y0 || NOTE_SIZE;
  found.dict.set(PDFName.of("Rect"), doc.context.obj([x, y - h, x + w, y]));
  const popupRef = found.dict.get(PDFName.of("Popup"));
  if (popupRef instanceof PDFRef) {
    const popup = doc.context.lookup(popupRef);
    if (popup instanceof PDFDict) popup.set(PDFName.of("Rect"), doc.context.obj([x + w + 4, y - 120, x + w + 184, y]));
  }
  return true;
}

/** Removes an annotation, its popup and — with replies — everything threaded under it. Returns how many went. */
export function deleteAnnotation(doc: PDFDocument, id: string, opts: { replies?: boolean } = {}): number {
  const found = findAnnotation(doc, id);
  if (!found) return 0;
  const { annots, entries } = annotsOf(doc, found.page);
  if (!annots) return 0;
  const gone = new Set<number>();
  const victims: PDFRef[] = [found.ref];
  const take = (ref: PDFRef) => {
    for (const e of entries) {
      if (gone.has(e.index)) continue;
      if (sameRef(e.ref, ref)) {
        gone.add(e.index);
        const popup = e.dict.get(PDFName.of("Popup"));
        if (popup instanceof PDFRef) victims.push(popup);
      } else if (opts.replies !== false) {
        const irt = e.dict.get(PDFName.of("IRT"));
        if (irt instanceof PDFRef && sameRef(irt, ref)) victims.push(e.ref);
      }
    }
  };
  while (victims.length) take(victims.shift()!);
  const indices = [...gone].sort((a, b) => b - a);
  for (const i of indices) {
    const el = annots.get(i);
    annots.remove(i);
    if (el instanceof PDFRef) doc.context.delete(el);
  }
  return indices.length;
}

/** Names the author on every markup annotation that has none (pdf.js writes its own without one). */
export function stampAuthor(doc: PDFDocument, author: string, when = new Date()): number {
  if (!author.trim()) return 0;
  let n = 0;
  for (const page of doc.getPages()) {
    for (const { dict } of annotsOf(doc, page).entries) {
      const subtype = subtypeOf(dict);
      if (!subtype || !MARKUP_SUBTYPES.has(subtype) || dict.has(PDFName.of("T"))) continue;
      dict.set(PDFName.of("T"), text(author));
      if (!dict.has(PDFName.of("CreationDate"))) dict.set(PDFName.of("CreationDate"), date(when));
      if (!dict.has(PDFName.of("M"))) dict.set(PDFName.of("M"), date(when));
      n++;
    }
  }
  return n;
}

export interface TextMarkupInput {
  page: number;
  subtype: TextMarkupSubtype;
  /** Flat quad points, 8 numbers per quadrilateral, in PDF user space. */
  quads: number[];
  color: Rgb;
  author: string;
  text?: string;
  opacity?: number;
  date?: Date;
}

/** Underline, strike-out, squiggly or highlight over quads; viewers draw it from the quads and colour. */
export function addTextMarkup(doc: PDFDocument, input: TextMarkupInput): string | null {
  if (input.quads.length < 8 || input.quads.length % 8) return null;
  const page = doc.getPage(input.page);
  const when = input.date ?? new Date();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < input.quads.length; i += 2) {
    x0 = Math.min(x0, input.quads[i]);
    x1 = Math.max(x1, input.quads[i]);
    y0 = Math.min(y0, input.quads[i + 1]);
    y1 = Math.max(y1, input.quads[i + 1]);
  }
  const ref = doc.context.nextRef();
  const dict = doc.context.obj({
    Type: "Annot",
    Subtype: input.subtype,
    Rect: [x0, y0, x1, y1],
    QuadPoints: input.quads,
    C: input.color,
    CA: input.opacity ?? 1,
    F: SHOWN,
    T: text(input.author),
    M: date(when),
    CreationDate: date(when),
    NM: PDFString.of(`bench-${when.getTime().toString(36)}-${ref.objectNumber}`),
    P: page.ref,
    ...(input.text ? { Contents: text(input.text) } : {}),
  });
  doc.context.assign(ref, dict);
  page.node.addAnnot(ref);
  if (input.text) {
    const popup = doc.context.obj({ Type: "Annot", Subtype: "Popup", Rect: [x1 + 4, y1 - 120, x1 + 184, y1], Parent: ref, Open: false, F: 0 });
    const popupRef = doc.context.register(popup);
    dict.set(PDFName.of("Popup"), popupRef);
    page.node.addAnnot(popupRef);
  }
  return idFromRef(ref);
}

/** Drops every annotation of the given subtypes (or all markup) from every page; returns how many went. */
export function removeAnnotations(doc: PDFDocument, which: "markup" | "all" = "markup"): number {
  let n = 0;
  for (const page of doc.getPages()) {
    const { annots, entries } = annotsOf(doc, page);
    if (!annots) continue;
    const drop: number[] = [];
    for (const e of entries) {
      const subtype = subtypeOf(e.dict);
      if (which === "all" ? subtype !== "Widget" && subtype !== "Link" : subtype !== null && (MARKUP_SUBTYPES.has(subtype) || subtype === "Popup")) drop.push(e.index);
    }
    for (const i of drop.sort((a, b) => b - a)) {
      const el = annots.get(i);
      annots.remove(i);
      if (el instanceof PDFRef) doc.context.delete(el);
      n++;
    }
  }
  return n;
}
