// Read, edit and write a TIFF/EXIF block. The same bytes go into a JPEG APP1 segment, a PNG `eXIf` chunk and a
// WebP `EXIF` chunk — all three carry a bare EXIF/TIFF. Editing preserves every tag the file already had (camera
// exposure, lens, the lot): the existing TIFF is parsed into entries, only the edited tags are set or the GPS IFD
// replaced, and it is re-serialised big-endian. The reader in metadata.ts (readExif) is the oracle for the tests.

/** The fields a user can set that live in EXIF. All optional; only the given ones are written. */
export interface ExifFields {
  make?: string;
  model?: string;
  software?: string;
  artist?: string;
  copyright?: string;
  description?: string;
  /** EXIF DateTime, "YYYY:MM:DD HH:MM:SS". */
  dateTime?: string;
  /** GPS fix in decimal degrees (altitude in metres); null removes the GPS IFD, undefined leaves it untouched. */
  gps?: { lat: number; lon: number; altitude?: number } | null;
}

const ASCII = 2, BYTE = 1, LONG = 4, RATIONAL = 5;
const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
/** Bytes per swappable unit for endianness normalisation (RATIONAL is two 4-byte ints). */
const swapUnit = (type: number) => (type === 3 || type === 8 ? 2 : type === 4 || type === 9 || type === 11 || type === 5 || type === 10 ? 4 : type === 12 ? 8 : 1);

/** One IFD entry with its value already in big-endian bytes. */
interface RawEntry {
  tag: number;
  type: number;
  count: number;
  data: Uint8Array;
}
interface Parsed {
  ifd0: RawEntry[];
  exif: RawEntry[];
  gps: RawEntry[];
}

const EXIF_PTR = 0x8769, GPS_PTR = 0x8825;

/* ───────────────────────── parse an existing TIFF ───────────────────────── */

/** Parse a TIFF/EXIF block into IFD0 / Exif / GPS entries, values normalised to big-endian; {} on anything odd. */
export function parseTiff(tiff: Uint8Array): Parsed {
  const out: Parsed = { ifd0: [], exif: [], gps: [] };
  if (tiff.length < 8) return out;
  const le = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!le && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return out;
  const r16 = (o: number) => (le ? tiff[o] | (tiff[o + 1] << 8) : (tiff[o] << 8) | tiff[o + 1]);
  const r32 = (o: number) => (le ? (tiff[o] | (tiff[o + 1] << 8) | (tiff[o + 2] << 16) | (tiff[o + 3] << 24)) >>> 0 : ((tiff[o] << 24) | (tiff[o + 1] << 16) | (tiff[o + 2] << 8) | tiff[o + 3]) >>> 0);

  const normalize = (src: Uint8Array, type: number): Uint8Array => {
    const unit = swapUnit(type);
    if (unit === 1 || !le) return src.slice(); // already big-endian or byte-wise
    const out = new Uint8Array(src.length);
    for (let i = 0; i + unit <= src.length; i += unit) for (let k = 0; k < unit; k++) out[i + k] = src[i + unit - 1 - k];
    return out;
  };

  const readIfd = (ifd: number, into: RawEntry[], depth: number) => {
    if (ifd < 8 || ifd + 2 > tiff.length || depth > 3) return;
    const n = r16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > tiff.length) break;
      const tag = r16(e), type = r16(e + 2), count = r32(e + 4);
      const ts = TYPE_SIZE[type] ?? 0;
      if (ts === 0) continue;
      const size = ts * count;
      if (tag === EXIF_PTR) { readIfd(r32(e + 8), out.exif, depth + 1); continue; }
      if (tag === GPS_PTR) { readIfd(r32(e + 8), out.gps, depth + 1); continue; }
      const off = size <= 4 ? e + 8 : r32(e + 8);
      if (off + size > tiff.length) continue;
      into.push({ tag, type, count, data: normalize(tiff.subarray(off, off + size), type) });
    }
  };
  readIfd(r32(4), out.ifd0, 0);
  return out;
}

/* ───────────────────────── apply edits ───────────────────────── */

const enc = (s: string) => { const b = new Uint8Array(s.length + 1); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; };
const beU32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0); return b; };
const beRat = (pairs: number[]) => { const b = new Uint8Array(pairs.length * 4); const v = new DataView(b.buffer); pairs.forEach((n, i) => v.setUint32(i * 4, n >>> 0)); return b; };

function setEntry(list: RawEntry[], tag: number, type: number, count: number, data: Uint8Array) {
  const i = list.findIndex((e) => e.tag === tag);
  const entry = { tag, type, count, data };
  if (i >= 0) list[i] = entry; else list.push(entry);
}
const setAscii = (list: RawEntry[], tag: number, s: string) => setEntry(list, tag, ASCII, s.length + 1, enc(s));

/** Decimal degrees → EXIF [deg,den, min,den, sec,den] rationals. */
function toDms(dec: number): number[] {
  const abs = Math.abs(dec);
  const deg = Math.floor(abs);
  const minF = (abs - deg) * 60;
  const min = Math.floor(minF);
  const sec = (minF - min) * 60;
  return [deg, 1, min, 1, Math.round(sec * 10000), 10000];
}

/** Apply the edited fields to a parsed TIFF (or an empty one), preserving every tag not touched. */
export function applyEdits(p: Parsed, f: ExifFields): Parsed {
  if (f.description !== undefined) setAscii(p.ifd0, 0x010e, f.description);
  if (f.make !== undefined) setAscii(p.ifd0, 0x010f, f.make);
  if (f.model !== undefined) setAscii(p.ifd0, 0x0110, f.model);
  if (f.software !== undefined) setAscii(p.ifd0, 0x0131, f.software);
  if (f.dateTime !== undefined) { setAscii(p.ifd0, 0x0132, f.dateTime); setAscii(p.exif, 0x9003, f.dateTime); }
  if (f.artist !== undefined) setAscii(p.ifd0, 0x013b, f.artist);
  if (f.copyright !== undefined) setAscii(p.ifd0, 0x8298, f.copyright);
  if (f.gps !== undefined) {
    if (f.gps === null) p.gps = [];
    else {
      const g: RawEntry[] = [];
      setEntry(g, 0x0000, BYTE, 4, new Uint8Array([2, 3, 0, 0]));
      setAscii(g, 0x0001, f.gps.lat >= 0 ? "N" : "S");
      setEntry(g, 0x0002, RATIONAL, 3, beRat(toDms(f.gps.lat)));
      setAscii(g, 0x0003, f.gps.lon >= 0 ? "E" : "W");
      setEntry(g, 0x0004, RATIONAL, 3, beRat(toDms(f.gps.lon)));
      if (f.gps.altitude != null && Number.isFinite(f.gps.altitude)) {
        setEntry(g, 0x0005, BYTE, 1, new Uint8Array([f.gps.altitude < 0 ? 1 : 0]));
        setEntry(g, 0x0006, RATIONAL, 1, beRat([Math.round(Math.abs(f.gps.altitude) * 100), 100]));
      }
      p.gps = g;
    }
  }
  return p;
}

/* ───────────────────────── serialise ───────────────────────── */

const entryBytes = (e: RawEntry) => e.data.length;

function writeIfd(view: DataView, buf: Uint8Array, ifdOff: number, entries: RawEntry[], dataOff: number): number {
  entries.sort((a, b) => a.tag - b.tag);
  view.setUint16(ifdOff, entries.length);
  let p = ifdOff + 2, d = dataOff;
  for (const e of entries) {
    view.setUint16(p, e.tag);
    view.setUint16(p + 2, e.type);
    view.setUint32(p + 4, e.count);
    const len = entryBytes(e);
    if (len <= 4) {
      buf.set(e.data, p + 8); // left-justified, rest already zero
    } else {
      view.setUint32(p + 8, d);
      buf.set(e.data, d);
      d += len + (len & 1); // word-align the data area
    }
    p += 12;
  }
  view.setUint32(p, 0); // no next IFD
  return d;
}

/** Serialise IFD0 / Exif / GPS back into a big-endian TIFF block. Empty when there is nothing to write. */
export function serializeTiff(p: Parsed): Uint8Array {
  const ifd0 = p.ifd0.filter((e) => e.tag !== EXIF_PTR && e.tag !== GPS_PTR); // we manage the pointers
  const hasExif = p.exif.length > 0, hasGps = p.gps.length > 0;
  if (!ifd0.length && !hasExif && !hasGps) return new Uint8Array(0);
  if (hasExif) ifd0.push({ tag: EXIF_PTR, type: LONG, count: 1, data: beU32(0) });
  if (hasGps) ifd0.push({ tag: GPS_PTR, type: LONG, count: 1, data: beU32(0) });

  const ifdSize = (es: RawEntry[]) => 2 + es.length * 12 + 4;
  const dataBytes = (es: RawEntry[]) => es.reduce((a, e) => a + (entryBytes(e) > 4 ? entryBytes(e) + (entryBytes(e) & 1) : 0), 0);
  const ifd0Off = 8;
  const exifOff = ifd0Off + ifdSize(ifd0);
  const gpsOff = exifOff + (hasExif ? ifdSize(p.exif) : 0);
  const dataStart = gpsOff + (hasGps ? ifdSize(p.gps) : 0);
  const total = dataStart + dataBytes(ifd0) + dataBytes(p.exif) + dataBytes(p.gps) + 8;

  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  buf[0] = 0x4d; buf[1] = 0x4d; view.setUint16(2, 42); view.setUint32(4, ifd0Off);
  for (const e of ifd0) { if (e.tag === EXIF_PTR) e.data = beU32(exifOff); if (e.tag === GPS_PTR) e.data = beU32(gpsOff); }

  let d = dataStart;
  d = writeIfd(view, buf, ifd0Off, ifd0, d);
  if (hasExif) d = writeIfd(view, buf, exifOff, p.exif, d);
  if (hasGps) d = writeIfd(view, buf, gpsOff, p.gps, d);
  return buf.subarray(0, d);
}

/** Build or edit a TIFF/EXIF block: merge the fields into `existing` (preserving its other tags) or start fresh. */
export function buildExifTiff(fields: ExifFields, existing?: Uint8Array | null): Uint8Array {
  const parsed = existing && existing.length ? parseTiff(existing) : { ifd0: [], exif: [], gps: [] };
  return serializeTiff(applyEdits(parsed, fields));
}
