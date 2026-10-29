/**
 * Things drawn onto pages for good with pdf-lib: text at a point, watermarks, headers and footers with page numbers,
 * a page turned into a picture (redaction by flattening), pages made from images, a visual crop box, comments baked
 * into the page, and the document's attachments.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFStream, PDFString, PDFHexString, concatTransformationMatrix, degrees, drawObject, popGraphicsState, pushGraphicsState, rgb, type PDFObject, type PDFPage } from "@cantoo/pdf-lib";
import type { Rgb } from "./annots";
import { dropMissing, fontFor, type FontSource, type FontStyle } from "./fonts";
import { transformedBounds, type Matrix } from "./content";

/* ------------------------------------------------------------ geometry */

interface Visual {
  /** The visible page's size as displayed (rotation applied). */
  width: number;
  height: number;
  rotation: number;
  box: { x: number; y: number; width: number; height: number };
}

function visual(page: PDFPage): Visual {
  const box = page.getCropBox();
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const turned = rotation % 180 !== 0;
  return { width: turned ? box.height : box.width, height: turned ? box.width : box.height, rotation, box };
}

/** A point in the displayed page (origin bottom-left as seen, y up) → PDF user space, and the rotation text needs. */
function toUser(v: Visual, vx: number, vy: number): { x: number; y: number; rotate: number } {
  const { box, rotation } = v;
  const W = box.width, H = box.height;
  switch (rotation) {
    case 90:
      return { x: box.x + W - vy, y: box.y + vx, rotate: 90 };
    case 180:
      return { x: box.x + W - vx, y: box.y + H - vy, rotate: 180 };
    case 270:
      return { x: box.x + vy, y: box.y + H - vx, rotate: 270 };
    default:
      return { x: box.x + vx, y: box.y + vy, rotate: 0 };
  }
}

const color = (c: Rgb) => rgb(Math.max(0, Math.min(1, c[0])), Math.max(0, Math.min(1, c[1])), Math.max(0, Math.min(1, c[2])));

/* ------------------------------------------------------------ add text */

export interface AddTextInput {
  page: number;
  /** Baseline start in PDF user space. */
  x: number;
  y: number;
  text: string;
  size: number;
  color: Rgb;
  style: FontStyle;
  /** Degrees, counter-clockwise. */
  rotate?: number;
}

export async function addText(doc: PDFDocument, fonts: FontSource, input: AddTextInput): Promise<string[]> {
  const page = doc.getPage(input.page);
  const { font, missing } = await fontFor(doc, fonts, input.text, input.style);
  const lines = dropMissing(input.text, missing).split(/\r?\n/);
  const lead = input.size * 1.2;
  lines.forEach((line, i) => {
    if (!line) return;
    page.drawText(line, { x: input.x, y: input.y - i * lead, size: input.size, font, color: color(input.color), rotate: degrees(input.rotate ?? 0) });
  });
  return missing;
}

/* ----------------------------------------------------------- watermark */

export interface WatermarkInput {
  pages: number[];
  text: string;
  /** Points; 0 fits the text across the page's diagonal. */
  size: number;
  color: Rgb;
  opacity: number;
  /** Degrees counter-clockwise; 45 runs bottom-left to top-right. */
  angle: number;
  style: FontStyle;
  layout: "center" | "tile";
}

export async function watermark(doc: PDFDocument, fonts: FontSource, input: WatermarkInput): Promise<string[]> {
  const { font, missing } = await fontFor(doc, fonts, input.text, input.style);
  const text = dropMissing(input.text, missing) || input.text;
  const a = (input.angle * Math.PI) / 180;
  for (const i of input.pages) {
    const page = doc.getPage(i);
    const v = visual(page);
    const diag = Math.hypot(v.width, v.height);
    let size = input.size;
    if (!size) {
      const w1 = font.widthOfTextAtSize(text, 100);
      size = Math.max(8, Math.min(200, (0.7 * diag * 100) / Math.max(1, w1)));
    }
    const w = font.widthOfTextAtSize(text, size);
    const h = size * 0.7;
    const draw = (cx: number, cy: number) => {
      // Centre the rotated text on (cx, cy): the start point sits half the text back along its direction.
      const vx = cx - (w / 2) * Math.cos(a) + (h / 2) * Math.sin(a);
      const vy = cy - (w / 2) * Math.sin(a) - (h / 2) * Math.cos(a);
      const u = toUser(v, vx, vy);
      page.drawText(text, { x: u.x, y: u.y, size, font, color: color(input.color), opacity: input.opacity, rotate: degrees(u.rotate + input.angle) });
    };
    if (input.layout === "tile") {
      const stepX = Math.max(w * 1.3, 120), stepY = Math.max(size * 4, 100);
      for (let y = stepY / 2; y < v.height + stepY; y += stepY) for (let x = stepX / 2; x < v.width + stepX; x += stepX) draw(x, y);
    } else draw(v.width / 2, v.height / 2);
  }
  return missing;
}

/* ------------------------------------------------------- header/footer */

export type SlotPosition = "tl" | "tc" | "tr" | "bl" | "bc" | "br";

export interface HeaderFooterInput {
  pages: number[];
  slots: { pos: SlotPosition; text: string }[];
  size: number;
  color: Rgb;
  style: FontStyle;
  /** Distance from the page's edges, points. */
  marginX: number;
  marginY: number;
  /** The number the first page of the document carries. */
  start: number;
  /** Overrides the total used for {N}. */
  total?: number;
  /** For {title}, {author} and {date}; defaults come from the document and today. */
  fields?: Record<string, string>;
}

/** Fills {n}, {N}, {n:3}, {title}, {author}, {date}, {file} and any field given. */
export function fillPlaceholders(text: string, pageNumber: number, total: number, fields: Record<string, string>): string {
  return text.replace(/\{(\w+)(?::(\d+))?\}/g, (m, key: string, pad?: string) => {
    if (key === "n") return pad ? String(pageNumber).padStart(Number(pad), "0") : String(pageNumber);
    if (key === "N") return String(total);
    if (key in fields) return fields[key];
    return m;
  });
}

export async function headerFooter(doc: PDFDocument, fonts: FontSource, input: HeaderFooterInput): Promise<string[]> {
  const total = input.total ?? doc.getPageCount() + input.start - 1;
  const today = new Date();
  const fields = { title: doc.getTitle() ?? "", author: doc.getAuthor() ?? "", date: today.toISOString().slice(0, 10), ...input.fields };
  const missing = new Set<string>();
  for (const i of input.pages) {
    const page = doc.getPage(i);
    const v = visual(page);
    for (const slot of input.slots) {
      const raw = fillPlaceholders(slot.text, input.start + i, total, fields);
      if (!raw.trim()) continue;
      const { font, missing: m } = await fontFor(doc, fonts, raw, input.style);
      m.forEach((ch) => missing.add(ch));
      const text = dropMissing(raw, m);
      const w = font.widthOfTextAtSize(text, input.size);
      const top = slot.pos.startsWith("t");
      const vy = top ? v.height - input.marginY - input.size * 0.75 : input.marginY;
      const vx = slot.pos.endsWith("l") ? input.marginX : slot.pos.endsWith("r") ? v.width - input.marginX - w : (v.width - w) / 2;
      const u = toUser(v, vx, vy);
      page.drawText(text, { x: u.x, y: u.y, size: input.size, font, color: color(input.color), rotate: degrees(u.rotate) });
    }
  }
  return [...missing];
}

/* ------------------------------------------------------------ crop box */

/** Sets the crop box of pages to a rectangle in PDF user space (clamped to the media box). */
export function setCropBox(doc: PDFDocument, pages: number[], box: [number, number, number, number]): void {
  for (const i of pages) {
    const page = doc.getPage(i);
    const m = page.getMediaBox();
    const x0 = Math.max(m.x, Math.min(box[0], box[2])), x1 = Math.min(m.x + m.width, Math.max(box[0], box[2]));
    const y0 = Math.max(m.y, Math.min(box[1], box[3])), y1 = Math.min(m.y + m.height, Math.max(box[1], box[3]));
    if (x1 - x0 < 8 || y1 - y0 < 8) throw new Error("The crop area is too small.");
    page.setCropBox(x0, y0, x1 - x0, y1 - y0);
  }
}

/* ------------------------------------------------------------- images */

export interface ImageFile {
  bytes: Uint8Array;
  kind: "png" | "jpg";
  name?: string;
}

export interface FromImagesInput {
  /** Insert before this index; the page count appends. */
  at: number;
  images: ImageFile[];
  /** "fit": the page takes the image's size (at 96 px per inch); else the image is fitted on that paper. */
  paper: "fit" | "a4" | "letter";
  /** Points, for a4/letter. */
  margin: number;
}

const PAPER = { a4: [595.28, 841.89], letter: [612, 792] } as const;

export async function pagesFromImages(doc: PDFDocument, input: FromImagesInput): Promise<number> {
  let at = Math.max(0, Math.min(input.at, doc.getPageCount()));
  for (const img of input.images) {
    const embedded = img.kind === "png" ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
    const iw = embedded.width, ih = embedded.height;
    if (input.paper === "fit") {
      const w = (iw * 72) / 96, h = (ih * 72) / 96;
      const page = doc.insertPage(at++, [w, h]);
      page.drawImage(embedded, { x: 0, y: 0, width: w, height: h });
    } else {
      const [pw0, ph0] = PAPER[input.paper];
      const landscape = iw > ih;
      const pw = landscape ? ph0 : pw0, ph = landscape ? pw0 : ph0;
      const page = doc.insertPage(at++, [pw, ph]);
      const maxW = pw - 2 * input.margin, maxH = ph - 2 * input.margin;
      const s = Math.min(maxW / iw, maxH / ih);
      const w = iw * s, h = ih * s;
      page.drawImage(embedded, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    }
  }
  return input.images.length;
}

/** Replaces a page's content with a picture of it (same displayed size, no rotation, no annotations). */
export async function replacePageWithImage(doc: PDFDocument, pageIndex: number, image: ImageFile): Promise<void> {
  const page = doc.getPage(pageIndex);
  const v = visual(page);
  const embedded = image.kind === "png" ? await doc.embedPng(image.bytes) : await doc.embedJpg(image.bytes);
  page.node.set(PDFName.of("Contents"), doc.context.obj([]));
  page.node.delete(PDFName.of("Annots"));
  page.node.delete(PDFName.of("Thumb"));
  page.setMediaBox(0, 0, v.width, v.height);
  page.setCropBox(0, 0, v.width, v.height);
  page.node.delete(PDFName.of("BleedBox"));
  page.node.delete(PDFName.of("TrimBox"));
  page.node.delete(PDFName.of("ArtBox"));
  page.setRotation(degrees(0));
  const p = page as unknown as { contentStream?: unknown; contentStreamRef?: unknown };
  p.contentStream = undefined;
  p.contentStreamRef = undefined;
  page.drawImage(embedded, { x: 0, y: 0, width: v.width, height: v.height });
}

/* ---------------------------------------------------- flatten comments */

const NO_FLATTEN = new Set(["Link", "Popup", "Widget", "Screen", "Movie", "3D", "RichMedia", "FileAttachment", "Sound"]);

/**
 * Draws each comment's appearance into the page content and removes the annotation, so the marks become part of
 * the page (form fields and links are left alone). Returns how many were flattened.
 */
export function flattenAnnotations(doc: PDFDocument, pages?: number[]): number {
  let n = 0;
  const which = pages ?? doc.getPageIndices();
  for (const i of which) {
    const page = doc.getPage(i);
    const annots = page.node.Annots();
    if (!annots) continue;
    const keep: PDFObject[] = [];
    const removed = new Set<string>();
    for (let k = 0; k < annots.size(); k++) {
      const ref = annots.get(k);
      const dict = annots.lookup(k);
      if (!(dict instanceof PDFDict)) continue;
      const subtype = dict.lookup(PDFName.of("Subtype"));
      const sub = subtype instanceof PDFName ? subtype.decodeText() : "";
      const flags = dict.lookup(PDFName.of("F"));
      const f = flags instanceof PDFNumber ? flags.asNumber() : 0;
      const hidden = (f & 2) !== 0 || (f & 32) !== 0;
      if (NO_FLATTEN.has(sub) || hidden) {
        keep.push(ref);
        continue;
      }
      const ap = appearanceStream(doc, dict);
      if (ap) {
        const rectArr = dict.lookup(PDFName.of("Rect"));
        const rect = rectArr instanceof PDFArray ? rectArr.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : 0)) : null;
        if (rect && rect.length === 4) {
          drawAppearance(doc, page, ap.ref, ap.stream, [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])]);
        }
      }
      if (ref instanceof PDFRef) removed.add(ref.tag);
      n++;
    }
    // Popups, replies and review states of removed annotations go too (and theirs, in turn).
    let kept = keep;
    for (;;) {
      const next = kept.filter((r) => {
        const d = r instanceof PDFRef ? doc.context.lookup(r) : r;
        if (!(d instanceof PDFDict)) return true;
        const parent = d.get(PDFName.of("Parent"));
        const irt = d.get(PDFName.of("IRT"));
        const gone = (parent instanceof PDFRef && removed.has(parent.tag)) || (irt instanceof PDFRef && removed.has(irt.tag));
        if (gone && r instanceof PDFRef) removed.add(r.tag);
        return !gone;
      });
      if (next.length === kept.length) break;
      kept = next;
    }
    page.node.set(PDFName.of("Annots"), doc.context.obj(kept));
  }
  return n;
}

function appearanceStream(doc: PDFDocument, annot: PDFDict): { ref: PDFRef; stream: PDFStream } | null {
  const ap = annot.lookup(PDFName.of("AP"));
  if (!(ap instanceof PDFDict)) return null;
  let n = ap.get(PDFName.of("N"));
  let obj = n instanceof PDFRef ? doc.context.lookup(n) : n;
  if (obj instanceof PDFDict && !(obj instanceof PDFStream)) {
    const as = annot.lookup(PDFName.of("AS"));
    const states = obj;
    const key = as instanceof PDFName ? as : states.keys()[0];
    if (!key) return null;
    n = states.get(key);
    obj = n instanceof PDFRef ? doc.context.lookup(n) : n;
  }
  if (!(obj instanceof PDFStream)) return null;
  const ref = n instanceof PDFRef ? n : doc.context.register(obj);
  return { ref, stream: obj };
}

/** Form XObject → page: the appearance's BBox (through its Matrix) is mapped onto the annotation's Rect (8.4.4 / 12.5.5). */
function drawAppearance(doc: PDFDocument, page: PDFPage, ref: PDFRef, stream: PDFStream, rect: [number, number, number, number]) {
  const bboxArr = stream.dict.lookup(PDFName.of("BBox"));
  const bbox = bboxArr instanceof PDFArray ? bboxArr.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : 0)) : [0, 0, 1, 1];
  const mArr = stream.dict.lookup(PDFName.of("Matrix"));
  const matrix: Matrix = mArr instanceof PDFArray && mArr.size() === 6 ? (mArr.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : 0)) as Matrix) : [1, 0, 0, 1, 0, 0];
  const b = transformedBounds(matrix, Math.min(bbox[0], bbox[2]), Math.min(bbox[1], bbox[3]), Math.max(bbox[0], bbox[2]), Math.max(bbox[1], bbox[3]));
  const bw = b[2] - b[0], bh = b[3] - b[1];
  const sx = bw > 1e-6 ? (rect[2] - rect[0]) / bw : 1;
  const sy = bh > 1e-6 ? (rect[3] - rect[1]) / bh : 1;
  const tx = rect[0] - b[0] * sx, ty = rect[1] - b[1] * sy;
  const name = page.node.newXObject("Annot", ref);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(sx, 0, 0, sy, tx, ty), drawObject(name), popGraphicsState());
}

/* --------------------------------------------------------- attachments */

export interface AttachInput {
  bytes: Uint8Array;
  name: string;
  mimeType?: string;
  description?: string;
}

export async function attachFile(doc: PDFDocument, input: AttachInput): Promise<void> {
  await doc.attach(input.bytes, input.name, { mimeType: input.mimeType ?? "application/octet-stream", description: input.description, creationDate: new Date(), modificationDate: new Date() });
}

const textOf = (v: unknown): string | null => (v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : null);

/** Removes an embedded file by its name in the EmbeddedFiles name tree (or its file name). Returns true when found. */
export function detachFile(doc: PDFDocument, name: string): boolean {
  const names = doc.catalog.lookup(PDFName.of("Names"));
  if (!(names instanceof PDFDict)) return false;
  const root = names.lookup(PDFName.of("EmbeddedFiles"));
  if (!(root instanceof PDFDict)) return false;
  let found = false;
  const visit = (node: PDFDict) => {
    const arr = node.lookup(PDFName.of("Names"));
    if (arr instanceof PDFArray) {
      const kept: PDFObject[] = [];
      for (let i = 0; i + 1 < arr.size(); i += 2) {
        const key = textOf(arr.lookup(i));
        const spec = arr.lookup(i + 1);
        const fname = spec instanceof PDFDict ? (textOf(spec.lookup(PDFName.of("UF"))) ?? textOf(spec.lookup(PDFName.of("F")))) : null;
        if (!found && (key === name || fname === name)) {
          found = true;
          continue;
        }
        kept.push(arr.get(i), arr.get(i + 1));
      }
      node.set(PDFName.of("Names"), doc.context.obj(kept));
    }
    const kids = node.lookup(PDFName.of("Kids"));
    if (kids instanceof PDFArray)
      for (let i = 0; i < kids.size(); i++) {
        const kid = kids.lookup(i);
        if (kid instanceof PDFDict) visit(kid);
      }
  };
  visit(root);
  return found;
}
