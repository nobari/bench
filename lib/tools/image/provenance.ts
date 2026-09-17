/**
 * Provenance inspection, framework-free:
 *  - locate a C2PA manifest store inside JPEG / PNG / WebP / GIF / MP4-HEIF /
 *    WAV-AVI / TIFF / MP3 / SVG containers (and report where it lives),
 *  - parse JUMBF boxes, CBOR, COSE_Sign1 and X.509 for a transparent raw view,
 *  - extract EXIF / XMP / IPTC / text-chunk metadata,
 *  - derive "was this made or edited with AI?" signals from all of the above,
 *  - build a padded COSE_Sign1 for the in-browser demo signer.
 *
 * Cryptographic validation of manifests is done by the official c2pa-web SDK
 * in the widget; everything here is deterministic and unit-testable.
 */

/* ------------------------------------------------------------- byte utils */

const td = new TextDecoder();
const tdLatin = new TextDecoder("latin1");
const te = new TextEncoder();

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u32le = (b: Uint8Array, o: number) => ((b[o + 3] << 24) | (b[o + 2] << 16) | (b[o + 1] << 8) | b[o]) >>> 0;
const u64be = (b: Uint8Array, o: number) => u32be(b, o) * 0x100000000 + u32be(b, o + 4);
const ascii = (b: Uint8Array, o: number, n: number) => tdLatin.decode(b.subarray(o, o + n));
const startsWith = (b: Uint8Array, sig: number[] | string, o = 0) => {
  const s = typeof sig === "string" ? [...sig].map((c) => c.charCodeAt(0)) : sig;
  return b.length >= o + s.length && s.every((v, i) => b[o + i] === v);
};

export function hex(bytes: Uint8Array, max = Infinity): string {
  let s = "";
  const n = Math.min(bytes.length, max);
  for (let i = 0; i < n; i++) s += bytes[i].toString(16).padStart(2, "0");
  return n < bytes.length ? `${s}…` : s;
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  return btoa(s);
}

async function inflate(data: Uint8Array, format: "deflate" | "deflate-raw"): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === "undefined") return null;
  try {
    const ds = new DecompressionStream(format);
    const w = ds.writable.getWriter();
    void w.write(data as BufferSource);
    void w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  } catch {
    return null;
  }
}

/* ------------------------------------------------------- container scan */

export type Container = "jpeg" | "png" | "webp" | "gif" | "bmff" | "riff" | "tiff" | "mp3" | "svg" | "pdf" | "unknown";

export interface Segment {
  offset: number;
  length: number;
  note: string;
}

export interface TextEntry {
  key: string;
  value: string;
  where: string;
}

export interface RawMetadata {
  /** TIFF-structured EXIF payload (starts with II/MM). */
  exif: Uint8Array | null;
  xmp: string | null;
  /** IPTC-IIM datasets (from a Photoshop APP13 resource). */
  iptc: Uint8Array | null;
  text: TextEntry[];
}

export interface Located {
  container: Container;
  /** Human label, e.g. "JPEG · APP11 JUMBF segments". */
  label: string;
  mime: string;
  jumbf: Uint8Array | null;
  segments: Segment[];
  remoteUrl: string | null;
  metadata: RawMetadata;
  notes: string[];
}

export const BMFF_C2PA_UUID = "d8fec3d61b0e483c92975828877ec481";

const XMP_SIG = "http://ns.adobe.com/xap/1.0/\0";
const XMP_EXT_SIG = "http://ns.adobe.com/xmp/extension/\0";

function emptyMeta(): RawMetadata {
  return { exif: null, xmp: null, iptc: null, text: [] };
}

/** Find the manifest store and the descriptive metadata in a file. */
export async function scanFile(bytes: Uint8Array): Promise<Located> {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return scanJpeg(bytes);
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return scanPng(bytes);
  if (startsWith(bytes, "RIFF") && bytes.length >= 12) return scanRiff(bytes);
  if (startsWith(bytes, "GIF8")) return scanGif(bytes);
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") return scanBmff(bytes);
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return scanTiff(bytes);
  if (startsWith(bytes, "ID3") || startsWith(bytes, [0xff, 0xfb]) || startsWith(bytes, [0xff, 0xf3])) return scanMp3(bytes);
  if (startsWith(bytes, "%PDF")) {
    return {
      container: "pdf",
      label: "PDF",
      mime: "application/pdf",
      jumbf: null,
      segments: [],
      remoteUrl: null,
      metadata: emptyMeta(),
      notes: ["PDF manifests live in an embedded-file attachment; the structural scan doesn't unpack PDF objects, so only the SDK result is shown."],
    };
  }
  const head = tdLatin.decode(bytes.subarray(0, Math.min(bytes.length, 2048))).replace(/^﻿/, "").trimStart();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return scanSvg(bytes);
  return { container: "unknown", label: "Unrecognised container", mime: "application/octet-stream", jumbf: null, segments: [], remoteUrl: null, metadata: emptyMeta(), notes: [] };
}

function scanJpeg(bytes: Uint8Array): Located {
  const meta = emptyMeta();
  const segments: Segment[] = [];
  const parts: Uint8Array[] = [];
  const xmpExt: { offset: number; data: Uint8Array }[] = [];
  let en = -1;
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) {
      pos++;
      continue;
    }
    const marker = bytes[pos + 1];
    if (marker === 0xff) {
      pos++;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // EOI / SOS: entropy-coded data follows
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      pos += 2;
      continue;
    }
    const len = u16be(bytes, pos + 2);
    const seg = bytes.subarray(pos + 4, pos + 2 + len);
    if (marker === 0xe1) {
      if (startsWith(seg, "Exif\0\0")) meta.exif = seg.subarray(6);
      else if (startsWith(seg, XMP_SIG)) meta.xmp = td.decode(seg.subarray(XMP_SIG.length));
      else if (startsWith(seg, XMP_EXT_SIG)) xmpExt.push({ offset: u32be(seg, XMP_EXT_SIG.length + 36), data: seg.subarray(XMP_EXT_SIG.length + 40) });
    } else if (marker === 0xeb && seg.length > 16 && ascii(seg, 0, 2) === "JP") {
      const thisEn = u16be(seg, 2);
      if (en >= 0 && thisEn === en) {
        // Continuation packets repeat the superbox's LBox/TBox after the 8-byte JP/En/Z header.
        parts.push(seg.subarray(16));
        segments.push({ offset: pos, length: len + 2, note: `APP11 continuation (sequence ${u32be(seg, 4)})` });
      } else if (en < 0 && seg.length >= 28 && ascii(seg, 12, 4) === "jumb" && ascii(seg, 24, 4) === "c2pa") {
        en = thisEn;
        parts.push(seg.subarray(8));
        segments.push({ offset: pos, length: len + 2, note: `APP11 JUMBF start (box instance ${thisEn})` });
      }
    } else if (marker === 0xed && startsWith(seg, "Photoshop 3.0\0")) {
      meta.iptc = readPhotoshopIptc(seg.subarray(14)) ?? meta.iptc;
    } else if (marker === 0xfe) {
      meta.text.push({ key: "Comment", value: td.decode(seg).replace(/\0+$/, ""), where: "JPEG COM segment" });
    }
    pos += 2 + len;
  }
  if (xmpExt.length && meta.xmp) {
    xmpExt.sort((a, b) => a.offset - b.offset);
    meta.xmp += td.decode(concat(xmpExt.map((x) => x.data)));
  }
  return finish("jpeg", "JPEG · APP11 JUMBF segments", "image/jpeg", parts, segments, meta);
}

function readPhotoshopIptc(b: Uint8Array): Uint8Array | null {
  let p = 0;
  while (p + 12 <= b.length) {
    if (ascii(b, p, 4) !== "8BIM") break;
    const id = u16be(b, p + 4);
    const nameLen = b[p + 6];
    let q = p + 7 + nameLen;
    if ((nameLen + 1) % 2) q++;
    const size = u32be(b, q);
    q += 4;
    if (id === 0x0404) return b.subarray(q, q + size);
    p = q + size + (size % 2);
  }
  return null;
}

async function scanPng(bytes: Uint8Array): Promise<Located> {
  const meta = emptyMeta();
  const segments: Segment[] = [];
  const parts: Uint8Array[] = [];
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const len = u32be(bytes, pos);
    const type = ascii(bytes, pos + 4, 4);
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === "caBX") {
      parts.push(data);
      segments.push({ offset: pos, length: len + 12, note: "caBX chunk" });
    } else if (type === "eXIf") meta.exif = data;
    else if (type === "tEXt") {
      const z = data.indexOf(0);
      meta.text.push({ key: tdLatin.decode(data.subarray(0, z)), value: tdLatin.decode(data.subarray(z + 1)), where: "PNG tEXt chunk" });
    } else if (type === "zTXt") {
      const z = data.indexOf(0);
      const inflated = await inflate(data.subarray(z + 2), "deflate");
      meta.text.push({ key: tdLatin.decode(data.subarray(0, z)), value: inflated ? tdLatin.decode(inflated) : "(compressed)", where: "PNG zTXt chunk" });
    } else if (type === "iTXt") {
      const z = data.indexOf(0);
      const key = tdLatin.decode(data.subarray(0, z));
      const compressed = data[z + 1] === 1;
      let q = z + 3;
      q = data.indexOf(0, q) + 1; // language tag
      q = data.indexOf(0, q) + 1; // translated keyword
      const body = data.subarray(q);
      const text = compressed ? ((await inflate(body, "deflate")) ?? null) : body;
      const value = text ? td.decode(text) : "(compressed)";
      if (key === "XML:com.adobe.xmp") meta.xmp = value;
      else meta.text.push({ key, value, where: "PNG iTXt chunk" });
    } else if (type === "IEND") break;
    pos += 12 + len;
  }
  return finish("png", "PNG · caBX chunk", "image/png", parts, segments, meta);
}

function scanRiff(bytes: Uint8Array): Located {
  const form = ascii(bytes, 8, 4);
  const meta = emptyMeta();
  const segments: Segment[] = [];
  const parts: Uint8Array[] = [];
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const id = ascii(bytes, pos, 4);
    const len = u32le(bytes, pos + 4);
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (id === "C2PA") {
      parts.push(data);
      segments.push({ offset: pos, length: len + 8, note: "C2PA chunk" });
    } else if (id === "EXIF") meta.exif = startsWith(data, "Exif\0\0") ? data.subarray(6) : data;
    else if (id === "XMP ") meta.xmp = td.decode(data);
    pos += 8 + len + (len % 2);
  }
  const isWebp = form === "WEBP";
  const mime = isWebp ? "image/webp" : form === "WAVE" ? "audio/wav" : form === "AVI " ? "video/avi" : "application/octet-stream";
  return finish(isWebp ? "webp" : "riff", `${isWebp ? "WebP" : form.trim()} · RIFF C2PA chunk`, mime, parts, segments, meta);
}

function scanGif(bytes: Uint8Array): Located {
  const meta = emptyMeta();
  const segments: Segment[] = [];
  const parts: Uint8Array[] = [];
  let pos = 13;
  const flags = bytes[10];
  if (flags & 0x80) pos += 3 * (1 << ((flags & 7) + 1));
  const subBlocks = (p: number): { data: Uint8Array; end: number } => {
    const chunks: Uint8Array[] = [];
    while (p < bytes.length && bytes[p] !== 0) {
      chunks.push(bytes.subarray(p + 1, p + 1 + bytes[p]));
      p += 1 + bytes[p];
    }
    return { data: concat(chunks), end: p + 1 };
  };
  while (pos < bytes.length) {
    const b = bytes[pos];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = bytes[pos + 1];
      if (label === 0xff && bytes[pos + 2] === 11) {
        const ident = ascii(bytes, pos + 3, 8);
        const { data, end } = subBlocks(pos + 14);
        if (ident === "C2PA_GIF") {
          parts.push(data);
          segments.push({ offset: pos, length: end - pos, note: "Application extension C2PA_GIF" });
        } else if (ident === "XMP Data") {
          const s = td.decode(data);
          meta.xmp = s.slice(0, s.indexOf("</x:xmpmeta>") + 12);
        }
        pos = end;
      } else if (label === 0xfe) {
        const { data, end } = subBlocks(pos + 2);
        meta.text.push({ key: "Comment", value: tdLatin.decode(data), where: "GIF comment extension" });
        pos = end;
      } else {
        pos = subBlocks(pos + 2).end;
      }
    } else if (b === 0x2c) {
      const lf = bytes[pos + 9];
      let p = pos + 10;
      if (lf & 0x80) p += 3 * (1 << ((lf & 7) + 1));
      pos = subBlocks(p + 1).end;
    } else break;
  }
  return finish("gif", "GIF · C2PA_GIF application extension", "image/gif", parts, segments, meta);
}

function scanBmff(bytes: Uint8Array): Located {
  const brand = ascii(bytes, 8, 4);
  const meta = emptyMeta();
  const segments: Segment[] = [];
  const parts: Uint8Array[] = [];
  const notes: string[] = [];
  let pos = 0;
  while (pos + 8 <= bytes.length) {
    let size = u32be(bytes, pos);
    const type = ascii(bytes, pos + 4, 4);
    let hdr = 8;
    if (size === 1) {
      size = u64be(bytes, pos + 8);
      hdr = 16;
    } else if (size === 0) size = bytes.length - pos;
    if (type === "uuid" && hex(bytes.subarray(pos + hdr, pos + hdr + 16)) === BMFF_C2PA_UUID) {
      let p = pos + hdr + 16 + 4; // version + flags
      const z = bytes.indexOf(0, p);
      const purpose = ascii(bytes, p, z - p);
      p = z + 1;
      if (purpose === "manifest") p += 8; // merkle_offset (u64) precedes the manifest store
      parts.push(bytes.subarray(p, pos + size));
      segments.push({ offset: pos, length: size, note: `uuid box (purpose "${purpose}")` });
    }
    if (size < 8) break;
    pos += size;
  }
  const brands: Record<string, string> = { avif: "image/avif", avis: "image/avif", heic: "image/heic", heix: "image/heic", mif1: "image/heif", isom: "video/mp4", mp42: "video/mp4", mp41: "video/mp4", qt: "video/quicktime", M4A: "audio/mp4" };
  const mime = brands[brand.trim()] ?? "video/mp4";
  return finish("bmff", `ISO BMFF (${brand.trim()}) · C2PA uuid box`, mime, parts, segments, meta, notes);
}

function scanTiff(bytes: Uint8Array): Located {
  const meta = emptyMeta();
  meta.exif = bytes;
  const segments: Segment[] = [];
  const parts: Uint8Array[] = [];
  const le = bytes[0] === 0x49;
  const rd32 = (o: number) => (le ? u32le(bytes, o) : u32be(bytes, o));
  const rd16 = (o: number) => (le ? bytes[o] | (bytes[o + 1] << 8) : u16be(bytes, o));
  const ifd = rd32(4);
  if (ifd + 2 <= bytes.length) {
    const n = rd16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > bytes.length) break;
      const tag = rd16(e), count = rd32(e + 4);
      const off = count <= 4 ? e + 8 : rd32(e + 8);
      if (tag === 0xcd41) {
        parts.push(bytes.subarray(off, off + count));
        segments.push({ offset: off, length: count, note: "IFD0 tag 0xCD41" });
      } else if (tag === 0x02bc) meta.xmp = td.decode(bytes.subarray(off, off + count));
    }
  }
  return finish("tiff", "TIFF/DNG · IFD0 tag 0xCD41", "image/tiff", parts, segments, meta);
}

function scanMp3(bytes: Uint8Array): Located {
  const meta = emptyMeta();
  const segments: Segment[] = [];
  const parts: Uint8Array[] = [];
  if (startsWith(bytes, "ID3")) {
    const ver = bytes[3];
    const syncsafe = (o: number) => (bytes[o] << 21) | (bytes[o + 1] << 14) | (bytes[o + 2] << 7) | bytes[o + 3];
    const tagEnd = 10 + syncsafe(6);
    let pos = 10;
    while (pos + 10 <= tagEnd && bytes[pos] !== 0) {
      const id = ascii(bytes, pos, 4);
      const size = ver === 4 ? syncsafe(pos + 4) : u32be(bytes, pos + 4);
      const body = bytes.subarray(pos + 10, pos + 10 + size);
      if (id === "GEOB") {
        const enc = body[0];
        let p = body.indexOf(0, 1);
        const mime = tdLatin.decode(body.subarray(1, p));
        p++;
        const wide = enc === 1 || enc === 2;
        const skipStr = (q: number) => {
          if (wide) {
            while (q + 1 < body.length && (body[q] !== 0 || body[q + 1] !== 0)) q += 2;
            return q + 2;
          }
          return body.indexOf(0, q) + 1;
        };
        p = skipStr(p); // filename
        p = skipStr(p); // description
        const data = body.subarray(p);
        if (mime.includes("c2pa") || ascii(data, 4, 4) === "jumb") {
          parts.push(data);
          segments.push({ offset: pos, length: size + 10, note: `ID3 GEOB frame (${mime})` });
        }
      }
      pos += 10 + size;
    }
  }
  return finish("mp3", "MP3 · ID3v2 GEOB frame", "audio/mpeg", parts, segments, meta);
}

function scanSvg(bytes: Uint8Array): Located {
  const text = td.decode(bytes);
  const meta = emptyMeta();
  const segments: Segment[] = [];
  const parts: Uint8Array[] = [];
  const m = text.match(/<c2pa:manifest[^>]*>([\s\S]*?)<\/c2pa:manifest>/);
  if (m) {
    try {
      parts.push(base64ToBytes(m[1]));
      segments.push({ offset: m.index ?? 0, length: m[0].length, note: "<c2pa:manifest> element (base64)" });
    } catch {
      /* not base64 */
    }
  }
  const x = text.match(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/);
  if (x) meta.xmp = x[0];
  return finish("svg", "SVG · <c2pa:manifest> element", "image/svg+xml", parts, segments, meta);
}

function finish(container: Container, label: string, mime: string, parts: Uint8Array[], segments: Segment[], meta: RawMetadata, notes: string[] = []): Located {
  const jumbf = parts.length ? concat(parts) : null;
  const remote = meta.xmp ? xmpValues(meta.xmp, "dcterms:provenance")[0] ?? null : null;
  return { container, label, mime, jumbf, segments, remoteUrl: remote, metadata: meta, notes };
}

/* ------------------------------------------------------------------ JUMBF */

export interface JumbfBox {
  type: string;
  offset: number;
  length: number;
  /** Superbox description (from the jumd box). */
  uuid?: string;
  uuidName?: string;
  label?: string;
  id?: number;
  children?: JumbfBox[];
  /** Content of a leaf box (cbor / json / bfdb / bidb / uuid). */
  data?: Uint8Array;
}

const JUMBF_UUID_NAMES: Record<string, string> = {
  "63327061": "C2PA manifest store",
  "63326d61": "C2PA manifest",
  "63326173": "C2PA assertion store",
  "6332636c": "C2PA claim",
  "63326373": "C2PA claim signature",
  "63326364": "C2PA credentials store",
  "63326462": "C2PA databox store",
  "6a736f6e": "JSON content",
  "63626f72": "CBOR content",
  "40cb0c32": "Embedded file",
  "6579d6fb": "Codestream",
  "75756964": "UUID content",
};

export function parseJumbf(bytes: Uint8Array, base = 0, depth = 0): JumbfBox[] {
  const boxes: JumbfBox[] = [];
  let pos = 0;
  while (pos + 8 <= bytes.length && depth < 12) {
    let size = u32be(bytes, pos);
    const type = ascii(bytes, pos + 4, 4);
    let hdr = 8;
    if (size === 1) {
      size = u64be(bytes, pos + 8);
      hdr = 16;
    } else if (size === 0) size = bytes.length - pos;
    if (size < hdr || pos + size > bytes.length) break;
    const content = bytes.subarray(pos + hdr, pos + size);
    const box: JumbfBox = { type, offset: base + pos, length: size };
    if (type === "jumb") {
      const kids = parseJumbf(content, base + pos + hdr, depth + 1);
      const desc = kids.find((k) => k.type === "jumd");
      if (desc?.data) {
        const d = desc.data;
        const uuid = hex(d.subarray(0, 16));
        box.uuid = uuid;
        box.uuidName = JUMBF_UUID_NAMES[uuid.slice(0, 8)];
        const toggles = d[16];
        let p = 17;
        if (toggles & 2) {
          const z = d.indexOf(0, p);
          box.label = td.decode(d.subarray(p, z < 0 ? d.length : z));
          p = z + 1;
        }
        if (toggles & 4) {
          box.id = u32be(d, p);
        }
      }
      box.children = kids.filter((k) => k.type !== "jumd");
    } else {
      box.data = content;
    }
    boxes.push(box);
    pos += size;
  }
  return boxes;
}

/** Depth-first search for the first superbox whose label matches. */
export function findBox(boxes: JumbfBox[], pred: (b: JumbfBox) => boolean): JumbfBox | null {
  for (const b of boxes) {
    if (pred(b)) return b;
    if (b.children) {
      const r = findBox(b.children, pred);
      if (r) return r;
    }
  }
  return null;
}

/* ------------------------------------------------------------------- CBOR */

export type Cbor = null | boolean | number | bigint | string | Uint8Array | Cbor[] | { [k: string]: Cbor } | CborTag | CborUndefined;
export interface CborTag {
  tag: number;
  value: Cbor;
}
export interface CborUndefined {
  undefined: true;
}
export class CborMap {
  entries: [Cbor, Cbor][] = [];
}

export function decodeCbor(bytes: Uint8Array): { value: Cbor; length: number } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  const readLen = (info: number): number | bigint | null => {
    if (info < 24) return info;
    if (info === 24) return bytes[pos++];
    if (info === 25) {
      const v = dv.getUint16(pos);
      pos += 2;
      return v;
    }
    if (info === 26) {
      const v = dv.getUint32(pos);
      pos += 4;
      return v;
    }
    if (info === 27) {
      const v = dv.getBigUint64(pos);
      pos += 8;
      return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
    }
    if (info === 31) return null; // indefinite
    throw new Error("CBOR: bad additional info");
  };
  const item = (): Cbor => {
    if (pos >= bytes.length) throw new Error("CBOR: truncated");
    const ib = bytes[pos++];
    const major = ib >> 5, info = ib & 31;
    switch (major) {
      case 0:
        return readLen(info) as number | bigint;
      case 1: {
        const n = readLen(info) as number | bigint;
        return typeof n === "bigint" ? -1n - n : -1 - n;
      }
      case 2:
      case 3: {
        const n = readLen(info);
        if (n === null) {
          const chunks: Uint8Array[] = [];
          while (bytes[pos] !== 0xff) {
            const c = item();
            chunks.push(typeof c === "string" ? te.encode(c) : (c as Uint8Array));
          }
          pos++;
          const all = concat(chunks);
          return major === 2 ? all : td.decode(all);
        }
        const len = Number(n);
        const s = bytes.subarray(pos, pos + len);
        pos += len;
        return major === 2 ? s : td.decode(s);
      }
      case 4: {
        const n = readLen(info);
        const arr: Cbor[] = [];
        if (n === null) {
          while (bytes[pos] !== 0xff) arr.push(item());
          pos++;
        } else for (let i = 0; i < Number(n); i++) arr.push(item());
        return arr;
      }
      case 5: {
        const n = readLen(info);
        const obj: { [k: string]: Cbor } = {};
        const add = () => {
          const k = item();
          const v = item();
          obj[typeof k === "string" ? k : typeof k === "number" || typeof k === "bigint" ? String(k) : JSON.stringify(cborToJson(k))] = v;
        };
        if (n === null) {
          while (bytes[pos] !== 0xff) add();
          pos++;
        } else for (let i = 0; i < Number(n); i++) add();
        return obj;
      }
      case 6: {
        const tag = Number(readLen(info));
        return { tag, value: item() };
      }
      case 7: {
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 23) return { undefined: true };
        if (info === 25) {
          const v = halfToFloat(dv.getUint16(pos));
          pos += 2;
          return v;
        }
        if (info === 26) {
          const v = dv.getFloat32(pos);
          pos += 4;
          return v;
        }
        if (info === 27) {
          const v = dv.getFloat64(pos);
          pos += 8;
          return v;
        }
        if (info < 20 || info === 24) {
          if (info === 24) pos++;
          return null;
        }
        throw new Error("CBOR: bad simple value");
      }
    }
    throw new Error("CBOR: unreachable");
  };
  const value = item();
  return { value, length: pos };
}

function halfToFloat(h: number): number {
  const s = (h & 0x8000) >> 15, e = (h & 0x7c00) >> 10, f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 0x1f) return f ? NaN : (s ? -1 : 1) * Infinity;
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

/** JSON-friendly rendering: byte strings become `bytes[n] hex…`, tags are unwrapped with a marker. */
export function cborToJson(v: Cbor): unknown {
  if (v instanceof Uint8Array) return `bytes[${v.length}] ${hex(v, 24)}`;
  if (v === null || typeof v !== "object") return typeof v === "bigint" ? v.toString() : v;
  if (Array.isArray(v)) return v.map(cborToJson);
  if ("tag" in v && "value" in v && Object.keys(v).length === 2) return { [`$tag${v.tag}`]: cborToJson(v.value) };
  if ("undefined" in v) return null;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[k] = cborToJson(x as Cbor);
  return out;
}

/** Deterministic CBOR encoder for the signer (definite lengths, ints, bstr, tstr, arrays, maps, tags, null/bool). */
export function encodeCbor(v: unknown): Uint8Array {
  const out: number[] = [];
  const head = (major: number, n: number) => {
    const m = major << 5;
    if (n < 24) out.push(m | n);
    else if (n < 0x100) out.push(m | 24, n);
    else if (n < 0x10000) out.push(m | 25, n >> 8, n & 255);
    else if (n < 0x100000000) out.push(m | 26, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
    else {
      const hi = Math.floor(n / 0x100000000), lo = n >>> 0;
      out.push(m | 27, (hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
    }
  };
  const enc = (x: unknown) => {
    if (x === null || x === undefined) out.push(0xf6);
    else if (x === true) out.push(0xf5);
    else if (x === false) out.push(0xf4);
    else if (typeof x === "number") {
      if (!Number.isInteger(x)) throw new Error("CBOR encoder: floats unsupported");
      if (x >= 0) head(0, x);
      else head(1, -1 - x);
    } else if (typeof x === "string") {
      const b = te.encode(x);
      head(3, b.length);
      for (const c of b) out.push(c);
    } else if (x instanceof Uint8Array) {
      head(2, x.length);
      for (const c of x) out.push(c);
    } else if (Array.isArray(x)) {
      head(4, x.length);
      for (const e of x) enc(e);
    } else if (x instanceof CborMap) {
      head(5, x.entries.length);
      for (const [k, val] of x.entries) {
        enc(k);
        enc(val);
      }
    } else if (typeof x === "object" && "tag" in x && "value" in x) {
      head(6, (x as CborTag).tag);
      enc((x as CborTag).value);
    } else if (typeof x === "object") {
      const entries = Object.entries(x as Record<string, unknown>);
      head(5, entries.length);
      for (const [k, val] of entries) {
        enc(k);
        enc(val);
      }
    } else throw new Error(`CBOR encoder: unsupported ${typeof x}`);
  };
  enc(v);
  return new Uint8Array(out);
}

/* ------------------------------------------------------------------- COSE */

export const COSE_ALGS: Record<number, string> = { [-7]: "ES256", [-35]: "ES384", [-36]: "ES512", [-37]: "PS256", [-38]: "PS384", [-39]: "PS512", [-8]: "EdDSA", [-257]: "RS256", [-258]: "RS384", [-259]: "RS512" };

export interface CoseSign1 {
  alg: string;
  protectedHeaders: Record<string, unknown>;
  unprotectedHeaders: Record<string, unknown>;
  certificates: Uint8Array[];
  signature: Uint8Array;
  hasTimestamp: boolean;
  padBytes: number;
  detachedPayload: boolean;
}

export function parseCoseSign1(bytes: Uint8Array): CoseSign1 {
  let { value } = decodeCbor(bytes);
  if (value && typeof value === "object" && "tag" in value) value = (value as CborTag).value;
  if (!Array.isArray(value) || value.length !== 4) throw new Error("Not a COSE_Sign1 structure");
  const [prot, unprot, payload, sig] = value;
  const protMap = prot instanceof Uint8Array && prot.length ? (decodeCbor(prot).value as Record<string, Cbor>) : {};
  const unprotMap = (unprot && typeof unprot === "object" && !Array.isArray(unprot) ? unprot : {}) as Record<string, Cbor>;
  const algNum = Number(protMap["1"] ?? unprotMap["1"]);
  // x5chain is label 33 in the protected header (C2PA 2.x); older writers used the text label, often unprotected.
  const chain = protMap["33"] ?? protMap["x5chain"] ?? unprotMap["33"] ?? unprotMap["x5chain"];
  const certificates = chain instanceof Uint8Array ? [chain] : Array.isArray(chain) ? (chain.filter((c) => c instanceof Uint8Array) as Uint8Array[]) : [];
  const pad = unprotMap["pad"];
  return {
    alg: COSE_ALGS[algNum] ?? `alg ${algNum}`,
    protectedHeaders: cborToJson(protMap) as Record<string, unknown>,
    unprotectedHeaders: cborToJson(unprotMap) as Record<string, unknown>,
    certificates,
    signature: sig instanceof Uint8Array ? sig : new Uint8Array(),
    hasTimestamp: "sigTst" in unprotMap || "sigTst2" in unprotMap,
    padBytes: pad instanceof Uint8Array ? pad.length : 0,
    detachedPayload: payload === null,
  };
}

/* ------------------------------------------------------------------ X.509 */

interface Der {
  tag: number;
  start: number;
  end: number;
  hdr: number;
}

function derRead(b: Uint8Array, pos: number): Der {
  const tag = b[pos];
  let len = b[pos + 1];
  let hdr = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[pos + 2 + i];
    hdr = 2 + n;
  }
  return { tag, start: pos + hdr, end: pos + hdr + len, hdr };
}

function derChildren(b: Uint8Array, node: Der): Der[] {
  const out: Der[] = [];
  let p = node.start;
  while (p < node.end) {
    const c = derRead(b, p);
    out.push(c);
    p = c.end;
  }
  return out;
}

function derOid(b: Uint8Array, node: Der): string {
  const parts: number[] = [];
  let v = 0;
  for (let i = node.start; i < node.end; i++) {
    v = v * 128 + (b[i] & 0x7f);
    if (!(b[i] & 0x80)) {
      if (!parts.length) parts.push(Math.floor(v / 40), v % 40);
      else parts.push(v);
      v = 0;
    }
  }
  return parts.join(".");
}

const OID_NAMES: Record<string, string> = {
  "2.5.4.3": "CN",
  "2.5.4.6": "C",
  "2.5.4.7": "L",
  "2.5.4.8": "ST",
  "2.5.4.10": "O",
  "2.5.4.11": "OU",
  "1.2.840.113549.1.9.1": "E",
  "1.2.840.10045.4.3.2": "ecdsa-with-SHA256",
  "1.2.840.10045.4.3.3": "ecdsa-with-SHA384",
  "1.2.840.10045.4.3.4": "ecdsa-with-SHA512",
  "1.2.840.113549.1.1.11": "sha256WithRSA",
  "1.2.840.113549.1.1.12": "sha384WithRSA",
  "1.2.840.113549.1.1.13": "sha512WithRSA",
  "1.2.840.113549.1.1.10": "RSASSA-PSS",
  "1.3.101.112": "Ed25519",
  "1.2.840.10045.2.1": "EC",
  "1.2.840.113549.1.1.1": "RSA",
  "1.2.840.10045.3.1.7": "P-256",
  "1.3.132.0.34": "P-384",
  "1.3.132.0.35": "P-521",
  "1.3.6.1.5.5.7.3.4": "emailProtection",
  "1.3.6.1.5.5.7.3.36": "documentSigning",
  "1.3.6.1.5.5.7.3.8": "timeStamping",
  "1.3.6.1.5.5.7.3.9": "OCSPSigning",
  "1.3.6.1.5.5.7.3.1": "serverAuth",
  "1.3.6.1.5.5.7.3.2": "clientAuth",
  "1.3.6.1.5.5.7.3.3": "codeSigning",
};

function derTime(b: Uint8Array, node: Der): string {
  const s = ascii(b, node.start, node.end - node.start);
  const m = s.match(/^(\d{2}|\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?/);
  if (!m) return s;
  const year = m[1].length === 2 ? (Number(m[1]) < 50 ? 2000 : 1900) + Number(m[1]) : Number(m[1]);
  return `${year}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}Z`;
}

function derName(b: Uint8Array, node: Der): string {
  const rdns: string[] = [];
  for (const set of derChildren(b, node)) {
    for (const seq of derChildren(b, set)) {
      const [oid, val] = derChildren(b, seq);
      if (!oid || !val) continue;
      const name = OID_NAMES[derOid(b, oid)] ?? derOid(b, oid);
      rdns.push(`${name}=${td.decode(b.subarray(val.start, val.end))}`);
    }
  }
  return rdns.join(", ");
}

export interface CertificateInfo {
  subject: string;
  issuer: string;
  serial: string;
  notBefore: string;
  notAfter: string;
  signatureAlgorithm: string;
  publicKey: string;
  extendedKeyUsage: string[];
  isCa: boolean;
  der: Uint8Array;
}

export function parseCertificate(der: Uint8Array): CertificateInfo {
  const cert = derRead(der, 0);
  const [tbs, sigAlg] = derChildren(der, cert);
  const tbsKids = derChildren(der, tbs);
  let i = 0;
  if (tbsKids[0].tag === 0xa0) i = 1; // explicit version
  const serial = tbsKids[i], issuer = tbsKids[i + 2], validity = tbsKids[i + 3], subject = tbsKids[i + 4], spki = tbsKids[i + 5];
  const [nb, na] = derChildren(der, validity);
  const [spkiAlg] = derChildren(der, spki);
  const spkiOids = derChildren(der, spkiAlg);
  const keyAlg = OID_NAMES[derOid(der, spkiOids[0])] ?? derOid(der, spkiOids[0]);
  const curve = spkiOids[1] && spkiOids[1].tag === 0x06 ? OID_NAMES[derOid(der, spkiOids[1])] ?? derOid(der, spkiOids[1]) : "";
  const eku: string[] = [];
  let isCa = false;
  const ext = tbsKids.find((k) => k.tag === 0xa3);
  if (ext) {
    for (const e of derChildren(der, derChildren(der, ext)[0])) {
      const kids = derChildren(der, e);
      const oid = derOid(der, kids[0]);
      const val = kids[kids.length - 1];
      if (oid === "2.5.29.37") {
        for (const o of derChildren(der, derRead(der, val.start))) eku.push(OID_NAMES[derOid(der, o)] ?? derOid(der, o));
      } else if (oid === "2.5.29.19") {
        const inner = derRead(der, val.start);
        const bc = derChildren(der, inner);
        isCa = bc.length > 0 && bc[0].tag === 0x01 && der[bc[0].start] !== 0;
      }
    }
  }
  return {
    subject: derName(der, subject),
    issuer: derName(der, issuer),
    serial: hex(der.subarray(serial.start, serial.end)),
    notBefore: derTime(der, nb),
    notAfter: derTime(der, na),
    signatureAlgorithm: OID_NAMES[derOid(der, derChildren(der, sigAlg)[0])] ?? derOid(der, derChildren(der, sigAlg)[0]),
    publicKey: curve ? `${keyAlg} ${curve}` : keyAlg,
    extendedKeyUsage: eku,
    isCa,
    der,
  };
}

export function pemToDer(pem: string): Uint8Array[] {
  const out: Uint8Array[] = [];
  const re = /-----BEGIN [^-]+-----([\s\S]*?)-----END [^-]+-----/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pem))) out.push(base64ToBytes(m[1]));
  return out;
}

export function derToPem(der: Uint8Array, label = "CERTIFICATE"): string {
  const b64 = bytesToBase64(der).replace(/(.{64})/g, "$1\n");
  return `-----BEGIN ${label}-----\n${b64.trim()}\n-----END ${label}-----\n`;
}

/* ------------------------------------------------------------- metadata */

const EXIF_TAGS: Record<number, string> = {
  0x010e: "Image description",
  0x010f: "Make",
  0x0110: "Model",
  0x0131: "Software",
  0x0132: "Date/time",
  0x013b: "Artist",
  0x8298: "Copyright",
  0x9003: "Date/time original",
  0x9286: "User comment",
  0xa430: "Camera owner",
  0xa431: "Body serial number",
  0xa433: "Lens make",
  0xa434: "Lens model",
  0xa420: "Image unique ID",
};

/** Read the descriptive EXIF tags (IFD0 + Exif sub-IFD) from a TIFF-structured payload. */
export function parseExif(tiff: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  if (tiff.length < 8) return out;
  const le = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!le && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return out;
  const rd16 = (o: number) => (le ? tiff[o] | (tiff[o + 1] << 8) : u16be(tiff, o));
  const rd32 = (o: number) => (le ? u32le(tiff, o) : u32be(tiff, o));
  const readIfd = (ifd: number, depth: number) => {
    if (ifd + 2 > tiff.length || depth > 2) return;
    const n = rd16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > tiff.length) break;
      const tag = rd16(e), type = rd16(e + 2), count = rd32(e + 4);
      const size = (type === 3 ? 2 : type === 4 || type === 9 ? 4 : type === 5 || type === 10 ? 8 : 1) * count;
      const off = size <= 4 ? e + 8 : rd32(e + 8);
      if (tag === 0x8769 || tag === 0x8825) {
        if (tag === 0x8825) out["GPS"] = "present";
        else readIfd(rd32(e + 8), depth + 1);
        continue;
      }
      const name = EXIF_TAGS[tag];
      if (!name || off + size > tiff.length) continue;
      const raw = tiff.subarray(off, off + size);
      let value: string;
      if (tag === 0x9286) {
        const prefix = ascii(raw, 0, 8);
        const body = raw.subarray(8);
        value = prefix.startsWith("UNICODE") ? new TextDecoder(le ? "utf-16le" : "utf-16be").decode(body) : td.decode(body);
      } else if (type === 2 || type === 7) value = td.decode(raw);
      else if (type === 3) value = String(rd16(off));
      else if (type === 4) value = String(rd32(off));
      else continue;
      value = value.replace(/\0+$/g, "").trim();
      if (value) out[name] = value;
    }
  };
  readIfd(rd32(4), 0);
  return out;
}

/** All values of an XMP property: attribute form, element form, or rdf:Alt/Seq/Bag items. */
export function xmpValues(xmp: string, name: string): string[] {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const out: string[] = [];
  const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&").trim();
  const attr = new RegExp(`[\\s<]${esc}\\s*=\\s*"([^"]*)"`, "g");
  let m: RegExpExecArray | null;
  while ((m = attr.exec(xmp))) out.push(decode(m[1]));
  const el = new RegExp(`<${esc}(?:\\s[^>]*)?>([\\s\\S]*?)</${esc}>`, "g");
  while ((m = el.exec(xmp))) {
    const inner = m[1];
    const items = [...inner.matchAll(/<rdf:li(?:\s[^>]*)?>([\s\S]*?)<\/rdf:li>/g)].map((x) => decode(x[1].replace(/<[^>]+>/g, "")));
    if (items.length) out.push(...items);
    else if (!/<rdf:(Alt|Seq|Bag)/.test(inner)) out.push(decode(inner.replace(/<[^>]+>/g, "")));
  }
  return [...new Set(out.filter(Boolean))];
}

export const XMP_FIELDS: [string, string][] = [
  ["Iptc4xmpExt:DigitalSourceType", "Digital source type"],
  ["Iptc4xmpExt:DigitalSourceFileType", "Digital source file type"],
  ["xmp:CreatorTool", "Creator tool"],
  ["xmp:CreateDate", "Create date"],
  ["xmp:ModifyDate", "Modify date"],
  ["dc:creator", "Creator"],
  ["dc:title", "Title"],
  ["dc:description", "Description"],
  ["dc:rights", "Rights"],
  ["photoshop:Credit", "Credit"],
  ["photoshop:Source", "Source"],
  ["Iptc4xmpCore:CreatorTool", "IPTC creator tool"],
  ["plus:DataMining", "Data mining (TDM)"],
  ["dcterms:provenance", "C2PA remote manifest"],
  ["xmpMM:DocumentID", "Document ID"],
  ["xmpMM:InstanceID", "Instance ID"],
  ["stEvt:softwareAgent", "History software agent"],
  ["tiff:Make", "Make"],
  ["tiff:Model", "Model"],
  ["exif:UserComment", "User comment"],
  ["xmpRights:WebStatement", "Rights statement"],
];

export function summarizeXmp(xmp: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [prop, label] of XMP_FIELDS) {
    const v = xmpValues(xmp, prop);
    if (v.length) out[label] = v.join("; ");
  }
  return out;
}

const IPTC_DATASETS: Record<number, string> = {
  5: "Title",
  25: "Keywords",
  40: "Special instructions",
  55: "Date created",
  65: "Originating program",
  70: "Program version",
  80: "By-line",
  85: "By-line title",
  90: "City",
  101: "Country",
  105: "Headline",
  110: "Credit",
  115: "Source",
  116: "Copyright notice",
  120: "Caption",
  122: "Caption writer",
};

export function parseIptc(iim: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  let p = 0;
  while (p + 5 <= iim.length) {
    if (iim[p] !== 0x1c) {
      p++;
      continue;
    }
    const record = iim[p + 1], dataset = iim[p + 2];
    let size = u16be(iim, p + 3);
    let q = p + 5;
    if (size & 0x8000) {
      const n = size & 0x7fff;
      size = 0;
      for (let i = 0; i < n; i++) size = size * 256 + iim[q + i];
      q += n;
    }
    const value = td.decode(iim.subarray(q, q + size)).trim();
    if (record === 2 && IPTC_DATASETS[dataset] && value) {
      const k = IPTC_DATASETS[dataset];
      out[k] = out[k] ? `${out[k]}; ${value}` : value;
    }
    p = q + size;
  }
  return out;
}

/* --------------------------------------------------------- vocabularies */

export const DIGITAL_SOURCE_TYPES: Record<string, { label: string; kind: "ai" | "ai-edited" | "human" | "capture" | "other" }> = {
  trainedAlgorithmicMedia: { label: "Created by generative AI", kind: "ai" },
  compositeWithTrainedAlgorithmicMedia: { label: "Edited or composited with generative AI", kind: "ai-edited" },
  trainedAlgorithmicData: { label: "Synthetic data from a trained model", kind: "ai" },
  algorithmicMedia: { label: "Created by an algorithm (no trained model)", kind: "other" },
  algorithmicallyEnhanced: { label: "Algorithmically enhanced", kind: "other" },
  compositeSynthetic: { label: "Composite including synthetic elements", kind: "ai-edited" },
  composite: { label: "Composite of multiple sources", kind: "other" },
  compositeCapture: { label: "Composite of captured elements", kind: "capture" },
  digitalCapture: { label: "Captured by a digital camera", kind: "capture" },
  computationalCapture: { label: "Computational photography capture", kind: "capture" },
  negativeFilm: { label: "Scanned from negative film", kind: "capture" },
  positiveFilm: { label: "Scanned from positive film", kind: "capture" },
  print: { label: "Scanned from a print", kind: "capture" },
  screenCapture: { label: "Screen capture", kind: "capture" },
  virtualRecording: { label: "Recording of a virtual environment", kind: "other" },
  digitalCreation: { label: "Created digitally by a human", kind: "human" },
  humanEdits: { label: "Human edits", kind: "human" },
  minorHumanEdits: { label: "Minor human edits", kind: "human" },
  dataDrivenMedia: { label: "Data-driven media", kind: "other" },
  digitalArt: { label: "Digital art (legacy term)", kind: "human" },
};

export function digitalSourceType(uri: string | null | undefined): { key: string; label: string; kind: "ai" | "ai-edited" | "human" | "capture" | "other" } | null {
  if (!uri) return null;
  const key = uri.split("/").pop() ?? uri;
  const d = DIGITAL_SOURCE_TYPES[key];
  return d ? { key, ...d } : { key, label: key, kind: "other" };
}

export const ACTION_LABELS: Record<string, string> = {
  "c2pa.created": "Created",
  "c2pa.opened": "Opened",
  "c2pa.edited": "Edited",
  "c2pa.edited.metadata": "Metadata edited",
  "c2pa.cropped": "Cropped",
  "c2pa.resized": "Resized",
  "c2pa.color_adjustments": "Colour adjusted",
  "c2pa.filtered": "Filter applied",
  "c2pa.placed": "Content placed",
  "c2pa.removed": "Content removed",
  "c2pa.published": "Published",
  "c2pa.transcoded": "Transcoded",
  "c2pa.converted": "Converted",
  "c2pa.drawing": "Drawing",
  "c2pa.watermarked": "Watermarked",
  "c2pa.redacted": "Redacted",
  "c2pa.translated": "Translated",
  "c2pa.dubbed": "Dubbed",
  "c2pa.deleted": "Deleted",
  "c2pa.unknown": "Unknown action",
};

export const ASSERTION_LABELS: Record<string, string> = {
  "c2pa.actions": "Actions",
  "c2pa.actions.v2": "Actions",
  "c2pa.hash.data": "Data hash (content binding)",
  "c2pa.hash.boxes": "Box hash (content binding)",
  "c2pa.hash.bmff": "BMFF hash (content binding)",
  "c2pa.hash.bmff.v2": "BMFF hash (content binding)",
  "c2pa.hash.bmff.v3": "BMFF hash (content binding)",
  "c2pa.hash.collection.data": "Collection hash",
  "c2pa.ingredient": "Ingredient",
  "c2pa.ingredient.v2": "Ingredient",
  "c2pa.ingredient.v3": "Ingredient",
  "c2pa.thumbnail.claim": "Claim thumbnail",
  "c2pa.thumbnail.claim.jpeg": "Claim thumbnail",
  "c2pa.thumbnail.claim.png": "Claim thumbnail",
  "c2pa.thumbnail.ingredient": "Ingredient thumbnail",
  "c2pa.training-mining": "AI training & data-mining preferences",
  "cawg.training-mining": "AI training & data-mining preferences",
  "cawg.identity": "Creator identity (CAWG)",
  "cawg.metadata": "Metadata (CAWG)",
  "stds.schema-org.CreativeWork": "Creative work (schema.org)",
  "stds.exif": "EXIF",
  "stds.iptc": "IPTC",
  "stds.iptc.photo-metadata": "IPTC photo metadata",
  "c2pa.metadata": "Metadata",
  "c2pa.cloud-data": "Cloud data",
  "c2pa.soft-binding": "Soft binding (watermark reference)",
  "c2pa.depthmap.GDepth": "Depth map",
  "c2pa.endorsement": "Endorsement",
  "c2pa.asset-type": "Asset type",
  "c2pa.certificate-status": "Certificate status",
  "c2pa.icon": "Icon",
};

export function assertionLabel(label: string): string {
  const base = label.replace(/__\d+$/, "");
  return ASSERTION_LABELS[base] ?? ASSERTION_LABELS[base.replace(/\.v\d+$/, "")] ?? base;
}

/** Friendly wording for c2pa-rs validation status codes. */
export const STATUS_LABELS: Record<string, string> = {
  "claimSignature.validated": "Claim signature is valid",
  "claimSignature.insideValidity": "Signed within the certificate's validity period",
  "claimSignature.mismatch": "Claim signature does not match the claim",
  "claimSignature.outsideValidity": "Signed outside the certificate's validity period",
  "signingCredential.trusted": "Signer's certificate chains to a trusted anchor",
  "signingCredential.untrusted": "Signer's certificate is not on a known trust list",
  "signingCredential.expired": "Signer's certificate has expired",
  "signingCredential.invalid": "Signer's certificate is invalid",
  "signingCredential.revoked": "Signer's certificate has been revoked",
  "signingCredential.ocsp.skipped": "Revocation check (OCSP) skipped",
  "signingCredential.ocsp.inaccessible": "Revocation check (OCSP) could not be reached",
  "signingCredential.ocsp.unknown": "Revocation status unknown",
  "signingCredential.ocsp.revoked": "Certificate revoked (OCSP)",
  "signingCredential.ocsp.notRevoked": "Certificate not revoked (OCSP)",
  "timeStamp.trusted": "Time-stamp authority is trusted",
  "timeStamp.untrusted": "Time-stamp authority is not trusted",
  "timeStamp.validated": "Time-stamp is valid",
  "timeStamp.mismatch": "Time-stamp does not match the signature",
  "timeStamp.malformed": "Time-stamp is malformed",
  "timeStamp.outsideValidity": "Time-stamp outside certificate validity",
  "timeStamp.expired": "Time-stamp certificate has expired",
  "assertion.hashedURI.match": "Assertion hash matches the claim",
  "assertion.hashedURI.mismatch": "Assertion hash does not match the claim (edited after signing)",
  "assertion.dataHash.match": "Content hash matches — the media has not been altered",
  "assertion.dataHash.mismatch": "Content hash does not match — the media was altered after signing",
  "assertion.bmffHash.match": "Content hash matches — the media has not been altered",
  "assertion.bmffHash.mismatch": "Content hash does not match — the media was altered after signing",
  "assertion.boxesHash.match": "Content hash matches — the media has not been altered",
  "assertion.boxesHash.mismatch": "Content hash does not match — the media was altered after signing",
  "assertion.collectionHash.match": "Collection hash matches",
  "assertion.notRedacted": "Assertion is not redacted",
  "assertion.missing": "Referenced assertion is missing",
  "assertion.multipleHardBindings": "More than one content binding (not allowed)",
  "assertion.selfRedacted": "Manifest redacts its own assertion (not allowed)",
  "assertion.requiredMissing": "A required assertion is missing",
  "assertion.json.invalid": "Assertion JSON is invalid",
  "assertion.cbor.invalid": "Assertion CBOR is invalid",
  "assertion.action.ingredientMismatch": "Action references a missing ingredient",
  "assertion.action.redactionMismatch": "Redaction action mismatch",
  "assertion.action.malformed": "Actions assertion is malformed",
  "assertion.ingredient.malformed": "Ingredient assertion is malformed",
  "ingredient.manifest.missing": "Ingredient's manifest is missing",
  "ingredient.hashedURI.mismatch": "Ingredient hash does not match",
  "ingredient.claimSignature.validated": "Ingredient's claim signature is valid",
  "ingredient.claimSignature.mismatch": "Ingredient's claim signature is invalid",
  "ingredient.claimSignature.missing": "Ingredient's claim signature is missing",
  "ingredient.unknownProvenance": "Ingredient has no provenance data",
  "ingredient.manifest.validated": "Ingredient's manifest is valid",
  "ingredient.claim.missing": "Ingredient's claim is missing",
  "claim.missing": "Claim is missing",
  "claim.multiple": "Multiple claims in one manifest",
  "claim.malformed": "Claim is malformed",
  "claim.hardBindings.missing": "No content binding (hash) in the claim",
  "claim.required.missing": "Required claim fields are missing",
  "claim.cbor.invalid": "Claim CBOR is invalid",
  "manifest.unreferenced": "Manifest is not referenced by any ingredient or the active manifest",
  "manifest.multipleParents": "Manifest has multiple parents",
  "manifest.updateInvalid": "Update manifest is invalid",
  "manifest.updateWrongParents": "Update manifest has wrong parents",
  "manifest.inaccessible": "Manifest could not be fetched",
  "manifest.compressedManifestInvalid": "Compressed manifest is invalid",
  "algorithm.unsupported": "Hash or signature algorithm is unsupported",
  "general.error": "General validation error",
  "cawg.identity.trusted": "Creator identity signer is trusted",
  "cawg.identity.untrusted": "Creator identity signer is not on a trust list",
  "cawg.identity.cbor.invalid": "Identity assertion CBOR is invalid",
  "cawg.identity.sig_type.unknown": "Identity assertion uses an unknown signature type",
  "cawg.identity.hard_binding_missing": "Identity assertion lacks a hard binding",
  "cawg.identity.assertion.mismatch": "Identity assertion mismatch",
  "cawg.ica.credential_valid": "Identity claims aggregation credential is valid",
  "cawg.ica.signature.valid": "Identity claims aggregation signature is valid",
  "cawg.ica.signature.invalid": "Identity claims aggregation signature is invalid",
};

export function statusLabel(code: string): string {
  return STATUS_LABELS[code] ?? code.replace(/[._]/g, " ");
}

/* ------------------------------------------------------------- AI signals */

export type SignalKind = "ai" | "ai-edited" | "generator" | "human" | "capture" | "info";

export interface Signal {
  kind: SignalKind;
  source: string;
  title: string;
  detail?: string;
}

/** What the widget derives from the SDK's manifest store (kept SDK-agnostic here). */
export interface ManifestFacts {
  claimGenerators: string[];
  softwareAgents: string[];
  digitalSourceTypes: string[];
  actions: string[];
  hasCredentials: boolean;
  trainingMining?: Record<string, string>;
}

const GENERATOR_PATTERNS: [RegExp, string][] = [
  [/midjourney/i, "Midjourney"],
  [/stable[ -]?diffusion|sdxl|sd\.next|automatic1111|a1111|forge webui/i, "Stable Diffusion"],
  [/comfyui/i, "ComfyUI"],
  [/novelai/i, "NovelAI"],
  [/invokeai/i, "InvokeAI"],
  [/fooocus/i, "Fooocus"],
  [/dall[·-]?e|openai|chatgpt|gpt-image|sora/i, "OpenAI (DALL·E / ChatGPT / Sora)"],
  [/firefly|adobe generative|generative fill|generative expand/i, "Adobe Firefly / generative fill"],
  [/imagen|nano banana|gemini|veo|lyria|google ai|made with google ai|magic editor|reimagine|pixel studio|best take|add me/i, "Google AI (Imagen / Gemini / Veo / Pixel)"],
  [/microsoft designer|bing image creator|copilot/i, "Microsoft Designer / Copilot"],
  [/imagined with ai|meta ai|emu\b|llama/i, "Meta AI"],
  [/grok|aurora|xai/i, "xAI Grok"],
  [/ideogram/i, "Ideogram"],
  [/leonardo/i, "Leonardo AI"],
  [/flux\.?1|black forest labs|bfl/i, "FLUX (Black Forest Labs)"],
  [/recraft/i, "Recraft"],
  [/krea/i, "Krea"],
  [/runway|gen-?[234]/i, "Runway"],
  [/kling/i, "Kling"],
  [/pika/i, "Pika"],
  [/luma|dream machine/i, "Luma"],
  [/hailuo|minimax/i, "MiniMax Hailuo"],
  [/dreamstudio|stability ai|stability\.ai/i, "Stability AI"],
  [/nightcafe|playground ai|artbreeder|craiyon|starryai|lexica|dreamlike|getimg|tensor\.art|civitai/i, "AI art service"],
  [/draw things|diffusionbee|mochi diffusion/i, "Local diffusion app"],
  [/topaz|magnific|upscayl|gigapixel/i, "AI upscaler"],
  [/canva magic|magic media/i, "Canva Magic Media"],
  [/\bAI[- ]generated\b|generated with ai|created with ai|ai generated/i, "Self-described AI-generated"],
];

const CAPTURE_MAKERS = /apple|samsung|google|canon|nikon|sony|fujifilm|panasonic|olympus|om digital|leica|hasselblad|pentax|ricoh|dji|gopro|xiaomi|huawei|oppo|oneplus|vivo|motorola|lg electronics|nokia|hmd|sigma|phase one/i;

function matchGenerator(text: string): string | null {
  for (const [re, name] of GENERATOR_PATTERNS) if (re.test(text)) return name;
  return null;
}

export interface SignalReport {
  signals: Signal[];
  /** Strongest conclusion about AI involvement. */
  ai: "declared-generated" | "declared-edited" | "hinted" | "none";
  /** True when the metadata points to a Google product (where SynthID is expected as well). */
  google: boolean;
  /** Camera-capture evidence present. */
  capture: boolean;
}

export function deriveSignals(input: { exif: Record<string, string>; xmp: Record<string, string>; iptc: Record<string, string>; text: TextEntry[]; manifest: ManifestFacts | null }): SignalReport {
  const signals: Signal[] = [];
  const { exif, xmp, iptc, text, manifest } = input;

  if (manifest) {
    for (const dst of manifest.digitalSourceTypes) {
      const d = digitalSourceType(dst);
      if (!d) continue;
      const kind: SignalKind = d.kind === "ai" ? "ai" : d.kind === "ai-edited" ? "ai-edited" : d.kind === "capture" ? "capture" : d.kind === "human" ? "human" : "info";
      signals.push({ kind, source: "C2PA action", title: d.label, detail: `digitalSourceType: ${d.key}` });
    }
    for (const agent of [...manifest.claimGenerators, ...manifest.softwareAgents]) {
      const g = matchGenerator(agent);
      if (g) signals.push({ kind: "generator", source: "C2PA claim generator / software agent", title: g, detail: agent });
    }
    if (manifest.trainingMining && Object.keys(manifest.trainingMining).length) {
      signals.push({ kind: "info", source: "C2PA training-mining assertion", title: "AI training & data-mining preferences declared", detail: Object.entries(manifest.trainingMining).map(([k, v]) => `${k}: ${v}`).join(", ") });
    }
  }

  const dstXmp = xmp["Digital source type"];
  if (dstXmp) {
    for (const uri of dstXmp.split("; ")) {
      const d = digitalSourceType(uri);
      if (!d) continue;
      const kind: SignalKind = d.kind === "ai" ? "ai" : d.kind === "ai-edited" ? "ai-edited" : d.kind === "capture" ? "capture" : d.kind === "human" ? "human" : "info";
      signals.push({ kind, source: "IPTC DigitalSourceType (XMP)", title: d.label, detail: d.key });
    }
  }

  const textFields: [string, string][] = [
    ...Object.entries(exif).map(([k, v]): [string, string] => [`EXIF ${k}`, v]),
    ...Object.entries(xmp).filter(([k]) => k !== "Digital source type").map(([k, v]): [string, string] => [`XMP ${k}`, v]),
    ...Object.entries(iptc).map(([k, v]): [string, string] => [`IPTC ${k}`, v]),
    ...text.map((t): [string, string] => [`${t.where} "${t.key}"`, t.value]),
  ];
  for (const [where, value] of textFields) {
    const g = matchGenerator(value) ?? (/credit|software|creator|program|agent/i.test(where) ? null : null);
    if (g) signals.push({ kind: "generator", source: where, title: g, detail: value.length > 160 ? `${value.slice(0, 160)}…` : value });
  }

  // Generator-specific text-chunk fingerprints (no product name needed).
  for (const t of text) {
    const k = t.key.toLowerCase();
    if (k === "parameters" && /steps:|sampler:|cfg scale:|negative prompt:/i.test(t.value)) signals.push({ kind: "generator", source: `${t.where} "parameters"`, title: "Stable Diffusion WebUI (AUTOMATIC1111 / Forge) generation parameters", detail: t.value.slice(0, 160) });
    else if ((k === "prompt" || k === "workflow") && t.value.trim().startsWith("{")) signals.push({ kind: "generator", source: `${t.where} "${t.key}"`, title: "ComfyUI workflow / prompt graph", detail: `${t.value.length} chars of JSON` });
    else if (k === "invokeai_metadata" || k === "invokeai_graph" || k === "sd-metadata" || k === "dream") signals.push({ kind: "generator", source: `${t.where} "${t.key}"`, title: "InvokeAI metadata" });
    else if (k === "comment" && /"prompt"|"uc"|"sampler"|steps/i.test(t.value) && t.value.trim().startsWith("{")) signals.push({ kind: "generator", source: `${t.where} "Comment"`, title: "NovelAI / diffusion generation JSON", detail: t.value.slice(0, 160) });
    else if (k === "description" && /--(v|ar|s|niji|q|c|chaos|seed)\b|job id:/i.test(t.value)) signals.push({ kind: "generator", source: `${t.where} "Description"`, title: "Midjourney prompt", detail: t.value.slice(0, 160) });
  }
  if (exif["User comment"] && /steps:|sampler:|negative prompt:/i.test(exif["User comment"])) signals.push({ kind: "generator", source: "EXIF User comment", title: "Stable Diffusion generation parameters", detail: exif["User comment"].slice(0, 160) });

  const make = exif["Make"] ?? xmp["Make"] ?? "";
  const model = exif["Model"] ?? xmp["Model"] ?? "";
  if (make || model) {
    const looksCamera = CAPTURE_MAKERS.test(`${make} ${model}`);
    signals.push({ kind: looksCamera ? "capture" : "info", source: "EXIF Make / Model", title: looksCamera ? `Camera metadata: ${[make, model].filter(Boolean).join(" ")}` : `Make / model: ${[make, model].filter(Boolean).join(" ")}`, detail: exif["Lens model"] ? `Lens: ${exif["Lens model"]}` : undefined });
  }
  if (exif["Software"] && !matchGenerator(exif["Software"])) signals.push({ kind: "info", source: "EXIF Software", title: `Software: ${exif["Software"]}` });
  if (xmp["Creator tool"] && !matchGenerator(xmp["Creator tool"])) signals.push({ kind: "info", source: "XMP CreatorTool", title: `Creator tool: ${xmp["Creator tool"]}` });
  if (xmp["Credit"] && !matchGenerator(xmp["Credit"])) signals.push({ kind: "info", source: "XMP Credit", title: `Credit: ${xmp["Credit"]}` });
  if (xmp["Data mining (TDM)"]) signals.push({ kind: "info", source: "XMP plus:DataMining", title: "Data-mining / AI-training preference declared", detail: xmp["Data mining (TDM)"] });

  // De-duplicate identical titles from the same kind.
  const seen = new Set<string>();
  const unique = signals.filter((s) => {
    const k = `${s.kind}|${s.title}|${s.source}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const ai = unique.some((s) => s.kind === "ai") ? "declared-generated" : unique.some((s) => s.kind === "ai-edited") ? "declared-edited" : unique.some((s) => s.kind === "generator") ? "hinted" : "none";
  const blob = [...Object.values(exif), ...Object.values(xmp), ...Object.values(iptc), ...(manifest?.claimGenerators ?? []), ...(manifest?.softwareAgents ?? [])].join(" ");
  const google = /google|gemini|imagen|veo|lyria|pixel|nano banana|synthid/i.test(blob);
  return { signals: unique, ai, google, capture: unique.some((s) => s.kind === "capture") };
}

/* ------------------------------------------------------------ demo signer */

export interface DemoSignerMaterial {
  certChainPem: string;
  privateKeyPem: string;
}

/** Size of a COSE_Sign1 for this chain with an empty pad and a 64-byte ES256 signature. */
function coseSizeWithPad(protectedBstr: Uint8Array, sig: Uint8Array, padLen: number): number {
  return encodeCbor({ tag: 18, value: [protectedBstr, { pad: new Uint8Array(padLen) }, null, sig] }).length;
}

/**
 * Build a COSE_Sign1 over `payload` (detached), with the certificate chain in
 * the protected header and zero-padding in the unprotected header so the
 * structure is exactly `reserveSize` bytes — which is what c2pa-rs expects from
 * a signer that does its own COSE handling.
 */
export async function coseSignEs256(payload: Uint8Array, privateKey: CryptoKey, certChain: Uint8Array[], reserveSize: number): Promise<Uint8Array> {
  const protectedMap = new CborMap();
  protectedMap.entries.push([1, -7], [33, certChain.length === 1 ? certChain[0] : certChain]);
  const protectedBstr = encodeCbor(protectedMap);
  const sigStructure = encodeCbor(["Signature1", protectedBstr, new Uint8Array(0), payload]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, sigStructure as BufferSource));
  // Find the pad length that lands exactly on reserveSize (the bstr header grows with the length).
  const withZeroPad = coseSizeWithPad(protectedBstr, sig, 0);
  if (withZeroPad > reserveSize) throw new Error(`Reserved ${reserveSize} bytes but the signature needs ${withZeroPad}`);
  let padLen = reserveSize - withZeroPad;
  for (let i = 0; i < 8 && coseSizeWithPad(protectedBstr, sig, padLen) !== reserveSize; i++) padLen -= coseSizeWithPad(protectedBstr, sig, padLen) - reserveSize;
  if (padLen < 0 || coseSizeWithPad(protectedBstr, sig, padLen) !== reserveSize) throw new Error("Couldn't pad the signature to the reserved size");
  return encodeCbor({ tag: 18, value: [protectedBstr, { pad: new Uint8Array(padLen) }, null, sig] });
}

export async function importEs256PrivateKey(pem: string): Promise<CryptoKey> {
  const [der] = pemToDer(pem);
  return crypto.subtle.importKey("pkcs8", der as BufferSource, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** Reserve size for a chain: the fixed COSE size plus a little pad. */
export function reserveSizeFor(certChain: Uint8Array[]): number {
  const protectedMap = new CborMap();
  protectedMap.entries.push([1, -7], [33, certChain.length === 1 ? certChain[0] : certChain]);
  return coseSizeWithPad(encodeCbor(protectedMap), new Uint8Array(64), 0) + 128;
}

/** Verify an ES256 COSE_Sign1 (as produced above) against its embedded leaf certificate; used by tests. */
export async function verifyCoseEs256(cose: Uint8Array, payload: Uint8Array): Promise<boolean> {
  const parsed = parseCoseSign1(cose);
  const { value } = decodeCbor(cose);
  const arr = ((value as CborTag).value ?? value) as Cbor[];
  const protectedBstr = arr[0] as Uint8Array;
  const cert = parsed.certificates[0];
  const c = derRead(cert, 0);
  const tbsKids = derChildren(cert, derChildren(cert, c)[0]);
  const spki = tbsKids[tbsKids[0].tag === 0xa0 ? 6 : 5];
  const key = await crypto.subtle.importKey("spki", cert.subarray(spki.start - spki.hdr, spki.end) as BufferSource, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const sigStructure = encodeCbor(["Signature1", protectedBstr, new Uint8Array(0), payload]);
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, parsed.signature as BufferSource, sigStructure as BufferSource);
}

/* ------------------------------------------------------------ misc utils */

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)));
}
