// Write metadata back into a file's bytes — add or change a few fields, and above all a GPS location, using each
// container's own public convention: EXIF (JPEG APP1, PNG eXIf, WebP EXIF), the QuickTime udta ©-atoms for
// MP4/MOV/M4A, and ID3v2 text frames for MP3. Every writer preserves the rest of the file untouched; the big
// media payload is never rebuilt in memory (see the ISO-BMFF helpers, which edit only the small moov atom). PDF is
// handled in the widget through pdf-lib. The readers in metadata.ts are the oracle these are tested against.

import { buildExifTiff, type ExifFields } from "./exif-build";

/** The edits a user can make. Only the keys present are applied; `location: null` removes the location. */
export interface MetaEdits {
  location?: { lat: number; lon: number; altitude?: number } | null;
  title?: string;
  artist?: string;
  description?: string;
  /** A date-time the writer formats per container (EXIF "YYYY:MM:DD HH:MM:SS", others ISO). */
  dateTime?: string;
  make?: string;
  model?: string;
  copyright?: string;
}

export interface EditCaps {
  /** Whether a GPS location can be written in this container's standard way. */
  location: boolean;
  /** Which text fields this container carries. */
  fields: (keyof Omit<MetaEdits, "location">)[];
  /** A caveat to show (e.g. MP3 has no portable location). */
  note?: string;
}

/** What can be edited for a sniffed extension, or null when writing is not supported. */
export function editCapabilities(ext: string): EditCaps | null {
  switch (ext) {
    case "jpg":
    case "jpeg":
    case "png":
    case "webp":
      return { location: true, fields: ["description", "artist", "copyright", "make", "model", "dateTime"] };
    case "mp4":
    case "mov":
    case "m4a":
    case "m4v":
      return { location: true, fields: ["title", "artist", "description", "dateTime"] };
    case "mp3":
      return { location: false, fields: ["title", "artist", "description", "dateTime"], note: "MP3 (ID3) has no portable GPS convention — use an MP4/M4A file for location in audio." };
    case "pdf":
      return { location: false, fields: ["title", "artist", "description"], note: "A PDF carries document info (title, author, subject), not a GPS location." };
    default:
      return null;
  }
}

/* ───────────────────────── shared ───────────────────────── */

/** ISO-6709 string, e.g. "+35.658600+139.745400+42.500/" — the form DJI, Android and Apple all read. */
export function isoLocation(lat: number, lon: number, altitude?: number): string {
  const s = (n: number, dp: number) => (n >= 0 ? "+" : "") + n.toFixed(dp);
  return `${s(lat, 6)}${s(lon, 6)}${altitude != null && Number.isFinite(altitude) ? s(altitude, 3) : ""}/`;
}

/** Turn a user date "2026-09-23 18:12:51" (or ISO) into EXIF "2026:09:23 18:12:51". */
function exifDate(s: string): string {
  const m = /(\d{4})[-:/](\d{2})[-:/](\d{2})[ T]?(\d{2})?:?(\d{2})?:?(\d{2})?/.exec(s.trim());
  if (!m) return s;
  const [, y, mo, d, h = "00", mi = "00", se = "00"] = m;
  return `${y}:${mo}:${d} ${h}:${mi}:${se}`;
}

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const concat = (parts: Uint8Array[]) => { const n = parts.reduce((a, p) => a + p.length, 0); const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const latin1 = (s: string) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; };

/** Map the common edits to EXIF fields (for the image writers). */
function toExifFields(edits: MetaEdits): ExifFields {
  const f: ExifFields = {};
  if (edits.description !== undefined) f.description = edits.description;
  if (edits.make !== undefined) f.make = edits.make;
  if (edits.model !== undefined) f.model = edits.model;
  if (edits.artist !== undefined) f.artist = edits.artist;
  if (edits.copyright !== undefined) f.copyright = edits.copyright;
  if (edits.dateTime !== undefined) f.dateTime = exifDate(edits.dateTime);
  if (edits.location !== undefined) f.gps = edits.location;
  return f;
}

/* ───────────────────────── JPEG ───────────────────────── */

const EXIF_HDR = latin1("Exif\0\0");

/** Add/replace the APP1 EXIF segment of a JPEG, merging into any existing EXIF so camera tags survive. */
export function writeJpegMeta(bytes: Uint8Array, edits: MetaEdits): Uint8Array {
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) throw new Error("not a JPEG");
  const segs: { marker: number; start: number; end: number }[] = [];
  let p = 2;
  while (p + 4 <= bytes.length) {
    if (bytes[p] !== 0xff) break;
    const marker = bytes[p + 1];
    if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan — image data follows
    if (marker >= 0xd0 && marker <= 0xd7) { p += 2; continue; } // standalone
    const len = u16be(bytes, p + 2);
    if (len < 2 || p + 2 + len > bytes.length) break;
    segs.push({ marker, start: p, end: p + 2 + len });
    p += 2 + len;
  }
  const rest = bytes.subarray(p); // SOS … EOI (image data), copied verbatim
  const exifSeg = segs.find((s) => s.marker === 0xe1 && bytes.length >= s.start + 4 + 6 && EXIF_HDR.every((v, i) => bytes[s.start + 4 + i] === v));
  const existingTiff = exifSeg ? bytes.subarray(exifSeg.start + 4 + 6, exifSeg.end) : null;
  const tiff = buildExifTiff(toExifFields(edits), existingTiff);

  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])];
  if (tiff.length) {
    const payloadLen = 2 + 6 + tiff.length;
    if (payloadLen > 0xffff) throw new Error("the EXIF block is too large for a JPEG segment");
    parts.push(new Uint8Array([0xff, 0xe1, payloadLen >> 8, payloadLen & 0xff]), EXIF_HDR, tiff);
  }
  // Keep every other header segment in its original order; drop the old EXIF APP1.
  for (const s of segs) if (s !== exifSeg) parts.push(bytes.subarray(s.start, s.end));
  parts.push(rest);
  return concat(parts);
}

/* ───────────────────────── PNG ───────────────────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const td = latin1(type);
  const body = concat([td, data]);
  const out = new Uint8Array(4 + body.length + 4);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out.set(body, 4);
  v.setUint32(4 + body.length, crc32(body));
  return out;
}

/** Add/replace a PNG eXIf chunk (bare TIFF/EXIF), preserving every other chunk. */
export function writePngMeta(bytes: Uint8Array, edits: MetaEdits): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((v, i) => bytes[i] === v)) throw new Error("not a PNG");
  const chunks: { type: string; start: number; end: number }[] = [];
  let p = 8;
  while (p + 8 <= bytes.length) {
    const len = u32be(bytes, p);
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    const end = p + 12 + len;
    if (end > bytes.length) break;
    chunks.push({ type, start: p, end });
    p = end;
    if (type === "IEND") break;
  }
  let existingTiff: Uint8Array | null = null;
  const ex = chunks.find((c) => c.type === "eXIf");
  if (ex) existingTiff = bytes.subarray(ex.start + 8, ex.end - 4);
  const tiff = buildExifTiff(toExifFields(edits), existingTiff);

  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let inserted = false;
  for (const c of chunks) {
    if (c.type === "eXIf") continue; // drop the old one
    if (!inserted && (c.type === "IDAT" || c.type === "IEND")) {
      if (tiff.length) parts.push(pngChunk("eXIf", tiff));
      inserted = true;
    }
    parts.push(bytes.subarray(c.start, c.end));
  }
  if (!inserted && tiff.length) parts.splice(parts.length - 1, 0, pngChunk("eXIf", tiff));
  return concat(parts);
}

/* ───────────────────────── WebP ───────────────────────── */

const u32le = (n: number) => new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
function riffChunk(fourcc: string, data: Uint8Array): Uint8Array {
  const pad = data.length & 1;
  const out = new Uint8Array(8 + data.length + pad);
  out.set(latin1(fourcc), 0);
  out.set(u32le(data.length), 4);
  out.set(data, 8);
  return out;
}

/**
 * Add/replace a WebP EXIF chunk and set the EXIF flag in VP8X. For a simple (VP8/VP8L) WebP a VP8X header is
 * synthesised, which needs the canvas size — pass `dims`; without it a simple WebP is returned unchanged-throwing.
 */
export function writeWebpMeta(bytes: Uint8Array, edits: MetaEdits, dims?: { width: number; height: number }): Uint8Array {
  if (!(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === "RIFF" && String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === "WEBP")) throw new Error("not a WebP");
  const chunks: { fourcc: string; start: number; dataStart: number; dataLen: number; end: number }[] = [];
  let p = 12;
  while (p + 8 <= bytes.length) {
    const fourcc = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
    const len = (bytes[p + 4] | (bytes[p + 5] << 8) | (bytes[p + 6] << 16) | (bytes[p + 7] << 24)) >>> 0;
    const end = p + 8 + len + (len & 1);
    if (end > bytes.length + 1) break;
    chunks.push({ fourcc, start: p, dataStart: p + 8, dataLen: len, end: Math.min(end, bytes.length) });
    p = end;
  }
  let existingTiff: Uint8Array | null = null;
  const old = chunks.find((c) => c.fourcc === "EXIF");
  if (old) existingTiff = bytes.subarray(old.dataStart, old.dataStart + old.dataLen);
  const tiff = buildExifTiff(toExifFields(edits), existingTiff);
  if (!tiff.length) return bytes.slice();

  const vp8x = chunks.find((c) => c.fourcc === "VP8X");
  const body: Uint8Array[] = [];
  if (vp8x) {
    const flags = bytes[vp8x.dataStart] | 0x08; // set EXIF flag
    const vp = bytes.slice(vp8x.start, vp8x.end);
    vp[8] = flags;
    body.push(vp);
    for (const c of chunks) { if (c.fourcc === "VP8X" || c.fourcc === "EXIF") continue; body.push(bytes.subarray(c.start, c.end)); }
  } else {
    if (!dims) throw new Error("this simple WebP has no VP8X header; its canvas size is needed to add metadata");
    const vpd = new Uint8Array(10);
    vpd[0] = 0x08; // EXIF flag
    const w = dims.width - 1, h = dims.height - 1;
    vpd[4] = w & 0xff; vpd[5] = (w >> 8) & 0xff; vpd[6] = (w >> 16) & 0xff;
    vpd[7] = h & 0xff; vpd[8] = (h >> 8) & 0xff; vpd[9] = (h >> 16) & 0xff;
    body.push(riffChunk("VP8X", vpd));
    for (const c of chunks) { if (c.fourcc === "EXIF") continue; body.push(bytes.subarray(c.start, c.end)); }
  }
  body.push(riffChunk("EXIF", tiff));
  const payload = concat(body);
  const out = new Uint8Array(12 + payload.length);
  out.set(latin1("RIFF"), 0);
  out.set(u32le(4 + payload.length), 4);
  out.set(latin1("WEBP"), 8);
  out.set(payload, 12);
  return out;
}

/* ───────────────────────── MP3 (ID3v2) ───────────────────────── */

const synchsafe = (n: number) => new Uint8Array([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
function id3Frame(id: string, text: string): Uint8Array {
  const data = concat([new Uint8Array([3]), new TextEncoder().encode(text)]); // encoding 3 = UTF-8
  const out = new Uint8Array(10 + data.length);
  out.set(latin1(id), 0);
  const v = new DataView(out.buffer);
  v.setUint32(4, data.length); // v2.4 frame size is plain (fits our small frames; keep < 2^28 for safety)
  out.set(data, 10);
  return out;
}
/** Replace ID3v2 text frames (keeping the rest of the tag and the audio). COMM gets a short header. */
export function writeMp3Meta(bytes: Uint8Array, edits: MetaEdits): Uint8Array {
  let audioStart = 0;
  const kept: Uint8Array[] = [];
  const setIds = new Set<string>();
  if (edits.title !== undefined) setIds.add("TIT2");
  if (edits.artist !== undefined) setIds.add("TPE1");
  if (edits.description !== undefined) setIds.add("COMM");
  if (edits.dateTime !== undefined) setIds.add("TDRC");

  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    audioStart = 10 + size;
    let q = 10;
    while (q + 10 <= audioStart) {
      const id = String.fromCharCode(bytes[q], bytes[q + 1], bytes[q + 2], bytes[q + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const fsize = u32be(bytes, q + 4);
      const end = q + 10 + fsize;
      if (end > audioStart) break;
      if (!setIds.has(id)) kept.push(bytes.subarray(q, end)); // keep frames we are not changing
      q = end;
    }
  }

  const fresh: Uint8Array[] = [];
  if (edits.title !== undefined) fresh.push(id3Frame("TIT2", edits.title));
  if (edits.artist !== undefined) fresh.push(id3Frame("TPE1", edits.artist));
  if (edits.dateTime !== undefined) fresh.push(id3Frame("TDRC", edits.dateTime));
  if (edits.description !== undefined) {
    // COMM: encoding(1) + language(3) + short desc(0) + text
    const data = concat([new Uint8Array([3]), latin1("eng"), new Uint8Array([0]), new TextEncoder().encode(edits.description)]);
    const out = new Uint8Array(10 + data.length);
    out.set(latin1("COMM"), 0);
    new DataView(out.buffer).setUint32(4, data.length);
    out.set(data, 10);
    fresh.push(out);
  }

  const frames = concat([...kept, ...fresh]);
  const header = new Uint8Array(10);
  header.set(latin1("ID3"), 0);
  header[3] = 4; header[4] = 0; header[5] = 0; // v2.4.0, no flags
  header.set(synchsafe(frames.length), 6);
  return concat([header, frames, bytes.subarray(audioStart)]);
}

/* ───────────────────────── ISO-BMFF (MP4 / MOV / M4A) ───────────────────────── */

/** Walk the direct children of a box region, returning {type,start,size} for each. */
function childBoxes(b: Uint8Array, start: number, end: number): { type: string; start: number; size: number; head: number }[] {
  const out: { type: string; start: number; size: number; head: number }[] = [];
  let o = start;
  while (o + 8 <= end) {
    let size = u32be(b, o);
    let head = 8;
    const type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    if (size === 1) { size = u32be(b, o + 8) * 2 ** 32 + u32be(b, o + 12); head = 16; }
    else if (size === 0) size = end - o;
    if (size < head || o + size > end) break;
    out.push({ type, start: o, size, head });
    o += size;
  }
  return out;
}

/** A QuickTime udta ©-atom: size + type + (u16 len, u16 lang 'und', text). */
function udtaAtom(type: string, text: string): Uint8Array {
  const t = new TextEncoder().encode(text);
  const out = new Uint8Array(8 + 4 + t.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, out.length);
  out.set(latin1(type), 4);
  v.setUint16(8, t.length);
  v.setUint16(10, 0x15c7); // packed language 'und'
  out.set(t, 12);
  return out;
}
const boxOf = (type: string, payload: Uint8Array) => { const out = new Uint8Array(8 + payload.length); new DataView(out.buffer).setUint32(0, out.length); out.set(latin1(type), 4); out.set(payload, 8); return out; };

/** The ©-atoms a set of edits maps to in udta. */
function udtaAtomsFor(edits: MetaEdits): Record<string, string> {
  const m: Record<string, string> = {};
  if (edits.location !== undefined && edits.location !== null) m["©xyz"] = isoLocation(edits.location.lat, edits.location.lon, edits.location.altitude);
  if (edits.title !== undefined) m["©nam"] = edits.title;
  if (edits.artist !== undefined) m["©ART"] = edits.artist;
  if (edits.description !== undefined) m["©cmt"] = edits.description;
  if (edits.dateTime !== undefined) m["©day"] = edits.dateTime;
  return m;
}

/** Add `delta` to every stco/co64 entry inside a moov region (in place). */
function shiftChunkOffsets(moov: Uint8Array, delta: number) {
  const v = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  const CONTAINER = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts"]);
  const walk = (start: number, end: number) => {
    for (const c of childBoxes(moov, start, end)) {
      const body = c.start + c.head, bodyEnd = c.start + c.size;
      if (c.type === "stco") {
        const n = u32be(moov, body + 4);
        for (let i = 0; i < n; i++) { const at = body + 8 + i * 4; if (at + 4 <= bodyEnd) v.setUint32(at, (u32be(moov, at) + delta) >>> 0); }
      } else if (c.type === "co64") {
        const n = u32be(moov, body + 4);
        for (let i = 0; i < n; i++) { const at = body + 8 + i * 8; if (at + 8 <= bodyEnd) { const hi = u32be(moov, at), lo = u32be(moov, at + 4); const val = hi * 2 ** 32 + lo + delta; v.setUint32(at, Math.floor(val / 2 ** 32)); v.setUint32(at + 4, val >>> 0); } }
      } else if (CONTAINER.has(c.type)) walk(body, bodyEnd);
    }
  };
  walk(0, moov.length);
}

/**
 * Return a new `moov` atom with the edits merged into its udta (©xyz location and friends), preserving everything
 * else. When `shiftChunks` is set (the moov sits before mdat, so changing its size moves the media), every stco/co64
 * offset is adjusted by the size change so playback still finds its samples.
 */
export function editBmffMoov(moov: Uint8Array, edits: MetaEdits, shiftChunks = false): Uint8Array {
  if (String.fromCharCode(moov[4], moov[5], moov[6], moov[7]) !== "moov") throw new Error("not a moov atom");
  const atoms = udtaAtomsFor(edits);
  const removeLocation = edits.location === null;
  const children = childBoxes(moov, 8, moov.length);
  const udta = children.find((c) => c.type === "udta");

  // Build the new udta payload: existing ©-atoms we are not touching, plus the edited ones.
  const keep: Uint8Array[] = [];
  const handled = new Set(Object.keys(atoms));
  if (removeLocation) handled.add("©xyz");
  if (udta) {
    for (const c of childBoxes(moov, udta.start + udta.head, udta.start + udta.size)) {
      if (handled.has(c.type)) continue; // replaced or removed below
      keep.push(moov.subarray(c.start, c.start + c.size));
    }
  }
  for (const [type, text] of Object.entries(atoms)) keep.push(udtaAtom(type, text));
  const newUdta = boxOf("udta", concat(keep));

  // Reassemble moov with udta replaced (or appended).
  const parts: Uint8Array[] = [];
  let hadUdta = false;
  for (const c of children) {
    if (c.type === "udta") { parts.push(newUdta); hadUdta = true; }
    else parts.push(moov.subarray(c.start, c.start + c.size));
  }
  if (!hadUdta) parts.push(newUdta);
  const bodyBytes = concat(parts);
  const newMoov = new Uint8Array(8 + bodyBytes.length);
  new DataView(newMoov.buffer).setUint32(0, newMoov.length);
  newMoov.set(latin1("moov"), 4);
  newMoov.set(bodyBytes, 8);

  if (shiftChunks) {
    const delta = newMoov.length - moov.length;
    if (delta !== 0) shiftChunkOffsets(newMoov, delta);
  }
  return newMoov;
}
