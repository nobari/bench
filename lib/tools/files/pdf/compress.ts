/**
 * Making a PDF smaller without changing what it says: pictures re-encoded as JPEG at a sensible resolution for the
 * size they are shown at, streams that were stored uncompressed deflated, objects nothing points at dropped, and
 * optionally metadata and page thumbnails removed. The picture work needs a canvas, which the worker supplies
 * through an `ImageCodec`; without one the pictures are left alone.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream } from "@cantoo/pdf-lib";
import { streamBytes, unpredict, walkPage } from "./walk";

export interface CompressOptions {
  images: {
    enabled: boolean;
    /** Pictures shown at more than this many pixels per inch are scaled down to it. */
    maxDpi: number;
    /** JPEG quality, 0–1. */
    quality: number;
    grayscale: boolean;
  };
  deflate: boolean;
  dropUnused: boolean;
  dropMetadata: boolean;
  dropThumbnails: boolean;
}

export const COMPRESS_PRESETS: Record<"light" | "balanced" | "strong", CompressOptions> = {
  light: { images: { enabled: false, maxDpi: 300, quality: 0.9, grayscale: false }, deflate: true, dropUnused: true, dropMetadata: false, dropThumbnails: true },
  balanced: { images: { enabled: true, maxDpi: 150, quality: 0.8, grayscale: false }, deflate: true, dropUnused: true, dropMetadata: false, dropThumbnails: true },
  strong: { images: { enabled: true, maxDpi: 96, quality: 0.6, grayscale: false }, deflate: true, dropUnused: true, dropMetadata: true, dropThumbnails: true },
};

export interface CompressReport {
  images: { recoded: number; skipped: number; before: number; after: number };
  deflated: number;
  dropped: number;
  notes: string[];
}

/** Decoded picture handed to the codec. */
export type DecodedImage = { kind: "jpeg"; bytes: Uint8Array } | { kind: "rgba"; data: Uint8ClampedArray; width: number; height: number };

export interface ImageCodec {
  /** Re-encode as JPEG at the target size (null when the platform cannot). */
  recode(image: DecodedImage, target: { width: number; height: number; quality: number; grayscale: boolean }): Promise<{ bytes: Uint8Array; width: number; height: number } | null>;
  /** The pixel size of a JPEG, when the codec can read it. */
  size?(jpeg: Uint8Array): Promise<{ width: number; height: number } | null>;
}

const name = (s: string) => PDFName.of(s);
const numOf = (d: PDFDict, key: string): number | null => {
  const v = d.lookup(name(key));
  return v instanceof PDFNumber ? v.asNumber() : null;
};

function filterNames(dict: PDFDict): string[] {
  const f = dict.lookup(name("Filter"));
  if (f instanceof PDFName) return [f.decodeText()];
  if (f instanceof PDFArray) return f.asArray().map((x) => (x instanceof PDFName ? x.decodeText() : "?"));
  return [];
}

/* ---------------------------------------------------------- colour */

interface ColorInfo {
  comps: number;
  kind: "gray" | "rgb" | "cmyk" | "indexed" | "other";
  /** For indexed: the base colour kind and the lookup table. */
  base?: "gray" | "rgb" | "cmyk";
  lookup?: Uint8Array;
  hival?: number;
}

function colorInfo(doc: PDFDocument, cs: unknown): ColorInfo {
  const obj = cs instanceof PDFRef ? doc.context.lookup(cs) : cs;
  if (obj instanceof PDFName) {
    const n = obj.decodeText();
    if (n === "DeviceGray" || n === "G" || n === "CalGray") return { comps: 1, kind: "gray" };
    if (n === "DeviceRGB" || n === "RGB" || n === "CalRGB") return { comps: 3, kind: "rgb" };
    if (n === "DeviceCMYK" || n === "CMYK") return { comps: 4, kind: "cmyk" };
    return { comps: 1, kind: "other" };
  }
  if (obj instanceof PDFArray && obj.size()) {
    const fam = obj.lookup(0);
    const f = fam instanceof PDFName ? fam.decodeText() : "";
    if (f === "ICCBased") {
      const s = obj.lookup(1);
      const n = s instanceof PDFStream ? numOf(s.dict, "N") : null;
      return n === 1 ? { comps: 1, kind: "gray" } : n === 4 ? { comps: 4, kind: "cmyk" } : n === 3 ? { comps: 3, kind: "rgb" } : { comps: 1, kind: "other" };
    }
    if (f === "CalRGB" || f === "Lab") return { comps: 3, kind: f === "CalRGB" ? "rgb" : "other" };
    if (f === "CalGray") return { comps: 1, kind: "gray" };
    if (f === "Indexed" || f === "I") {
      const base = colorInfo(doc, obj.get(1));
      const hival = obj.lookup(2);
      const lookupObj = obj.lookup(3);
      let lookup: Uint8Array | null = null;
      if (lookupObj instanceof PDFStream) lookup = streamBytes(lookupObj);
      else if (lookupObj && "asBytes" in (lookupObj as object)) lookup = (lookupObj as unknown as { asBytes(): Uint8Array }).asBytes();
      if (!lookup || base.kind === "other" || base.kind === "indexed") return { comps: 1, kind: "other" };
      return { comps: 1, kind: "indexed", base: base.kind, lookup, hival: hival instanceof PDFNumber ? hival.asNumber() : 255 };
    }
  }
  return { comps: 1, kind: "other" };
}

/** Raw 8-bit samples → RGBA. */
function toRgba(samples: Uint8Array, width: number, height: number, info: ColorInfo, decodeInverted: boolean): Uint8ClampedArray | null {
  const n = width * height;
  const out = new Uint8ClampedArray(n * 4);
  const inv = (v: number) => (decodeInverted ? 255 - v : v);
  if (info.kind === "rgb") {
    if (samples.length < n * 3) return null;
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      out[i * 4] = inv(samples[j]);
      out[i * 4 + 1] = inv(samples[j + 1]);
      out[i * 4 + 2] = inv(samples[j + 2]);
      out[i * 4 + 3] = 255;
    }
    return out;
  }
  if (info.kind === "gray") {
    if (samples.length < n) return null;
    for (let i = 0; i < n; i++) {
      const v = inv(samples[i]);
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
      out[i * 4 + 3] = 255;
    }
    return out;
  }
  if (info.kind === "cmyk") {
    if (samples.length < n * 4) return null;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const c = inv(samples[j]) / 255, m = inv(samples[j + 1]) / 255, y = inv(samples[j + 2]) / 255, k = inv(samples[j + 3]) / 255;
      out[i * 4] = 255 * (1 - c) * (1 - k);
      out[i * 4 + 1] = 255 * (1 - m) * (1 - k);
      out[i * 4 + 2] = 255 * (1 - y) * (1 - k);
      out[i * 4 + 3] = 255;
    }
    return out;
  }
  if (info.kind === "indexed" && info.lookup && info.base) {
    if (samples.length < n) return null;
    const bc = info.base === "rgb" ? 3 : info.base === "cmyk" ? 4 : 1;
    const lut = info.lookup;
    for (let i = 0; i < n; i++) {
      const idx = Math.min(samples[i], info.hival ?? 255);
      const o = idx * bc;
      let r: number, g: number, b: number;
      if (bc === 3) [r, g, b] = [lut[o], lut[o + 1], lut[o + 2]];
      else if (bc === 1) r = g = b = lut[o];
      else {
        const c = lut[o] / 255, m = lut[o + 1] / 255, y = lut[o + 2] / 255, k = lut[o + 3] / 255;
        r = 255 * (1 - c) * (1 - k);
        g = 255 * (1 - m) * (1 - k);
        b = 255 * (1 - y) * (1 - k);
      }
      out[i * 4] = r ?? 0;
      out[i * 4 + 1] = g ?? 0;
      out[i * 4 + 2] = b ?? 0;
      out[i * 4 + 3] = 255;
    }
    return out;
  }
  return null;
}

/** Unpacks 1-, 2- or 4-bit samples to one byte each (scaled to 0–255 for gray, raw indices for indexed). */
function unpackBits(data: Uint8Array, width: number, height: number, comps: number, bpc: number, scale: boolean): Uint8Array {
  const perRow = Math.ceil((width * comps * bpc) / 8);
  const out = new Uint8Array(width * height * comps);
  const max = (1 << bpc) - 1;
  for (let y = 0; y < height; y++) {
    let bit = 0;
    const row = y * perRow;
    for (let x = 0; x < width * comps; x++) {
      const byte = data[row + (bit >> 3)] ?? 0;
      const shift = 8 - bpc - (bit & 7);
      const v = (byte >> shift) & max;
      out[y * width * comps + x] = scale ? Math.round((v * 255) / max) : v;
      bit += bpc;
    }
  }
  return out;
}

/* ------------------------------------------------------------ images */

interface Candidate {
  ref: PDFRef;
  stream: PDFRawStream;
  width: number;
  height: number;
  bytes: number;
  /** The largest size it is drawn at, in points (null when it is not drawn by page content). */
  shownW: number | null;
  shownH: number | null;
}

/** Image XObjects worth looking at, with how large each is shown. */
export function imageCandidates(doc: PDFDocument): Candidate[] {
  const shown = new Map<string, { w: number; h: number }>();
  for (let p = 0; p < doc.getPageCount(); p++) {
    try {
      for (const img of walkPage(doc, p).images) {
        if (!img.ref) continue;
        const w = Math.hypot(img.ctm[0], img.ctm[1]), h = Math.hypot(img.ctm[2], img.ctm[3]);
        const cur = shown.get(img.ref.tag);
        if (!cur || w * h > cur.w * cur.h) shown.set(img.ref.tag, { w, h });
      }
    } catch {
      /* a page that cannot be walked keeps its pictures */
    }
  }
  const out: Candidate[] = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const sub = obj.dict.lookup(name("Subtype"));
    if (!(sub instanceof PDFName) || sub.decodeText() !== "Image") continue;
    const width = numOf(obj.dict, "Width") ?? 0, height = numOf(obj.dict, "Height") ?? 0;
    if (width < 8 || height < 8) continue;
    const s = shown.get(ref.tag);
    out.push({ ref, stream: obj, width, height, bytes: obj.contents.length, shownW: s?.w ?? null, shownH: s?.h ?? null });
  }
  return out;
}

async function decodeImage(doc: PDFDocument, c: Candidate): Promise<DecodedImage | null> {
  const dict = c.stream.dict;
  const filters = filterNames(dict);
  const mask = dict.lookup(name("ImageMask"));
  if (mask && "asBoolean" in (mask as object) && (mask as unknown as { asBoolean(): boolean }).asBoolean()) return null;
  const decodeArr = dict.lookup(name("Decode"));
  const decodeInverted = decodeArr instanceof PDFArray && decodeArr.size() >= 2 && (decodeArr.lookup(0) as PDFNumber)?.asNumber?.() === 1;
  const last = filters[filters.length - 1];
  if (last === "DCTDecode") {
    if (filters.length === 1) return decodeInverted ? null : { kind: "jpeg", bytes: c.stream.contents };
    return null;
  }
  if (last === "JPXDecode" || last === "JBIG2Decode" || last === "CCITTFaxDecode") return null;
  const bpc = numOf(dict, "BitsPerComponent") ?? 8;
  const info = colorInfo(doc, dict.get(name("ColorSpace")));
  if (info.kind === "other") return null;
  if (![1, 2, 4, 8].includes(bpc)) return null;
  let samples: Uint8Array;
  try {
    samples = filters.length ? decodePDFRawStream(c.stream).decode() : c.stream.contents;
    const parms = dict.lookup(name("DecodeParms"));
    const p = parms instanceof PDFDict ? parms : parms instanceof PDFArray ? parms.lookup(parms.size() - 1) : null;
    if (p instanceof PDFDict) samples = unpredict(samples, p);
  } catch {
    return null;
  }
  if (bpc !== 8) {
    if (info.kind === "indexed") samples = unpackBits(samples, c.width, c.height, 1, bpc, false);
    else if (info.kind === "gray") samples = unpackBits(samples, c.width, c.height, 1, bpc, true);
    else return null;
  }
  const rgba = toRgba(samples, c.width, c.height, info, decodeInverted && info.kind !== "indexed");
  return rgba ? { kind: "rgba", data: rgba, width: c.width, height: c.height } : null;
}

/* ------------------------------------------------------------- passes */

/** Which objects the document reaches from its trailer. */
function reachable(doc: PDFDocument): Set<string> {
  const seen = new Set<string>();
  const stack: unknown[] = [];
  const t = doc.context.trailerInfo;
  for (const v of [t.Root, t.Info, t.Encrypt, t.ID]) if (v) stack.push(v);
  while (stack.length) {
    const v = stack.pop();
    if (v instanceof PDFRef) {
      if (seen.has(v.tag)) continue;
      seen.add(v.tag);
      const obj = doc.context.lookup(v);
      if (obj) stack.push(obj);
    } else if (v instanceof PDFStream) stack.push(v.dict);
    else if (v instanceof PDFDict) for (const [, val] of v.entries()) stack.push(val);
    else if (v instanceof PDFArray) for (const x of v.asArray()) stack.push(x);
  }
  return seen;
}

export function dropUnusedObjects(doc: PDFDocument): number {
  const keep = reachable(doc);
  let n = 0;
  for (const [ref] of doc.context.enumerateIndirectObjects()) {
    if (keep.has(ref.tag)) continue;
    doc.context.delete(ref);
    n++;
  }
  return n;
}

const NO_DEFLATE = new Set(["Image", "XRef", "ObjStm"]);

export function deflateStreams(doc: PDFDocument): number {
  let n = 0;
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (obj.dict.has(name("Filter")) || obj.contents.length < 64) continue;
    const sub = obj.dict.lookup(name("Subtype"));
    const type = obj.dict.lookup(name("Type"));
    if ((sub instanceof PDFName && NO_DEFLATE.has(sub.decodeText())) || (type instanceof PDFName && NO_DEFLATE.has(type.decodeText()))) continue;
    const s = doc.context.flateStream(obj.contents);
    for (const [k, v] of obj.dict.entries()) if (k.decodeText() !== "Length") s.dict.set(k, v);
    if (s.contents.length >= obj.contents.length) continue;
    doc.context.assign(ref, s);
    n++;
  }
  return n;
}

export function dropMetadata(doc: PDFDocument): void {
  doc.catalog.delete(name("Metadata"));
  doc.catalog.delete(name("PieceInfo"));
  const info = doc.context.trailerInfo.Info;
  const dict = info instanceof PDFRef ? doc.context.lookup(info) : info;
  if (dict instanceof PDFDict) {
    for (const k of dict.keys()) if (k.decodeText() !== "Title") dict.delete(k);
  }
  for (const page of doc.getPages()) {
    page.node.delete(name("Metadata"));
    page.node.delete(name("PieceInfo"));
  }
}

export function dropThumbnails(doc: PDFDocument): number {
  let n = 0;
  for (const page of doc.getPages()) {
    if (page.node.has(name("Thumb"))) {
      page.node.delete(name("Thumb"));
      n++;
    }
  }
  return n;
}

export async function recodeImages(doc: PDFDocument, codec: ImageCodec, opts: CompressOptions["images"]): Promise<CompressReport["images"]> {
  const report = { recoded: 0, skipped: 0, before: 0, after: 0 };
  for (const c of imageCandidates(doc)) {
    report.before += c.bytes;
    let after = c.bytes;
    try {
      const decoded = await decodeImage(doc, c);
      if (!decoded) throw new Error("undecodable");
      // Target size from how large it is shown.
      let tw = c.width, th = c.height;
      if (c.shownW && c.shownH) {
        const dpi = Math.max((c.width * 72) / Math.max(1, c.shownW), (c.height * 72) / Math.max(1, c.shownH));
        if (dpi > opts.maxDpi) {
          const s = opts.maxDpi / dpi;
          tw = Math.max(1, Math.round(c.width * s));
          th = Math.max(1, Math.round(c.height * s));
        }
      } else if (Math.max(c.width, c.height) > 2500) {
        const s = 2500 / Math.max(c.width, c.height);
        tw = Math.round(c.width * s);
        th = Math.round(c.height * s);
      }
      const same = tw === c.width && th === c.height;
      // A JPEG kept at its size and quality would only grow: skip unless it shrinks or goes grey.
      if (decoded.kind === "jpeg" && same && !opts.grayscale && opts.quality >= 0.85) throw new Error("already small");
      const out = await codec.recode(decoded, { width: tw, height: th, quality: opts.quality, grayscale: opts.grayscale });
      if (!out || out.bytes.length >= c.bytes * 0.9) throw new Error("no gain");
      const dict = doc.context.obj({});
      for (const [k, v] of c.stream.dict.entries()) {
        const key = k.decodeText();
        if (["Filter", "DecodeParms", "Length", "ColorSpace", "BitsPerComponent", "Width", "Height", "Decode", "Intent"].includes(key)) continue;
        dict.set(k, v);
      }
      dict.set(name("Filter"), name("DCTDecode"));
      dict.set(name("ColorSpace"), name("DeviceRGB"));
      dict.set(name("BitsPerComponent"), PDFNumber.of(8));
      dict.set(name("Width"), PDFNumber.of(out.width));
      dict.set(name("Height"), PDFNumber.of(out.height));
      doc.context.assign(c.ref, PDFRawStream.of(dict, out.bytes));
      after = out.bytes.length;
      report.recoded++;
    } catch {
      report.skipped++;
    }
    report.after += after;
  }
  return report;
}

export async function compressDocument(doc: PDFDocument, opts: CompressOptions, codec: ImageCodec | null): Promise<CompressReport> {
  const report: CompressReport = { images: { recoded: 0, skipped: 0, before: 0, after: 0 }, deflated: 0, dropped: 0, notes: [] };
  if (opts.images.enabled) {
    if (codec) report.images = await recodeImages(doc, codec, opts.images);
    else report.notes.push("Pictures were left as they are (no image codec here).");
  }
  if (opts.dropThumbnails) dropThumbnails(doc);
  if (opts.dropMetadata) dropMetadata(doc);
  if (opts.deflate) report.deflated = deflateStreams(doc);
  if (opts.dropUnused) report.dropped = dropUnusedObjects(doc);
  return report;
}

/** Sums the raw sizes of a document's streams, a rough measure for a before/after line. */
export function streamTotal(doc: PDFDocument): number {
  let n = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) if (obj instanceof PDFRawStream) n += obj.contents.length;
  return n;
}
