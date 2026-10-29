/**
 * A walk over a page's content with pdf-lib — the page's own streams and every form XObject they draw, in the order
 * pdf.js draws them — tracking the transformation matrix and the text state, so that the Nth text-showing operator
 * here is the Nth `showText` in pdf.js's operator list for the page (lib/tools/files/pdf/textruns.ts builds the
 * geometry from that list; the two meet on the ordinal). Also yields every image drawn, with the matrix it is drawn
 * with, for the compressor.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream } from "@cantoo/pdf-lib";
import { IDENTITY, compose, joinStreams, tokenizeContent, type ContentOp, type Matrix, type Operand } from "./content";

export interface TextState {
  fontName: string | null;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
  /** Tz as a factor (1 = 100 %). */
  hscale: number;
  rise: number;
  renderMode: number;
}

export interface GState {
  ctm: Matrix;
  text: TextState;
}

/** One content stream in the walk: the page's (joined) content or a form XObject. */
export interface StreamSite {
  kind: "page" | "xobject";
  ref: PDFRef | null;
  stream: PDFStream | null;
  bytes: Uint8Array;
  ops: ContentOp[];
  resources: PDFDict | null;
  /** How many times the walk drew this stream (a form may be shared by several places or pages). */
  uses: number;
}

export interface TextSite {
  ordinal: number;
  site: StreamSite;
  op: ContentOp;
  opIndex: number;
  state: GState;
  /** The font dictionary the text is set in, when it resolves. */
  font: PDFDict | null;
}

export interface ImageSite {
  name: string;
  ref: PDFRef | null;
  stream: PDFStream;
  ctm: Matrix;
}

export interface WalkResult {
  page: StreamSite;
  texts: TextSite[];
  images: ImageSite[];
  /** Every XObject site touched, by its ref tag. */
  xobjects: Map<string, StreamSite>;
}

const TEXT_SHOW = new Set(["Tj", "TJ", "'", '"']);

const initialText = (): TextState => ({ fontName: null, fontSize: 0, charSpacing: 0, wordSpacing: 0, hscale: 1, rise: 0, renderMode: 0 });

const cloneState = (s: GState): GState => ({ ctm: s.ctm, text: { ...s.text } });

/* --------------------------------------------------------------- streams */

/** The decoded bytes of a stream (an unknown filter yields nothing rather than throwing). */
export function streamBytes(stream: PDFStream): Uint8Array {
  if (stream instanceof PDFRawStream) {
    const filter = stream.dict.get(PDFName.of("Filter"));
    if (!filter) return stream.contents;
    try {
      let out = decodePDFRawStream(stream).decode();
      const parms = stream.dict.lookup(PDFName.of("DecodeParms"));
      const p = parms instanceof PDFDict ? parms : parms instanceof PDFArray ? parms.lookup(parms.size() - 1) : null;
      if (p instanceof PDFDict) out = unpredict(out, p);
      return out;
    } catch {
      return new Uint8Array(0);
    }
  }
  const s = stream as unknown as { getUnencodedContents?: () => Uint8Array; getContents(): Uint8Array };
  return s.getUnencodedContents ? s.getUnencodedContents() : s.getContents();
}

const numOf = (d: PDFDict, key: string, fallback: number): number => {
  const v = d.lookup(PDFName.of(key));
  return v instanceof PDFNumber ? v.asNumber() : fallback;
};

/** Undo a PNG or TIFF predictor (DecodeParms /Predictor) that pdf-lib's decoder leaves in place. */
export function unpredict(data: Uint8Array, parms: PDFDict): Uint8Array {
  const predictor = numOf(parms, "Predictor", 1);
  if (predictor <= 1) return data;
  const colors = numOf(parms, "Colors", 1);
  const bpc = numOf(parms, "BitsPerComponent", 8);
  const columns = numOf(parms, "Columns", 1);
  const bpp = Math.ceil((colors * bpc) / 8);
  const rowLen = Math.ceil((colors * bpc * columns) / 8);
  if (predictor === 2) {
    if (bpc !== 8) return data;
    const out = data.slice();
    const rows = Math.floor(out.length / rowLen);
    for (let r = 0; r < rows; r++) {
      const base = r * rowLen;
      for (let i = bpp; i < rowLen; i++) out[base + i] = (out[base + i] + out[base + i - bpp]) & 0xff;
    }
    return out;
  }
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  let prev = new Uint8Array(rowLen);
  for (let r = 0; r < rows; r++) {
    const ft = data[r * (rowLen + 1)];
    const src = data.subarray(r * (rowLen + 1) + 1, (r + 1) * (rowLen + 1));
    const row = out.subarray(r * rowLen, (r + 1) * rowLen);
    for (let i = 0; i < rowLen; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      switch (ft) {
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
      }
      row[i] = v & 0xff;
    }
    prev = row;
  }
  return out;
}

/** The page's content streams as one byte array, the way readers join them. */
export function pageContentBytes(doc: PDFDocument, pageIndex: number): Uint8Array {
  const page = doc.getPage(pageIndex);
  const contents = page.node.Contents();
  const parts: Uint8Array[] = [];
  const add = (obj: unknown) => {
    const s = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
    if (s instanceof PDFStream) parts.push(streamBytes(s));
  };
  if (contents instanceof PDFArray) for (let i = 0; i < contents.size(); i++) add(contents.get(i));
  else if (contents) add(contents);
  return parts.length ? joinStreams(parts) : new Uint8Array(0);
}

/* ------------------------------------------------------------------ walk */

const matrixOf = (d: PDFDict, key: string): Matrix | null => {
  const arr = d.lookup(PDFName.of(key));
  if (!(arr instanceof PDFArray) || arr.size() !== 6) return null;
  const m = arr.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : NaN));
  return m.every(Number.isFinite) ? (m as Matrix) : null;
};

const argNum = (a: Operand | undefined, fallback = 0) => (a?.t === "num" ? a.v : fallback);

/** True when pdf.js would turn this operator into a `showText` (operands complete, a font set). */
export function isCountedTextOp(op: ContentOp, text: TextState): boolean {
  if (!TEXT_SHOW.has(op.op) || !text.fontName) return false;
  const n = op.args.length;
  if (op.op === '"') return n >= 3 && op.args[n - 1].t === "str";
  if (op.op === "TJ") return n >= 1 && op.args[n - 1].t === "arr";
  return n >= 1 && op.args[n - 1].t === "str";
}

export function walkPage(doc: PDFDocument, pageIndex: number): WalkResult {
  const page = doc.getPage(pageIndex);
  const pageResources = page.node.Resources() ?? null;
  const bytes = pageContentBytes(doc, pageIndex);
  const pageSite: StreamSite = { kind: "page", ref: null, stream: null, bytes, ops: tokenizeContent(bytes), resources: pageResources, uses: 1 };
  const result: WalkResult = { page: pageSite, texts: [], images: [], xobjects: new Map() };
  let ordinal = 0;
  const visiting: string[] = [];

  const walk = (site: StreamSite, resources: PDFDict | null, state: GState) => {
    const stack: GState[] = [];
    let cur = state;
    const xobjects = resources?.lookup(PDFName.of("XObject"));
    const xdict = xobjects instanceof PDFDict ? xobjects : null;
    const fonts = resources?.lookup(PDFName.of("Font"));
    const fdict = fonts instanceof PDFDict ? fonts : null;
    for (let i = 0; i < site.ops.length; i++) {
      const op = site.ops[i];
      const a = op.args;
      switch (op.op) {
        case "q":
          stack.push(cloneState(cur));
          if (stack.length > 256) stack.shift();
          break;
        case "Q":
          cur = stack.pop() ?? cur;
          break;
        case "cm":
          if (a.length >= 6) cur = { ...cur, ctm: compose([argNum(a[a.length - 6]), argNum(a[a.length - 5]), argNum(a[a.length - 4]), argNum(a[a.length - 3]), argNum(a[a.length - 2]), argNum(a[a.length - 1])], cur.ctm) };
          break;
        case "Tf":
          if (a.length >= 2 && a[a.length - 2].t === "name" && a[a.length - 1].t === "num") cur = { ...cur, text: { ...cur.text, fontName: (a[a.length - 2] as { v: string }).v, fontSize: argNum(a[a.length - 1]) } };
          break;
        case "Tc":
          if (a.length >= 1) cur = { ...cur, text: { ...cur.text, charSpacing: argNum(a[a.length - 1]) } };
          break;
        case "Tw":
          if (a.length >= 1) cur = { ...cur, text: { ...cur.text, wordSpacing: argNum(a[a.length - 1]) } };
          break;
        case "Tz":
          if (a.length >= 1) cur = { ...cur, text: { ...cur.text, hscale: argNum(a[a.length - 1], 100) / 100 } };
          break;
        case "Ts":
          if (a.length >= 1) cur = { ...cur, text: { ...cur.text, rise: argNum(a[a.length - 1]) } };
          break;
        case "Tr":
          if (a.length >= 1) cur = { ...cur, text: { ...cur.text, renderMode: argNum(a[a.length - 1]) } };
          break;
        case '"':
          if (isCountedTextOp(op, cur.text)) {
            cur = { ...cur, text: { ...cur.text, wordSpacing: argNum(a[a.length - 3]), charSpacing: argNum(a[a.length - 2]) } };
            result.texts.push({ ordinal: ordinal++, site, op, opIndex: i, state: cloneState(cur), font: fontDict(fdict, cur.text.fontName) });
          }
          break;
        case "Tj":
        case "TJ":
        case "'":
          if (isCountedTextOp(op, cur.text)) result.texts.push({ ordinal: ordinal++, site, op, opIndex: i, state: cloneState(cur), font: fontDict(fdict, cur.text.fontName) });
          break;
        case "Do": {
          const nameArg = a[a.length - 1];
          if (!xdict || nameArg?.t !== "name") break;
          const ref = xdict.get(PDFName.of(nameArg.v));
          const obj = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
          if (!(obj instanceof PDFStream)) break;
          const subtype = obj.dict.lookup(PDFName.of("Subtype"));
          const sub = subtype instanceof PDFName ? subtype.decodeText() : "";
          if (sub === "Image") {
            result.images.push({ name: nameArg.v, ref: ref instanceof PDFRef ? ref : null, stream: obj, ctm: cur.ctm });
            break;
          }
          if (sub !== "Form") break;
          const tag = ref instanceof PDFRef ? ref.tag : `direct-${nameArg.v}-${visiting.length}`;
          if (visiting.includes(tag) || visiting.length > 12) break;
          let inner = result.xobjects.get(tag);
          if (!inner) {
            const b = streamBytes(obj);
            const own = obj.dict.lookup(PDFName.of("Resources"));
            inner = { kind: "xobject", ref: ref instanceof PDFRef ? ref : null, stream: obj, bytes: b, ops: tokenizeContent(b), resources: own instanceof PDFDict ? own : null, uses: 0 };
            result.xobjects.set(tag, inner);
          }
          inner.uses++;
          const matrix = matrixOf(obj.dict, "Matrix");
          const entry: GState = { ctm: matrix ? compose(matrix, cur.ctm) : cur.ctm, text: { ...cur.text } };
          visiting.push(tag);
          walk(inner, inner.resources ?? resources, entry);
          visiting.pop();
          break;
        }
      }
    }
  };

  walk(pageSite, pageResources, { ctm: IDENTITY, text: initialText() });
  return result;
}

function fontDict(fonts: PDFDict | null, name: string | null): PDFDict | null {
  if (!fonts || !name) return null;
  const f = fonts.lookup(PDFName.of(name));
  return f instanceof PDFDict ? f : null;
}
