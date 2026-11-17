/**
 * Universal file-metadata reader — the pure half of the File Metadata Viewer.
 *
 * Any file is accepted. Every file gets the basics (name, size, type sniffed from its own bytes, last-modified,
 * SHA-256). Then, by type, as much as the bytes carry is decoded:
 *   • images — full EXIF (IFD0 + Exif + GPS + Interop, every tag and every TIFF type, rationals included), with GPS
 *     turned into real decimal coordinates; plus XMP and IPTC, reusing the provenance parsers;
 *   • MP4 / MOV / M4A / HEIC — the ISO-BMFF box tree: brand, duration, creation/modification time, track handlers and
 *     dimensions, the iTunes-style ©-atom tags, and Apple's ISO-6709 location;
 *   • MP3 and other ID3 files — ID3v2 text frames and GPS/other fields;
 *   • WAV / AVI — the RIFF INFO chunk;
 *   • PDF — handled in the widget through pdf.js (info dictionary + XMP), folded in here by `pdfGroup`.
 * The container, C2PA presence and AI-provenance read come from `scanFile`/`deriveSignals`, so the "AI involved?"
 * question is answered for every supported container, not only images.
 *
 * Everything here is deterministic and framework-free so it can be unit-tested in Node; nothing touches the DOM.
 */

import {
  deriveSignals,
  parseExif as parseExifBasic,
  parseIptc,
  scanFile,
  sha256Hex,
  summarizeXmp,
  type Container,
  type Located,
  type SignalReport,
  type TextEntry,
} from "@/lib/tools/image/provenance";

/* ───────────────────────── report shape ───────────────────────── */

export interface MetaEntry {
  label: string;
  value: string;
  /** A short gloss shown under the value (what the field means), optional. */
  hint?: string;
  /** A link the value points at (a map, a URL in the metadata), optional and always user-initiated. */
  href?: string;
}

export interface MetaGroup {
  /** e.g. "File", "Photo (EXIF)", "Location". */
  title: string;
  /** Where it came from, e.g. "EXIF · IFD0", "XMP", "ISO-BMFF". */
  source: string;
  entries: MetaEntry[];
}

export interface GpsFix {
  lat: number;
  lon: number;
  /** Metres above sea level, when present. */
  altitude?: number;
  /** A ready "lat, lon" string at 6 decimals. */
  text: string;
  /** An OpenStreetMap link centred on the fix. */
  map: string;
}

export interface MetaReport {
  name: string;
  size: number;
  /** The MIME the browser reported, or "" if it gave none. */
  declaredMime: string;
  sniff: SniffResult;
  sha256: string;
  lastModified: number | null;
  container: Container;
  gps: GpsFix | null;
  ai: SignalReport | null;
  groups: MetaGroup[];
  /** Every field, flattened, for "copy all as JSON". */
  flat: Record<string, string>;
}

/* ───────────────────────── byte helpers ───────────────────────── */

const tdLatin = new TextDecoder("latin1");
const tdUtf8 = new TextDecoder("utf-8", { fatal: false });
const ascii = (b: Uint8Array, o: number, n: number) => tdLatin.decode(b.subarray(o, o + n));
const u16be = (b: Uint8Array, o: number) => ((b[o] << 8) | b[o + 1]) >>> 0;
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u64be = (b: Uint8Array, o: number) => u32be(b, o) * 0x100000000 + u32be(b, o + 4);
const startsWith = (b: Uint8Array, sig: number[] | string, o = 0) => {
  const s = typeof sig === "string" ? [...sig].map((c) => c.charCodeAt(0)) : sig;
  return b.length >= o + s.length && s.every((v, i) => b[o + i] === v);
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)} ${u[i]}`;
}

/* ───────────────────────── type sniffing ───────────────────────── */

export interface SniffResult {
  /** A short label, e.g. "JPEG image", "MP4 / QuickTime video", "PDF document". */
  label: string;
  mime: string;
  /** Common extension without the dot, "" if unknown. */
  ext: string;
  kind: "image" | "video" | "audio" | "document" | "archive" | "font" | "text" | "data";
}

const UNKNOWN: SniffResult = { label: "Unknown / unrecognised", mime: "application/octet-stream", ext: "", kind: "data" };

/** Detect a file's type from its own bytes (magic numbers), independent of the name. */
export function sniffType(b: Uint8Array, name = ""): SniffResult {
  const ftyp = b.length >= 12 && ascii(b, 4, 4) === "ftyp" ? ascii(b, 8, 4).trim() : null;
  if (ftyp) {
    const brand = ftyp.toLowerCase();
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1)/.test(brand))
      return { label: "HEIF / HEIC image", mime: "image/heic", ext: "heic", kind: "image" };
    if (brand.startsWith("avif") || brand.startsWith("avis"))
      return { label: "AVIF image", mime: "image/avif", ext: "avif", kind: "image" };
    if (brand.startsWith("m4a")) return { label: "M4A audio (MPEG-4)", mime: "audio/mp4", ext: "m4a", kind: "audio" };
    if (brand.startsWith("qt")) return { label: "QuickTime video", mime: "video/quicktime", ext: "mov", kind: "video" };
    return { label: `MP4 / ISO-BMFF video (${ftyp})`, mime: "video/mp4", ext: "mp4", kind: "video" };
  }
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { label: "JPEG image", mime: "image/jpeg", ext: "jpg", kind: "image" };
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { label: "PNG image", mime: "image/png", ext: "png", kind: "image" };
  if (startsWith(b, "GIF87a") || startsWith(b, "GIF89a")) return { label: "GIF image", mime: "image/gif", ext: "gif", kind: "image" };
  if (startsWith(b, "BM")) return { label: "BMP image", mime: "image/bmp", ext: "bmp", kind: "image" };
  if (startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a]))
    return { label: "TIFF image", mime: "image/tiff", ext: "tif", kind: "image" };
  if (startsWith(b, "RIFF") && b.length >= 12) {
    const form = ascii(b, 8, 4);
    if (form === "WEBP") return { label: "WebP image", mime: "image/webp", ext: "webp", kind: "image" };
    if (form === "WAVE") return { label: "WAV audio", mime: "audio/wav", ext: "wav", kind: "audio" };
    if (form === "AVI ") return { label: "AVI video", mime: "video/x-msvideo", ext: "avi", kind: "video" };
    return { label: `RIFF container (${form.trim()})`, mime: "application/octet-stream", ext: "", kind: "data" };
  }
  if (startsWith(b, "%PDF")) return { label: "PDF document", mime: "application/pdf", ext: "pdf", kind: "document" };
  if (startsWith(b, "ID3") || startsWith(b, [0xff, 0xfb]) || startsWith(b, [0xff, 0xf3]) || startsWith(b, [0xff, 0xf2]))
    return { label: "MP3 audio", mime: "audio/mpeg", ext: "mp3", kind: "audio" };
  if (startsWith(b, "fLaC")) return { label: "FLAC audio", mime: "audio/flac", ext: "flac", kind: "audio" };
  if (startsWith(b, "OggS")) return { label: "Ogg (Vorbis / Opus / Theora)", mime: "application/ogg", ext: "ogg", kind: "audio" };
  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) return { label: "Matroska / WebM", mime: "video/webm", ext: "webm", kind: "video" };
  if (startsWith(b, "PK\x03\x04") || startsWith(b, "PK\x05\x06")) {
    const low = name.toLowerCase();
    if (low.endsWith(".docx")) return { label: "Word document (OOXML)", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx", kind: "document" };
    if (low.endsWith(".xlsx")) return { label: "Excel workbook (OOXML)", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx", kind: "document" };
    if (low.endsWith(".pptx")) return { label: "PowerPoint (OOXML)", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ext: "pptx", kind: "document" };
    if (low.endsWith(".epub")) return { label: "EPUB book", mime: "application/epub+zip", ext: "epub", kind: "document" };
    return { label: "ZIP archive", mime: "application/zip", ext: "zip", kind: "archive" };
  }
  if (startsWith(b, [0x1f, 0x8b])) return { label: "Gzip archive", mime: "application/gzip", ext: "gz", kind: "archive" };
  if (startsWith(b, "7z\xbc\xaf\x27\x1c")) return { label: "7-Zip archive", mime: "application/x-7z-compressed", ext: "7z", kind: "archive" };
  if (startsWith(b, "Rar!")) return { label: "RAR archive", mime: "application/vnd.rar", ext: "rar", kind: "archive" };
  if (startsWith(b, [0x00, 0x01, 0x00, 0x00, 0x00]) || startsWith(b, "OTTO")) return { label: "Font (TrueType / OpenType)", mime: "font/sfnt", ext: "ttf", kind: "font" };
  if (startsWith(b, "wOF2")) return { label: "WOFF2 font", mime: "font/woff2", ext: "woff2", kind: "font" };
  if (startsWith(b, "wOFF")) return { label: "WOFF font", mime: "font/woff", ext: "woff", kind: "font" };
  if (startsWith(b, "<?xml") || startsWith(b, "<svg")) {
    if (/<svg[\s>]/i.test(ascii(b, 0, Math.min(b.length, 512)))) return { label: "SVG image", mime: "image/svg+xml", ext: "svg", kind: "image" };
    return { label: "XML document", mime: "application/xml", ext: "xml", kind: "text" };
  }
  if (startsWith(b, "%!PS")) return { label: "PostScript", mime: "application/postscript", ext: "ps", kind: "document" };
  if (looksLikeText(b)) return { label: "Plain text", mime: "text/plain", ext: "txt", kind: "text" };
  return UNKNOWN;
}

function looksLikeText(b: Uint8Array): boolean {
  const n = Math.min(b.length, 2048);
  if (n === 0) return false;
  let printable = 0;
  for (let i = 0; i < n; i++) {
    const c = b[i];
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) printable++;
    else if (c === 0) return false;
  }
  return printable / n > 0.85;
}

/* ───────────────────────── EXIF (full, with GPS) ───────────────────────── */

const IFD0_TAGS: Record<number, string> = {
  0x0100: "Image width",
  0x0101: "Image height",
  0x0102: "Bits per sample",
  0x0103: "Compression",
  0x010e: "Description",
  0x010f: "Make",
  0x0110: "Model",
  0x0112: "Orientation",
  0x011a: "X resolution",
  0x011b: "Y resolution",
  0x0128: "Resolution unit",
  0x0131: "Software",
  0x0132: "Modified",
  0x013b: "Artist",
  0x013e: "White point",
  0x0211: "YCbCr coefficients",
  0x8298: "Copyright",
  0x9c9b: "XP title",
  0x9c9c: "XP comment",
  0x9c9d: "XP author",
  0x9c9e: "XP keywords",
  0x9c9f: "XP subject",
};

const EXIF_TAGS: Record<number, string> = {
  0x829a: "Exposure time",
  0x829d: "F-number",
  0x8822: "Exposure program",
  0x8827: "ISO",
  0x8830: "Sensitivity type",
  0x9000: "Exif version",
  0x9003: "Taken",
  0x9004: "Digitised",
  0x9010: "Offset time",
  0x9201: "Shutter speed",
  0x9202: "Aperture",
  0x9204: "Exposure bias",
  0x9205: "Max aperture",
  0x9207: "Metering mode",
  0x9208: "Light source",
  0x9209: "Flash",
  0x920a: "Focal length",
  0x9286: "User comment",
  0xa001: "Colour space",
  0xa002: "Pixel X",
  0xa003: "Pixel Y",
  0xa402: "Exposure mode",
  0xa403: "White balance",
  0xa405: "Focal length (35mm)",
  0xa406: "Scene type",
  0xa432: "Lens spec",
  0xa433: "Lens make",
  0xa434: "Lens model",
  0xa435: "Lens serial",
  0xa420: "Image unique ID",
  0x9290: "Subsecond",
  0xa430: "Camera owner",
  0xa431: "Body serial",
};

const GPS_TAGS: Record<number, string> = {
  0x0000: "GPS version",
  0x0001: "Lat ref",
  0x0002: "Latitude",
  0x0003: "Lon ref",
  0x0004: "Longitude",
  0x0005: "Alt ref",
  0x0006: "Altitude",
  0x0007: "GPS time",
  0x0008: "Satellites",
  0x0009: "GPS status",
  0x000b: "Precision (DOP)",
  0x000c: "Speed ref",
  0x000d: "Speed",
  0x0010: "Direction ref",
  0x0011: "Direction",
  0x001d: "GPS date",
  0x001b: "Processing method",
};

const ORIENTATIONS: Record<string, string> = {
  "1": "normal",
  "2": "flipped horizontally",
  "3": "rotated 180°",
  "4": "flipped vertically",
  "5": "transposed",
  "6": "rotated 90° CW",
  "7": "transverse",
  "8": "rotated 90° CCW",
};

export interface ExifResult {
  ifd0: Record<string, string>;
  exif: Record<string, string>;
  gps: Record<string, string>;
  fix: GpsFix | null;
}

type Rat = { num: number; den: number };

/** A complete TIFF/EXIF walk: every tag of IFD0, the Exif and GPS sub-IFDs, all types, rationals decoded. */
export function readExif(tiff: Uint8Array): ExifResult {
  const out: ExifResult = { ifd0: {}, exif: {}, gps: {}, fix: null };
  if (tiff.length < 8) return out;
  const le = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!le && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return out;
  const r16 = (o: number) => (o + 2 > tiff.length ? 0 : le ? tiff[o] | (tiff[o + 1] << 8) : u16be(tiff, o));
  const r32 = (o: number) =>
    o + 4 > tiff.length ? 0 : le ? ((tiff[o] | (tiff[o + 1] << 8) | (tiff[o + 2] << 16) | (tiff[o + 3] << 24)) >>> 0) : u32be(tiff, o);
  const s32 = (o: number) => (r32(o) | 0);
  const typeSize = (t: number) => ([0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8][t] ?? 0);

  const readValues = (type: number, count: number, off: number): { strings: string[]; rats: Rat[]; nums: number[] } => {
    const strings: string[] = [];
    const rats: Rat[] = [];
    const nums: number[] = [];
    const size = typeSize(type) * count;
    if (size <= 0 || off + size > tiff.length) return { strings, rats, nums };
    if (type === 2) {
      strings.push(tdUtf8.decode(tiff.subarray(off, off + count)).replace(/\0+$/g, "").trim());
    } else if (type === 7) {
      strings.push(ascii(tiff, off, count).replace(/\0+$/g, "").trim());
    } else {
      for (let i = 0; i < count; i++) {
        const p = off + i * typeSize(type);
        if (type === 1 || type === 6) nums.push(tiff[p]);
        else if (type === 3) nums.push(r16(p));
        else if (type === 4) nums.push(r32(p));
        else if (type === 8) nums.push((r16(p) << 16) >> 16);
        else if (type === 9) nums.push(s32(p));
        else if (type === 5) rats.push({ num: r32(p), den: r32(p + 4) });
        else if (type === 10) rats.push({ num: s32(p), den: s32(p + 4) });
      }
    }
    return { strings, rats, nums };
  };

  const fmtRat = (r: Rat) => (r.den === 0 ? "0" : trimNum(r.num / r.den));
  const gpsRats: Record<number, Rat[]> = {};
  const gpsStr: Record<number, string> = {};
  const gpsNum: Record<number, number[]> = {};

  const readIfd = (ifd: number, which: "ifd0" | "exif" | "gps", depth: number) => {
    if (ifd < 8 || ifd + 2 > tiff.length || depth > 3) return;
    const n = r16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > tiff.length) break;
      const tag = r16(e);
      const type = r16(e + 2);
      const count = r32(e + 4);
      const size = typeSize(type) * count;
      const off = size <= 4 ? e + 8 : r32(e + 8);
      if (which === "ifd0" && tag === 0x8769) {
        readIfd(r32(e + 8), "exif", depth + 1);
        continue;
      }
      if (which === "ifd0" && tag === 0x8825) {
        readIfd(r32(e + 8), "gps", depth + 1);
        continue;
      }
      if (tag === 0xa005) continue; // Interop pointer — skip, little of interest
      const { strings, rats, nums } = readValues(type, count, off);
      if (which === "gps") {
        if (rats.length) gpsRats[tag] = rats;
        if (strings.length) gpsStr[tag] = strings[0];
        if (nums.length) gpsNum[tag] = nums;
      }
      const dict = which === "gps" ? GPS_TAGS : which === "exif" ? EXIF_TAGS : IFD0_TAGS;
      const name = dict[tag];
      if (!name) continue;
      let value: string;
      if (strings.length) value = strings.join("");
      else if (rats.length) value = rats.map(fmtRat).join(", ");
      else if (nums.length) value = nums.join(", ");
      else continue;
      value = decorate(tag, which, value);
      if (!value) continue;
      const target = which === "ifd0" ? out.ifd0 : which === "exif" ? out.exif : out.gps;
      target[name] = value;
    }
  };

  readIfd(r32(4), "ifd0", 0);
  out.fix = gpsFix(gpsRats, gpsStr, gpsNum);
  return out;
}

function decorate(tag: number, which: string, value: string): string {
  if (which === "ifd0" && tag === 0x0112) return `${value} (${ORIENTATIONS[value] ?? "?"})`;
  if (which === "exif" && tag === 0x829a) {
    const v = Number(value.split(",")[0]);
    if (v > 0 && v < 1) return `${value} s (1/${Math.round(1 / v)})`;
    return `${value} s`;
  }
  if (which === "exif" && tag === 0x829d) return `ƒ/${value}`;
  if (which === "exif" && tag === 0x920a) return `${value} mm`;
  if (which === "exif" && (tag === 0x9c9b || tag === 0x9c9c || tag === 0x9c9d || tag === 0x9c9e || tag === 0x9c9f)) return value; // XP* already decoded elsewhere
  return value;
}

function trimNum(n: number): string {
  if (!isFinite(n)) return "0";
  return String(Math.round(n * 1000) / 1000);
}

/** Turn the GPS sub-IFD rationals into a decimal fix. */
function gpsFix(rats: Record<number, Rat[]>, strs: Record<number, string>, nums: Record<number, number[]> = {}): GpsFix | null {
  const dms = (parts: Rat[] | undefined): number | null => {
    if (!parts || parts.length < 3) return null;
    const [d, m, s] = parts.map((r) => (r.den === 0 ? 0 : r.num / r.den));
    return d + m / 60 + s / 3600;
  };
  const latMag = dms(rats[0x0002]);
  const lonMag = dms(rats[0x0004]);
  if (latMag === null || lonMag === null) return null;
  const latRef = (strs[0x0001] || "N").toUpperCase().trim();
  const lonRef = (strs[0x0003] || "E").toUpperCase().trim();
  const lat = latRef.startsWith("S") ? -latMag : latMag;
  const lon = lonRef.startsWith("W") ? -lonMag : lonMag;
  if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) return null;
  const altR = rats[0x0006]?.[0];
  let altitude = altR && altR.den !== 0 ? altR.num / altR.den : undefined;
  // GPSAltitudeRef: 1 means below sea level, so the stored magnitude is negated.
  if (altitude != null && nums[0x0005]?.[0] === 1) altitude = -altitude;
  const latS = lat.toFixed(6);
  const lonS = lon.toFixed(6);
  return {
    lat,
    lon,
    altitude,
    text: `${latS}, ${lonS}`,
    map: `https://www.openstreetmap.org/?mlat=${latS}&mlon=${lonS}#map=15/${latS}/${lonS}`,
  };
}

/* ───────────────────────── ISO-BMFF (MP4 / MOV / M4A / HEIC) ───────────────────────── */

export interface BmffMeta {
  brand: string;
  compatible: string[];
  durationSec: number | null;
  created: string | null;
  modified: string | null;
  tracks: { kind: string; label: string; width?: number; height?: number }[];
  tags: Record<string, string>;
  fix: GpsFix | null;
}

// Mac/QuickTime epoch is 1904-01-01; seconds since then.
const MAC_EPOCH = -2082844800;
const macTime = (s: number): string | null => (s > 0 ? new Date((s + MAC_EPOCH) * 1000).toISOString() : null);

const ILST_ATOMS: Record<string, string> = {
  "©nam": "Title",
  "©ART": "Artist",
  aART: "Album artist",
  "©alb": "Album",
  "©gen": "Genre",
  gnre: "Genre",
  "©day": "Year",
  "©cmt": "Comment",
  "©too": "Encoder",
  "©wrt": "Writer",
  "©dir": "Director",
  desc: "Description",
  ldes: "Long description",
  "©xyz": "Location",
  cprt: "Copyright",
  "©cpy": "Copyright",
  keyw: "Keywords",
};

/** Walk the ISO-BMFF box tree for the fields people care about; tolerant of truncation. */
export function readBmff(b: Uint8Array): BmffMeta {
  const meta: BmffMeta = { brand: "", compatible: [], durationSec: null, created: null, modified: null, tracks: [], tags: {}, fix: null };
  const end = b.length;

  const walk = (start: number, stop: number, depth: number, path: string) => {
    let o = start;
    while (o + 8 <= stop) {
      let size = u32be(b, o);
      let head = 8;
      const type = ascii(b, o + 4, 4);
      if (size === 1) {
        if (o + 16 > stop) break;
        size = u64be(b, o + 8);
        head = 16;
      } else if (size === 0) size = stop - o;
      if (size < head || o + size > stop) break;
      const body = o + head;
      const bodyEnd = o + size;
      onBox(type, body, bodyEnd, path);
      if (CONTAINER.has(type)) walk(body, bodyEnd, depth + 1, `${path}/${type}`);
      else if (type === "meta") walk(body + 4, bodyEnd, depth + 1, `${path}/meta`); // meta is a fullbox
      o = bodyEnd;
    }
  };

  const keys: string[] = []; // Apple 'keys' box (for the mdta namespace in ilst)
  const onBox = (type: string, body: number, bodyEnd: number, path: string) => {
    if (type === "ftyp" && bodyEnd - body >= 8) {
      meta.brand = ascii(b, body, 4).trim();
      for (let p = body + 8; p + 4 <= bodyEnd; p += 4) meta.compatible.push(ascii(b, p, 4).trim());
    } else if (type === "mvhd") {
      const ver = b[body];
      if (ver === 1 && bodyEnd - body >= 28) {
        meta.created = macTime(u64be(b, body + 4));
        meta.modified = macTime(u64be(b, body + 12));
        const ts = u32be(b, body + 20);
        const dur = u64be(b, body + 24);
        if (ts) meta.durationSec = dur / ts;
      } else if (bodyEnd - body >= 16) {
        meta.created = macTime(u32be(b, body + 4));
        meta.modified = macTime(u32be(b, body + 8));
        const ts = u32be(b, body + 12);
        const dur = u32be(b, body + 16);
        if (ts) meta.durationSec = dur / ts;
      }
    } else if (type === "hdlr" && bodyEnd - body >= 12) {
      const h = ascii(b, body + 8, 4);
      const kind = h === "vide" ? "Video" : h === "soun" ? "Sound" : h === "pict" || h === "pcst" ? "Picture" : h === "subt" || h === "sbtl" || h === "text" ? "Text" : h === "meta" ? "Metadata" : h;
      if (path.endsWith("/trak/mdia")) meta.tracks.push({ kind: h, label: kind });
    } else if (type === "tkhd") {
      const ver = b[body];
      const w = ver === 1 ? body + 96 : body + 84;
      if (w + 8 <= bodyEnd) {
        const width = u16be(b, w);
        const height = u16be(b, w + 4);
        const t = meta.tracks[meta.tracks.length - 1];
        if (t && width && height && !t.width) {
          t.width = width;
          t.height = height;
        }
      }
    } else if (type === "keys") {
      let p = body + 8;
      while (p + 8 <= bodyEnd) {
        const ksize = u32be(b, p);
        if (ksize < 8 || p + ksize > bodyEnd) break;
        keys.push(ascii(b, p + 8, ksize - 8));
        p += ksize;
      }
    } else if (type === "ilst") {
      readIlst(b, body, bodyEnd, keys, meta);
    } else if (path.endsWith("/udta") && type.charCodeAt(0) === 0xa9) {
      // QuickTime udta ©-atoms: a (u16 length, u16 language, text) entry. ©xyz carries the ISO-6709 location.
      const label = UDTA_ATOMS[type];
      if (label && bodyEnd - body >= 4) {
        const len = u16be(b, body);
        const text = len > 0 && body + 4 + len <= bodyEnd ? tdUtf8.decode(b.subarray(body + 4, body + 4 + len)).replace(/\0+$/g, "").trim() : tdUtf8.decode(b.subarray(body, bodyEnd)).replace(/\0+$/g, "").trim();
        if (text && meta.tags[label] == null) meta.tags[label] = text;
        if (type === "©xyz" && text) meta.fix = parseIso6709(text) ?? meta.fix;
      }
    }
  };

  try {
    walk(0, end, 0, "");
  } catch {
    /* tolerate malformed trailers */
  }
  if (meta.tags["Location"]) meta.fix = parseIso6709(meta.tags["Location"]);
  return meta;
}

const CONTAINER = new Set(["moov", "trak", "mdia", "minf", "stbl", "udta", "edts", "mvex", "moof", "traf"]);

/** QuickTime udta ©-atoms we surface (the © is U+00A9). ©xyz is the ISO-6709 location DJI/Android write. */
const UDTA_ATOMS: Record<string, string> = {
  "©xyz": "Location",
  "©nam": "Title",
  "©ART": "Artist",
  "©cmt": "Comment",
  "©day": "Date",
};

function readIlst(b: Uint8Array, start: number, stop: number, keys: string[], meta: BmffMeta) {
  let o = start;
  while (o + 8 <= stop) {
    const size = u32be(b, o);
    if (size < 8 || o + size > stop) break;
    const atom = ascii(b, o + 4, 4);
    // data box inside
    let label: string | null = ILST_ATOMS[atom] ?? null;
    if (atom === "----" || /^�/.test(atom) || atom.charCodeAt(0) === 0) label = null;
    // Apple mdta: the atom name is an index into 'keys'
    const asIndex = parseInt(atom.replace(/[^0-9]/g, ""), 10);
    if (!label && keys.length && Number.isFinite(asIndex) && asIndex >= 1 && asIndex <= keys.length) {
      const full = keys[asIndex - 1];
      label = mdtaLabel(full);
    }
    // find the 'data' child
    let p = o + 8;
    while (p + 8 <= o + size) {
      const dsize = u32be(b, p);
      const dtype = ascii(b, p + 4, 4);
      if (dsize < 8 || p + dsize > o + size) break;
      if (dtype === "data" && dsize >= 16) {
        const dataType = u32be(b, p + 8);
        const payload = b.subarray(p + 16, p + dsize);
        const value = dataType === 0 || dataType === 21 ? binTag(atom, payload) : tdUtf8.decode(payload).replace(/\0+$/g, "").trim();
        if (label && value) meta.tags[label] = value;
        break;
      }
      p += dsize;
    }
    o += size;
  }
}

function mdtaLabel(full: string): string {
  const key = full.split(".").pop() ?? full;
  const map: Record<string, string> = {
    "location.ISO6709": "Location",
    make: "Make",
    model: "Model",
    software: "Software",
    "creationdate": "Created",
    title: "Title",
    description: "Description",
    author: "Author",
    "camera.identifier": "Camera",
    "camera.lens_model": "Lens",
  };
  return map[key] ?? key;
}

function binTag(atom: string, payload: Uint8Array): string {
  if (atom === "gnre" && payload.length >= 2) return `genre #${u16be(payload, 0)}`;
  if ((atom === "trkn" || atom === "disk") && payload.length >= 6) return `${u16be(payload, 2)} of ${u16be(payload, 4)}`;
  if (payload.length <= 4) {
    let n = 0;
    for (const x of payload) n = (n << 8) | x;
    return String(n);
  }
  return tdUtf8.decode(payload).replace(/\0+$/g, "").trim();
}

/** ISO-6709 like "+35.6895+139.6917+012.000/" → a fix. */
export function parseIso6709(s: string): GpsFix | null {
  const m = /([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)(?:([+-]\d+(?:\.\d+)?))?/.exec(s.trim());
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!isFinite(lat) || !isFinite(lon)) return null;
  const altitude = m[3] !== undefined ? Number(m[3]) : undefined;
  const latS = lat.toFixed(6);
  const lonS = lon.toFixed(6);
  return { lat, lon, altitude, text: `${latS}, ${lonS}`, map: `https://www.openstreetmap.org/?mlat=${latS}&mlon=${lonS}#map=15/${latS}/${lonS}` };
}

/* ───────────────────────── ID3v2 (MP3 and others) ───────────────────────── */

const ID3_FRAMES: Record<string, string> = {
  TIT2: "Title",
  TPE1: "Artist",
  TPE2: "Album artist",
  TALB: "Album",
  TCON: "Genre",
  TYER: "Year",
  TDRC: "Recorded",
  TRCK: "Track",
  TPOS: "Disc",
  TCOM: "Composer",
  TPUB: "Publisher",
  TENC: "Encoder",
  TSSE: "Encoder settings",
  COMM: "Comment",
  TCOP: "Copyright",
  TLEN: "Length (ms)",
  TBPM: "BPM",
  WXXX: "URL",
  APIC: "Cover art",
};

export function readId3(b: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  if (!startsWith(b, "ID3")) return out;
  const major = b[3];
  const size = synch(b, 6);
  const end = Math.min(b.length, 10 + size);
  let o = 10;
  const frameHeader = major >= 3 ? 10 : 6;
  while (o + frameHeader <= end) {
    const id = major >= 3 ? ascii(b, o, 4) : ascii(b, o, 3);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const fsize = major >= 4 ? synch(b, o + 4) : major === 3 ? u32be(b, o + 4) : (b[o + 3] << 16) | (b[o + 4] << 8) | b[o + 5];
    const body = o + frameHeader;
    if (fsize <= 0 || body + fsize > end) break;
    const name = ID3_FRAMES[id] ?? ID3_FRAMES[id.slice(0, 4)];
    if (name && id !== "APIC") {
      const value = id.startsWith("T") || id === "COMM" || id === "WXXX" ? decodeId3Text(b.subarray(body, body + fsize), id) : "";
      if (value) out[name] = value;
    } else if (id === "APIC" || name === "Cover art") {
      out["Cover art"] = `${formatBytes(fsize)} embedded`;
    }
    o = body + fsize;
  }
  return out;
}

function synch(b: Uint8Array, o: number): number {
  return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
}

function decodeId3Text(frame: Uint8Array, id: string): string {
  if (frame.length < 1) return "";
  const enc = frame[0];
  let body = frame.subarray(1);
  // COMM/WXXX carry a language / description before the text; keep it simple and take the last NUL-run segment.
  if (id === "COMM") body = body.subarray(3);
  let text: string;
  if (enc === 1 || enc === 2) text = new TextDecoder(enc === 1 ? "utf-16" : "utf-16be").decode(body);
  else if (enc === 3) text = tdUtf8.decode(body);
  else text = tdLatin.decode(body);
  return text.replace(/\0/g, " ").trim();
}

/* ───────────────────────── RIFF INFO (WAV / AVI) ───────────────────────── */

const RIFF_INFO: Record<string, string> = {
  INAM: "Title",
  IART: "Artist",
  IPRD: "Album",
  IGNR: "Genre",
  ICRD: "Created",
  ICMT: "Comment",
  ISFT: "Software",
  ICOP: "Copyright",
  IENG: "Engineer",
  ITCH: "Technician",
  IKEY: "Keywords",
  ISRC: "Source",
};

export function readRiffInfo(b: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  if (!startsWith(b, "RIFF") || b.length < 12) return out;
  const total = Math.min(b.length, u32beLE(b, 4) + 8);
  let o = 12;
  while (o + 8 <= total) {
    const id = ascii(b, o, 4);
    const size = u32beLE(b, o + 4);
    const body = o + 8;
    if (body + size > total + 8) break;
    if (id === "LIST" && ascii(b, body, 4) === "INFO") {
      let p = body + 4;
      const listEnd = body + size;
      while (p + 8 <= listEnd) {
        const sub = ascii(b, p, 4);
        const ssize = u32beLE(b, p + 4);
        if (p + 8 + ssize > listEnd) break;
        const name = RIFF_INFO[sub];
        if (name) {
          const v = tdUtf8.decode(b.subarray(p + 8, p + 8 + ssize)).replace(/\0+$/g, "").trim();
          if (v) out[name] = v;
        }
        p += 8 + ssize + (ssize & 1);
      }
    }
    o = body + size + (size & 1);
  }
  return out;
}

const u32beLE = (b: Uint8Array, o: number) => ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0);

/* ───────────────────────── assembly ───────────────────────── */

function pushGroup(groups: MetaGroup[], title: string, source: string, rec: Record<string, string>, hints: Record<string, string> = {}) {
  const entries = Object.entries(rec)
    .filter(([, v]) => v !== "" && v != null)
    .map(([label, value]) => ({ label, value, hint: hints[label] }));
  if (entries.length) groups.push({ title, source, entries });
}

export interface PdfMeta {
  info: Record<string, string>;
  pages?: number;
  pageSize?: string;
  xmp?: Record<string, string>;
}

/** A group for PDF facts the widget pulled with pdf.js (so the pure module needs no DOM). */
export function pdfGroups(pdf: PdfMeta): MetaGroup[] {
  const groups: MetaGroup[] = [];
  const info = { ...pdf.info };
  if (pdf.pages != null) info["Pages"] = String(pdf.pages);
  if (pdf.pageSize) info["First page size"] = pdf.pageSize;
  pushGroup(groups, "Document (PDF)", "PDF info dictionary", info);
  if (pdf.xmp) pushGroup(groups, "PDF XMP", "XMP packet", pdf.xmp);
  return groups;
}

/**
 * Read everything that can be read from the bytes alone. The widget adds the PDF group (pdf.js) and image pixel
 * dimensions on top, since those need the browser.
 */
export async function readAll(
  input: { name: string; size: number; type: string; lastModified: number | null },
  bytes: Uint8Array,
  opts?: { sha256?: string },
): Promise<MetaReport> {
  const sniff = sniffType(bytes, input.name);
  const [located, sha256] = await Promise.all([safeScan(bytes), opts?.sha256 ? Promise.resolve(opts.sha256) : sha256Hex(bytes)]);
  const groups: MetaGroup[] = [];
  let gps: GpsFix | null = null;

  // Universal basics.
  pushGroup(
    groups,
    "File",
    "Basics",
    {
      Name: input.name || "(unnamed)",
      Size: `${formatBytes(input.size)} (${input.size.toLocaleString()} bytes)`,
      "Detected type": `${sniff.label}${sniff.ext ? ` · .${sniff.ext}` : ""}`,
      "Detected MIME": sniff.mime,
      "Browser-reported type": input.type || "(none)",
      "Last modified": input.lastModified ? new Date(input.lastModified).toISOString() : "(not provided)",
      "SHA-256": sha256,
    },
    {
      "Detected type": "From the file's own bytes (magic number), not its name.",
      "Browser-reported type": input.type && sniff.mime && input.type !== sniff.mime ? "Differs from the detected type — the extension may be wrong." : undefined as unknown as string,
    },
  );

  // EXIF / XMP / IPTC from the located container (images, TIFF, and some others).
  const exifRec = located?.metadata.exif ? readExif(located.metadata.exif) : null;
  if (exifRec) {
    pushGroup(groups, "Photo (EXIF)", "EXIF · IFD0 + Exif", { ...exifRec.ifd0, ...exifRec.exif });
    if (Object.keys(exifRec.gps).length) pushGroup(groups, "GPS tags", "EXIF · GPS IFD", exifRec.gps);
    if (exifRec.fix) gps = exifRec.fix;
  }
  const xmp = located?.metadata.xmp ? summarizeXmp(located.metadata.xmp) : {};
  if (Object.keys(xmp).length) pushGroup(groups, "XMP", "XMP packet", xmp);
  const iptc = located?.metadata.iptc ? parseIptc(located.metadata.iptc) : {};
  if (Object.keys(iptc).length) pushGroup(groups, "IPTC", "IPTC-IIM", iptc);

  // Container-specific decoders by sniffed kind.
  if (sniff.ext === "mp4" || sniff.ext === "mov" || sniff.ext === "m4a" || sniff.ext === "heic" || sniff.ext === "avif") {
    const m = readBmff(bytes);
    const head: Record<string, string> = {
      Brand: m.brand || "",
      "Compatible brands": m.compatible.filter(Boolean).join(", "),
      Duration: m.durationSec != null ? `${m.durationSec.toFixed(2)} s` : "",
      Created: m.created ?? "",
      Modified: m.modified ?? "",
    };
    m.tracks.forEach((t, i) => (head[`Track ${i + 1}`] = `${t.label}${t.width ? ` · ${t.width}×${t.height}` : ""}`));
    pushGroup(groups, sniff.kind === "audio" ? "Audio container" : "Video container", "ISO-BMFF", head);
    pushGroup(groups, "Media tags", "iTunes-style atoms", m.tags);
    if (!gps && m.fix) gps = m.fix;
  } else if (sniff.ext === "mp3") {
    pushGroup(groups, "Audio tags", "ID3v2", readId3(bytes));
  } else if (sniff.ext === "wav" || sniff.ext === "avi") {
    pushGroup(groups, sniff.ext === "wav" ? "Audio tags" : "Video tags", "RIFF INFO", readRiffInfo(bytes));
  }

  // Any URLs / text notes the container carried (PNG tEXt, GIF comments, etc.).
  if (located?.metadata.text.length) {
    const rec: Record<string, string> = {};
    for (const t of located.metadata.text) rec[`${t.key} (${t.where})`] = t.value;
    pushGroup(groups, "Embedded text", "Container", rec);
  }

  // AI / Content Credentials — for every container the scanner understands.
  let ai: SignalReport | null = null;
  if (located && located.container !== "unknown") {
    ai = deriveSignals({
      exif: exifRec ? { ...exifRec.ifd0, ...exifRec.exif } : located.metadata.exif ? parseExifBasic(located.metadata.exif) : {},
      xmp,
      iptc,
      text: located.metadata.text,
      manifest: located.jumbf ? { claimGenerators: [], softwareAgents: [], digitalSourceTypes: [], actions: [], hasCredentials: true } : null,
    });
  }

  return {
    name: input.name,
    size: input.size,
    declaredMime: input.type,
    sniff,
    sha256,
    lastModified: input.lastModified,
    container: located?.container ?? "unknown",
    gps,
    ai,
    groups,
    flat: flatten(groups),
  };
}

async function safeScan(bytes: Uint8Array): Promise<Located | null> {
  try {
    return await scanFile(bytes);
  } catch {
    return null;
  }
}

function flatten(groups: MetaGroup[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of groups) for (const e of g.entries) out[`${g.title} · ${e.label}`] = e.value;
  return out;
}

export type { Container, TextEntry };
