// Browser-side file IO for the metadata viewer: read only the bytes that carry metadata (so a multi-gigabyte video
// is never loaded whole), locate the moov atom for ISO-BMFF edits, and stream-write an edited file in place or to a
// copy. Pure parsing lives in metadata.ts / metadata-write.ts; this module touches Blob, File and the File System
// Access API, so it is imported only from the client widget.

import { sniffType } from "./metadata";

/** Files at or below this read whole; larger ones are read by region per type. */
const WHOLE_CAP = 100 * 1024 * 1024;
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

export interface MoovInfo {
  moovStart: number;
  moovSize: number;
  /** moov sits after all media data (DJI and most cameras) → edits never shift chunk offsets. */
  atEnd: boolean;
}

/** Walk the top-level atoms (header reads only) to find ftyp and moov, without loading the media. */
export async function locateBmff(file: Blob): Promise<{ ftypStart: number; ftypSize: number; moov: MoovInfo } | null> {
  const size = file.size;
  let o = 0, ftypStart = -1, ftypSize = 0, moovStart = -1, moovSize = 0, lastEnd = 0;
  for (let guard = 0; o + 8 <= size && guard < 100000; guard++) {
    const head = new DataView(await file.slice(o, Math.min(o + 16, size)).arrayBuffer());
    if (head.byteLength < 8) break;
    let boxSize = head.getUint32(0);
    const type = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7));
    if (boxSize === 1) { if (head.byteLength < 16) break; boxSize = head.getUint32(8) * 2 ** 32 + head.getUint32(12); }
    else if (boxSize === 0) boxSize = size - o;
    if (boxSize < 8 || o + boxSize > size) break;
    if (type === "ftyp") { ftypStart = o; ftypSize = boxSize; }
    if (type === "moov") { moovStart = o; moovSize = boxSize; }
    o += boxSize;
    lastEnd = o;
  }
  if (moovStart < 0) return null;
  return { ftypStart, ftypSize, moov: { moovStart, moovSize, atEnd: moovStart + moovSize >= lastEnd } };
}

export interface BoundedRead {
  /** The bytes carrying metadata — the whole file when small, else the relevant region. */
  bytes: Uint8Array;
  /** True when only part of the file was read (so "read everything" claims stay honest). */
  truncated: boolean;
  /** For ISO-BMFF, where the moov sits, for editing without touching the media. */
  moov?: MoovInfo | null;
}

/** Read just enough of a file to read its metadata, regardless of size. */
export async function readForMeta(file: Blob, name: string): Promise<BoundedRead> {
  const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
  const s = sniffType(head, name);
  // For MP4/MOV/M4A always locate the moov so the file can be edited, whatever its size.
  const loc = ["mp4", "mov", "m4a", "m4v", "heic", "heif", "avif"].includes(s.ext) ? await locateBmff(file) : null;
  const moov = loc?.moov ?? null;

  if (file.size <= WHOLE_CAP) return { bytes: new Uint8Array(await file.arrayBuffer()), truncated: false, moov };

  if (loc) {
    // ftyp + moov, contiguous, so sniffType sees ftyp at 0 and readBmff walks both boxes — the media never loads.
    const ftyp = loc.ftypStart >= 0 ? new Uint8Array(await file.slice(loc.ftypStart, loc.ftypStart + loc.ftypSize).arrayBuffer()) : new Uint8Array(0);
    const moovBytes = new Uint8Array(await file.slice(loc.moov.moovStart, loc.moov.moovStart + loc.moov.moovSize).arrayBuffer());
    const bytes = new Uint8Array(ftyp.length + moovBytes.length);
    bytes.set(ftyp, 0); bytes.set(moovBytes, ftyp.length);
    return { bytes, truncated: true, moov };
  }
  // Images, MP3, RIFF and the rest keep their metadata near the front; a large PDF's trailer is at the end, so give
  // pdf.js as much as the cap allows.
  const cap = Math.min(file.size, WHOLE_CAP);
  return { bytes: new Uint8Array(await file.slice(0, cap).arrayBuffer()), truncated: cap < file.size, moov };
}

export { u32be, fourcc };
